const express = require('express')
const { SemanticAttributes } = require('@opentelemetry/semantic-conventions')
const { SpanStatusCode } = require('@opentelemetry/api')

const models = require('../models')
const {
  handleResponse,
  successResponse,
  errorResponse,
  errorResponseServerError
} = require('../apiHelpers')
const config = require('../config')
const retry = require('async-retry')
const exportComponentService = require('../components/replicaSet/exportComponentService')
const { instrumentTracing, getActiveSpan } = require('./utils/tracing')

const router = express.Router()

handleExport = async (req, res) => {
  const span = getActiveSpan()
  const start = Date.now()

  const walletPublicKeys = req.query.wallet_public_key // array
  const sourceEndpoint = req.query.source_endpoint // string
  const forceExport = !!req.query.force_export // boolean

  const maxExportClockValueRange = config.get('maxExportClockValueRange')

  // Define clock range (min and max) for export
  const requestedClockRangeMin = parseInt(req.query.clock_range_min) || 0
  const requestedClockRangeMax =
    requestedClockRangeMin + (maxExportClockValueRange - 1)

  try {
    const cnodeUsersDict = await retry(
      async () => {
        return await exportComponentService({
          walletPublicKeys,
          requestedClockRangeMin,
          requestedClockRangeMax,
          forceExport,
          logger: req.logger
        })
      },
      {
        retries: 3
      }
    )

    req.logger.info(
      `Successful export for wallets ${walletPublicKeys} to source endpoint ${sourceEndpoint || '(not provided)'
      } for clock value range [${requestedClockRangeMin},${requestedClockRangeMax}] || route duration ${Date.now() - start
      } ms`
    )

    span?.addAttribute('cnodeUsersDict', JSON.stringify(cnodeUsersDict))
    return successResponse({ cnodeUsers: cnodeUsersDict })
  } catch (e) {
    span?.recordException(e)
    span?.setStatus({ code: SpanStatusCode.ERROR })
    req.logger.error(
      `Error in /export for wallets ${walletPublicKeys} to source endpoint ${sourceEndpoint || '(not provided)'
      } for clock value range [${requestedClockRangeMin},${requestedClockRangeMax}] || route duration ${Date.now() - start
      } ms ||`,
      e
    )
    return errorResponseServerError(e.message)
  }
}

/**
 * Exports all db data (not files) associated with walletPublicKey[] as JSON.
 *
 * This route is only run on a user's primary, to export data to the user's secondaries.
 *
 * @return {
 *  cnodeUsers Map Object containing all db data keyed on cnodeUserUUID
 * }
 */
router.get(
  '/export',
  handleResponse(async (req, res) => {
    instrumentTracing({
      fn: handleExport,
      options: {
        attributes: {
          [SemanticAttributes.CODE_FUNCTION]: 'handleResponse',
          [SemanticAttributes.CODE_FILEPATH]: __filename
        }
      }
    })
  })
)

/** Checks if node sync is in progress for wallet. */
router.get(
  '/sync_status/:walletPublicKey',
  handleResponse(async (req, res) => {
    const walletPublicKey = req.params.walletPublicKey

    const redisClient = req.app.get('redisClient')
    if (await redisClient.WalletWriteLock.syncIsInProgress(walletPublicKey)) {
      return errorResponse(
        423,
        `Cannot change state of wallet ${walletPublicKey}. Node sync currently in progress.`
      )
    }

    // Get & return latestBlockNumber for wallet
    const cnodeUser = await models.CNodeUser.findOne({
      where: { walletPublicKey }
    })
    const latestBlockNumber = cnodeUser ? cnodeUser.latestBlockNumber : -1
    const clockValue = cnodeUser ? cnodeUser.clock : -1

    return successResponse({ walletPublicKey, latestBlockNumber, clockValue })
  })
)

module.exports = router
