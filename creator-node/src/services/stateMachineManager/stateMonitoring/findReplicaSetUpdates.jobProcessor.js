const _ = require('lodash')

const {
  FIND_REPLICA_SET_UPDATES_BATCH_SIZE,
  QUEUE_NAMES,
  JOB_NAMES
} = require('../stateMachineConstants')
const CNodeHealthManager = require('../CNodeHealthManager')
const CNodeToSpIdMapManager = require('../CNodeToSpIdMapManager')
const config = require('../../../config')

const thisContentNodeEndpoint = config.get('creatorNodeEndpoint')
const minSecondaryUserSyncSuccessPercent =
  config.get('minimumSecondaryUserSyncSuccessPercent') / 100
const minFailedSyncRequestsBeforeReconfig = config.get(
  'minimumFailedSyncRequestsBeforeReconfig'
)

/**
 * Processes a job to find and return reconfigurations of replica sets that
 * need to occur for the given array of users.
 *
 * @param {Object} param job data
 * @param {Object} param.logger a logger that can be filtered by jobName and jobId
 * @param {Object[]} param.users array of { primary, secondary1, secondary2, primarySpID, secondary1SpID, secondary2SpID, user_id, wallet }
 * @param {Set<string>} param.unhealthyPeers set of unhealthy peers
 * @param {Object} param.replicaSetNodesToUserClockStatusesMap map of secondary endpoint strings to (map of user wallet strings to clock value of secondary for user)
 * @param {string (wallet): Object{ string (secondary endpoint): Object{ successRate: number (0-1), successCount: number, failureCount: number }}} param.userSecondarySyncMetricsMap mapping of nodeUser's wallet (string) to metrics for their sync success to secondaries
 */
module.exports = async function ({
  logger,
  users,
  unhealthyPeers,
  replicaSetNodesToUserClockStatusesMap,
  userSecondarySyncMetricsMap
}) {
  _validateJobData(
    logger,
    users,
    unhealthyPeers,
    replicaSetNodesToUserClockStatusesMap,
    userSecondarySyncMetricsMap
  )

  const unhealthyPeersSet = new Set(unhealthyPeers || [])

  // Parallelize calling _findReplicaSetUpdatesForUser on chunks of 500 users at a time
  const userBatches = _.chunk(users, FIND_REPLICA_SET_UPDATES_BATCH_SIZE)
  const results = []
  for (const userBatch of userBatches) {
    const resultBatch = await Promise.allSettled(
      userBatch.map((user) =>
        _findReplicaSetUpdatesForUser(
          user,
          thisContentNodeEndpoint,
          unhealthyPeersSet,
          userSecondarySyncMetricsMap[user.wallet] || {
            [user.secondary1]: { successRate: 1, failureCount: 0 },
            [user.secondary2]: { successRate: 1, failureCount: 0 }
          },
          minSecondaryUserSyncSuccessPercent,
          minFailedSyncRequestsBeforeReconfig,
          logger
        )
      )
    )
    results.push(...resultBatch)
  }

  // Combine each batch's updateReplicaSet jobs that need to be enqueued
  const updateReplicaSetJobs = []
  for (const promiseResult of results) {
    // Skip and log failed promises
    const {
      status: promiseStatus,
      value: updateReplicaSetOps,
      reason: promiseError
    } = promiseResult
    if (promiseStatus !== 'fulfilled') {
      logger.error(
        `_findReplicaSetUpdatesForUser() encountered unexpected failure: ${
          promiseError.message || promiseError
        }`
      )
      continue
    }

    // Combine each promise's updateReplicaSetOps into a job
    for (const updateReplicaSetOp of updateReplicaSetOps) {
      const { wallet } = updateReplicaSetOp

      updateReplicaSetJobs.push({
        jobName: JOB_NAMES.UPDATE_REPLICA_SET,
        jobData: {
          wallet,
          userId: updateReplicaSetOp.user_id,
          primary: updateReplicaSetOp.primary,
          secondary1: updateReplicaSetOp.secondary1,
          secondary2: updateReplicaSetOp.secondary2,
          unhealthyReplicas: Array.from(updateReplicaSetOp.unhealthyReplicas),
          replicaSetNodesToUserClockStatusesMap:
            _transformAndFilterNodeToClockValuesMapping(
              replicaSetNodesToUserClockStatusesMap,
              wallet
            )
        }
      })
    }
  }

  return {
    jobsToEnqueue: updateReplicaSetJobs?.length
      ? {
          [QUEUE_NAMES.STATE_RECONCILIATION]: updateReplicaSetJobs
        }
      : {}
  }
}

