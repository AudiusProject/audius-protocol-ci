import type Logger from 'bunyan'
import type {
  AnyJobParams,
  QueueNameToQueueMap,
  AnyDecoratedJobReturnValue,
  ParamsForJobsToEnqueue
} from './types'
import type { UpdateReplicaSetJobParams } from './stateReconciliation/types'
import type { TQUEUE_NAMES } from './stateMachineConstants'
import type { Span, SpanContext } from '@opentelemetry/api'

import { SpanStatusCode } from '@opentelemetry/api'
import { SemanticAttributes } from '@opentelemetry/semantic-conventions'

import { Queue } from 'bull'

// eslint-disable-next-line import/no-unresolved
import _ from 'lodash'

import { getTracer } from '../../tracer'
import { logger as baseLogger, createChildLogger } from '../../logging'
import { QUEUE_NAMES } from './stateMachineConstants'
import {
  METRIC_RECORD_TYPE
} from '../prometheusMonitoring/prometheus.constants'

/**
 * Higher order function that creates a function that's used as a Bull Queue onComplete callback to take
 * a job that successfully completed and read its output for new jobs that will be enqueued in bulk as well
 * as metrics that will be recorded.
 * The expected syntax that a job result must output in order to for this function to enqueue more
 * jobs upon completion is:
 * {
 *   jobsToEnqueue: {
 *     [QUEUE_NAMES.STATE_MONITORING]: [
 *       { <object containing data that this job type expects> },
 *       ...
 *     ],
 *     [QUEUE_NAMES.STATE_RECONCILIATION]: [
 *       { <object containing data that this job type expects> },
 *       ...
 *     ]
 *   }
 * }
 * @dev MUST be bound to a class containing an `enabledReconfigModes` property.
 *      See usage in index.js (in same directory) for example of how it's bound to StateMachineManager.
 *
 * @param {string} nameOfQueueWithCompletedJob the name of the queue that this onComplete callback is for
 * @param {Object} queueNameToQueueMap mapping of queue name (string) to queue object (BullQueue)
 * @param {Object} prometheusRegistry the registry of prometheus metrics
 * @returns a function that:
 * - takes a jobId (string) and result (string) of a job that successfully completed
 * - parses the result (string) into JSON
 * - bulk-enqueues all jobs under result[QUEUE_NAMES.STATE_MONITORING] into the state monitoring queue
 * - bulk-enqueues all jobs under result[QUEUE_NAMES.STATE_RECONCILIATION] into the state reconciliation queue
 * - records metrics from result.metricsToRecord
 */
module.exports = function (
  nameOfQueueWithCompletedJob: TQUEUE_NAMES,
  queueNameToQueueMap: QueueNameToQueueMap,
  prometheusRegistry: any
) {
  return async function (jobId: string, resultString: string) {
    const options = {
      attributes: {
        [SemanticAttributes.CODE_FUNCTION]: 'makeOnCompleteCallback',
        [SemanticAttributes.CODE_FILEPATH]: __filename
      }
    }
    return getTracer().startActiveSpan(
      'makeOnCompleteCallback',
      options,
      async (span: Span) => {
        // Create a logger so that we can filter logs by the tag `jobId` = <id of the job that successfully completed>
        const logger = createChildLogger(baseLogger, { jobId }) as Logger

        // update-replica-set jobs need enabledReconfigModes as an array.
        // `this` comes from the function being bound via .bind() to ./index.js
        if (!this?.hasOwnProperty('enabledReconfigModesSet')) {
          logger.error(
            'Function was supposed to be bound to StateMachineManager to access enabledReconfigModesSet! Update replica set jobs will not be able to process!'
          )
          span.end()
          return
        }
        const enabledReconfigModes: string[] = Array.from(
          this.enabledReconfigModesSet
        )

        // Bull serializes the job result into redis, so we have to deserialize it into JSON
        let jobResult: AnyDecoratedJobReturnValue
        try {
          logger.info(
            `Job successfully completed. Parsing result: ${resultString}`
          )
          jobResult = JSON.parse(resultString) || {}
        } catch (e: any) {
          span.recordException(e)
          span.setStatus({ code: SpanStatusCode.ERROR })
          span.end()
          logger.error(`Failed to parse job result string: ${e.message}`)
          return
        }

        const { jobsToEnqueue, metricsToRecord, spanContext } = jobResult

        // Enqueue jobs into each queue
        for (const [queueName, queueJobs] of Object.entries(
          jobsToEnqueue || {}
        ) as [TQUEUE_NAMES, ParamsForJobsToEnqueue[]][]) {
          // Make sure we're working with a valid queue
          const queue: Queue = queueNameToQueueMap[queueName]
          if (!queue) {
            logger.error(
              `Job returned data trying to enqueue jobs to a queue whose name isn't recognized: ${queueName}`
            )
            continue
          }

          // Inject data into jobs that require extra params
          let jobs: AnyJobParams[]
          switch (queueName) {
            case QUEUE_NAMES.UPDATE_REPLICA_SET: {
              jobs = injectEnabledReconfigModes(
                queueJobs as UpdateReplicaSetJobParams[],
                enabledReconfigModes
              )
              break
            }
            default: {
              jobs = queueJobs as AnyJobParams[]
              break
            }
          }

          jobs = injectSpanContext(jobs, spanContext)
          await enqueueJobs(
            jobs,
            queue,
            queueName,
            nameOfQueueWithCompletedJob,
            jobId,
            logger
          )
        }

        recordMetrics(prometheusRegistry, logger, metricsToRecord)
        span.end()
      }
    )
  }
}

