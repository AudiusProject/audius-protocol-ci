const Bull = require('bull')

const { logger } = require('../../logging')
const secondarySyncFromPrimary = require('./secondarySyncFromPrimary')

const { SemanticAttributes } = require('@opentelemetry/semantic-conventions')
const { instrumentTracing, recordException } = require('utils/tracing')

const SYNC_QUEUE_HISTORY = 500
const LOCK_DURATION = 1000 * 60 * 5 // 5 minutes

/**
 * SyncImmediateQueue - handles enqueuing and processing of immediate manual Sync jobs on secondary
 * sync job = this node (secondary) will sync data for a user from their primary
 * this queue is only for manual immediate syncs which are awaited until they're finished, for regular
 * syncs look at SyncQueue
 */
class SyncImmediateQueue {
  /**
   * Construct bull queue and define job processor
   * @notice - accepts `serviceRegistry` instance, even though this class is initialized
   *    in that serviceRegistry instance. A sub-optimal workaround for now.
   */
  constructor(nodeConfig, redis, serviceRegistry) {
    this.nodeConfig = nodeConfig
    this.redis = redis
    this.serviceRegistry = serviceRegistry

    this.queue = new Bull('sync-immediate-processing-queue', {
      redis: {
        host: this.nodeConfig.get('redisHost'),
        port: this.nodeConfig.get('redisPort')
      },
      defaultJobOptions: {
        removeOnComplete: SYNC_QUEUE_HISTORY,
        removeOnFail: SYNC_QUEUE_HISTORY
      },
      settings: {
        lockDuration: LOCK_DURATION,
        // We never want to re-process stalled jobs
        maxStalledCount: 0
      }
    })

    const jobProcessorConcurrency = this.nodeConfig.get(
      'syncQueueMaxConcurrency'
    )
    this.queue.process(jobProcessorConcurrency, async (job) => {
      const {
        parentSpanContext
      } = job.data

      const processTask = instrumentTracing({
        name: 'syncImmediateQueue.process',
        fn: this.processTask,
        options: {
          links: [
            {
              context: parentSpanContext
            }
          ],
          attributes: {
            [SemanticAttributes.CODE_FILEPATH]: __filename
          }
        }
      })

      return await processTask(job)
    })

    processTask = async (job) => {
      const {
        walletPublicKeys,
        creatorNodeEndpoint,
        forceResync,
      } = job.data

      try {
        await secondarySyncFromPrimary(
          this.serviceRegistry,
          walletPublicKeys,
          creatorNodeEndpoint,
          null, // blockNumber
          forceResync
        )
      } catch (e) {
        recordException(e)
        const msg = `syncImmediateQueue error - secondarySyncFromPrimary failure for wallets ${walletPublicKeys} against ${creatorNodeEndpoint}: ${e.message}`
        logger.error(msg)
        throw e
      }
    }
  }

  async processImmediateSync({
    walletPublicKeys,
    creatorNodeEndpoint,
    forceResync,
    parentSpanContext
  }) {
    const jobProps = {
      walletPublicKeys,
      creatorNodeEndpoint,
      forceResync,
      parentSpanContext
    }
    const job = await this.queue.add(jobProps)
    const result = await job.finished()
    return result
  }
}

module.exports = SyncImmediateQueue