const _validateJobData = (
  logger,
  users,
  unhealthyPeers,
  replicaSetNodesToUserClockStatusesMap,
  userSecondarySyncMetricsMap
) => {
  if (typeof logger !== 'object') {
    throw new Error(
      `Invalid type ("${typeof logger}") or value ("${logger}") of logger param`
    )
  }
  if (!(users instanceof Array)) {
    throw new Error(
      `Invalid type ("${typeof users}") or value ("${users}") of users param`
    )
  }
  if (!(unhealthyPeers instanceof Array)) {
    throw new Error(
      `Invalid type ("${typeof unhealthyPeers}") or value ("${unhealthyPeers}") of unhealthyPeers param`
    )
  }
  if (
    typeof replicaSetNodesToUserClockStatusesMap !== 'object' ||
    replicaSetNodesToUserClockStatusesMap instanceof Array
  ) {
    throw new Error(
      `Invalid type ("${typeof replicaSetNodesToUserClockStatusesMap}") or value ("${replicaSetNodesToUserClockStatusesMap}") of replicaSetNodesToUserClockStatusesMap`
    )
  }
  if (
    typeof userSecondarySyncMetricsMap !== 'object' ||
    userSecondarySyncMetricsMap instanceof Array
  ) {
    throw new Error(
      `Invalid type ("${typeof userSecondarySyncMetricsMap}") or value ("${userSecondarySyncMetricsMap}") of userSecondarySyncMetricsMap`
    )
  }
}

/**
 * Determines which replica set update operations should be performed for a given user.
 *
 * @param {Object} user { primary, secondary1, secondary2, primarySpID, secondary1SpID, secondary2SpID, user_id, wallet}
 * @param {string} thisContentNodeEndpoint URL or IP address of this Content Node
 * @param {Set<string>} unhealthyPeers set of unhealthy peers
 * @param {string (secondary endpoint): Object{ successRate: number (0-1), successCount: number, failureCount: number }} userSecondarySyncMetrics mapping of each secondary to the success metrics the nodeUser has had syncing to it
 * * @param {number} minSecondaryUserSyncSuccessPercent 0-1 minimum sync success rate a secondary must have to perform a sync to it
 * @param {number} minFailedSyncRequestsBeforeReconfig minimum number of failed sync requests to a secondary before the user's replica set gets updated to not include the secondary
 * @param {Object} param.logger a logger that can be filtered by jobName and jobId
 */