const enqueueJobs = async (
  jobs: AnyJobParams[],
  queueToAddTo: Queue,
  queueNameToAddTo: TQUEUE_NAMES,
  triggeredByQueueName: TQUEUE_NAMES,
  triggeredByJobId: string,
  logger: Logger
) => {
  const options = {
    attributes: {
      [SemanticAttributes.CODE_FUNCTION]: 'enqueueJobs',
      [SemanticAttributes.CODE_FILEPATH]: __filename
    }
  }
  getTracer().startActiveSpan('enqueueJobs', options, async (span) => {
    logger.info(
      `Attempting to add ${jobs?.length} jobs in bulk to queue ${queueNameToAddTo}`
    )

    // Add 'enqueuedBy' field for tracking
    try {
      const bulkAddResult = await queueToAddTo.addBulk(
        jobs.map((job) => {
          return {
            data: {
              enqueuedBy: `${triggeredByQueueName}#${triggeredByJobId}`,
              ...job
            }
          }
        })
      )
      logger.info(
        `Added ${bulkAddResult.length} jobs to ${queueNameToAddTo} in bulk after successful completion`
      )
    } catch (e: any) {
      span.recordException(e)
      span.setStatus({ code: SpanStatusCode.ERROR })
      logger.error(
        `Failed to bulk-add jobs to ${queueNameToAddTo} after successful completion: ${e}`
      )
    }
    span.end()
  })
}

// Injects enabledReconfigModes into update-replica-set jobs
const injectEnabledReconfigModes = (
  jobs: UpdateReplicaSetJobParams[],
  enabledReconfigModes: string[]
): (UpdateReplicaSetJobParams & {
  enabledReconfigModes: string[]
})[] => {
  return jobs.map((job) => {
    return { ...job, enabledReconfigModes }
  })
}

// Injects spanContext into jobs
const injectSpanContext = (
  jobs: AnyJobParams[],
  spanContext: SpanContext
): AnyJobParams[] => {
  return jobs.map((job) => {
    return { ...job, parentSpanContext: spanContext }
  })
}

const recordMetrics = (
  prometheusRegistry: any,
  logger: Logger,
  metricsToRecord = []
) => {
  for (const metricInfo of metricsToRecord) {
    try {
      const { metricName, metricType, metricValue, metricLabels } = metricInfo
      const metric = prometheusRegistry.getMetric(metricName)
      if (metricType === METRIC_RECORD_TYPE.HISTOGRAM_OBSERVE) {
        metric.observe(metricLabels, metricValue)
      } else if (metricType === METRIC_RECORD_TYPE.GAUGE_INC) {
        metric.inc(metricLabels, metricValue)
      } else {
        logger.error(`Unexpected metric type: ${metricType}`)
      }
    } catch (error) {
      logger.error(`Error recording metric ${metricInfo}: ${error}`)
    }
  }
}