const _findReplicaSetUpdatesForUser = async (
  user,
  thisContentNodeEndpoint,
  unhealthyPeersSet,
  userSecondarySyncMetrics,
  minSecondaryUserSyncSuccessPercent,
  minFailedSyncRequestsBeforeReconfig,
  logger
) => {
  const requiredUpdateReplicaSetOps = []
  const unhealthyReplicas = new Set()

  const {
    wallet,
    primary,
    secondary1,
    secondary2,
    primarySpID,
    secondary1SpID,
    secondary2SpID
  } = user

  /**
   * If this node is primary for user, check both secondaries for health
   * Enqueue SyncRequests against healthy secondaries, and enqueue UpdateReplicaSetOps against unhealthy secondaries
   */
  let replicaSetNodesToObserve = [
    { endpoint: secondary1, spId: secondary1SpID },
    { endpoint: secondary2, spId: secondary2SpID }
  ]

  if (primary === thisContentNodeEndpoint) {
    // filter out false-y values to account for incomplete replica sets
    const secondariesInfo = replicaSetNodesToObserve.filter(
      (entry) => entry.endpoint
    )

    /**
     * For each secondary, enqueue `potentialSyncRequest` if healthy else add to `unhealthyReplicas`
     */
    for (const secondaryInfo of secondariesInfo) {
      const secondary = secondaryInfo.endpoint

      const { successRate, successCount, failureCount } =
        userSecondarySyncMetrics[secondary]

      // Error case 1 - mismatched spID
      if (
        CNodeToSpIdMapManager.getCNodeEndpointToSpIdMap()[secondary] !==
        secondaryInfo.spId
      ) {
        logger.error(
          `_findReplicaSetUpdatesForUser(): Secondary ${secondary} for user ${wallet} mismatched spID. Expected ${
            secondaryInfo.spId
          }, found ${
            CNodeToSpIdMapManager.getCNodeEndpointToSpIdMap()[secondary]
          }. Marking replica as unhealthy.`
        )
        unhealthyReplicas.add(secondary)

        // Error case 2 - already marked unhealthy
      } else if (unhealthyPeersSet.has(secondary)) {
        logger.error(
          `_findReplicaSetUpdatesForUser(): Secondary ${secondary} for user ${wallet} in unhealthy peer set. Marking replica as unhealthy.`
        )
        unhealthyReplicas.add(secondary)

        // Error case 3 - low user sync success rate
      } else if (
        failureCount >= minFailedSyncRequestsBeforeReconfig &&
        successRate < minSecondaryUserSyncSuccessPercent
      ) {
        logger.error(
          `_findReplicaSetUpdatesForUser(): Secondary ${secondary} for user ${wallet} has userSyncSuccessRate of ${successRate}, which is below threshold of ${minSecondaryUserSyncSuccessPercent}. ${successCount} Successful syncs vs ${failureCount} Failed syncs. Marking replica as unhealthy.`
        )
        unhealthyReplicas.add(secondary)
      }
    }

    /**
     * If any unhealthy replicas found for user, enqueue an updateReplicaSetOp for later processing
     */
    if (unhealthyReplicas.size > 0) {
      requiredUpdateReplicaSetOps.push({ ...user, unhealthyReplicas })
    }

    /**
     * If this node is secondary for user, check both secondaries for health and enqueue SyncRequests against healthy secondaries
     * Ignore unhealthy secondaries for now
     */
  } else {
    // filter out false-y values to account for incomplete replica sets and filter out the
    // the self node
    replicaSetNodesToObserve = [
      { endpoint: primary, spId: primarySpID },
      ...replicaSetNodesToObserve
    ]
    replicaSetNodesToObserve = replicaSetNodesToObserve.filter((entry) => {
      return entry.endpoint && entry.endpoint !== thisContentNodeEndpoint
    })

    for (const replica of replicaSetNodesToObserve) {
      // If the map's spId does not match the query's spId, then regardless
      // of the relationship of the node to the user, issue a reconfig for that node
      if (
        CNodeToSpIdMapManager.getCNodeEndpointToSpIdMap()[replica.endpoint] !==
        replica.spId
      ) {
        unhealthyReplicas.add(replica.endpoint)
      } else if (unhealthyPeersSet.has(replica.endpoint)) {
        // Else, continue with conducting extra health check if the current observed node is a primary, and
        // add to `unhealthyReplicas` if observed node is a secondary
        let addToUnhealthyReplicas = true

        if (replica.endpoint === primary) {
          addToUnhealthyReplicas = !(await CNodeHealthManager.isPrimaryHealthy(
            primary
          ))
        }

        if (addToUnhealthyReplicas) {
          unhealthyReplicas.add(replica.endpoint)
        }
      }
    }

    if (unhealthyReplicas.size > 0) {
      requiredUpdateReplicaSetOps.push({ ...user, unhealthyReplicas })
    }
  }

  return requiredUpdateReplicaSetOps
}

/**
 * Transforms data type from ((K1,V1) => (K2,V2)) to (K1,V1[K2]), where K1 is the node endpoint,
 * V1 is the mapping, and K2 is the wallet to filter by. Default to clock value of -1 whenever the given
 * wallet isn't present in a node's mapping.
 * @param {Object} replicaSetNodesToUserClockStatusesMap map of secondary endpoint strings to (map of user wallet strings to clock value of secondary for user)
 * @param {string} wallet the wallet to filter clock values for (other wallets will be exlucded from the output)
 * @returns mapping of node endpoint (string) to clock value (number) on that node for the given wallet
 */
const _transformAndFilterNodeToClockValuesMapping = (
  replicaSetNodesToUserClockStatusesMap,
  wallet
) => {
  return Object.fromEntries(
    Object.entries(replicaSetNodesToUserClockStatusesMap).map(
      ([node, clockValueMapping]) => [node, clockValueMapping[wallet] || -1]
    )
  )
}
