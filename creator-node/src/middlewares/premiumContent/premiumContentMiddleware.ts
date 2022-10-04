import {
  sendResponseWithMetric,
  errorResponseServerError,
  errorResponseForbidden,
  errorResponseUnauthorized,
  errorResponseBadRequest
} from '../../apiHelpers'
import { NextFunction, Request, Response } from 'express'
import { PremiumContentAccessError } from '../../premiumContent/types'
import type Logger from 'bunyan'
import { PremiumContentAccessChecker } from '../../premiumContent/premiumContentAccessChecker'
import config from '../../config'

/**
 * Middleware to validate requests to get premium content.
 * For premium content, CN gets a request with 2 signatures:
 * - one generated by a DN with the premium track/playlist id and wallet from user who has access to it,
 * along with a timestamp,
 * - another from the client generated by the user who is requesting the premium track.
 * This middleware will recover the DN signature and verify that it is from a registered DN.
 * It will also recover the user signature. Then, it will verify that wallet from recovered signature
 * is the same as that of wallet in the DN-signed data, also verify that id and type (track/playlist)
 * of content requested are same as those in the DN-signed data, and also verify that DN-signed data
 * timestamp is relatively recent.
 * If all these verifications are successful, then this middleware will proceed with the request as normal.
 */
export const premiumContentMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const cid = req.params?.CID
  const prometheusResult = { result: '', mode: 'default' }

  if (!cid) {
    prometheusResult.result = 'abort_no_cid'
    return sendResponseWithMetric(
      req,
      res,
      errorResponseBadRequest('Invalid request, no CID provided'),
      prometheusResult
    )
  }

  if (!config.get('premiumContentEnabled')) {
    return next()
  }

  try {
    const premiumContentHeaders = req.headers['x-premium-content'] as string
    const serviceRegistry = req.app.get('serviceRegistry')
    const { premiumContentAccessChecker, libs, redis } = serviceRegistry
    // Need to set the type here as the compiler cannot tell what type it is from the serviceRegistry
    const accessChecker =
      premiumContentAccessChecker as PremiumContentAccessChecker
    const logger = (req as any).logger as Logger

    const { doesUserHaveAccess, trackId, isPremium, error } =
      await accessChecker.checkPremiumContentAccess({
        cid,
        premiumContentHeaders,
        libs,
        logger,
        redis
      })
    if (doesUserHaveAccess) {
      // Set premium content track id and 'premium-ness' so that next middleware or
      // request handler does not need to make trips to the database to get this info.
      // We need the info because if the content is premium, then we need to set
      // the cache-control response header to no-cache so that nginx does not cache it.
      ;(req as any).premiumContent = {
        trackId,
        isPremium
      }
      return next()
    }

    switch (error) {
      case PremiumContentAccessError.MISSING_HEADERS:
        prometheusResult.result = 'abort_premium_content_missing_headers'
        return sendResponseWithMetric(
          req,
          res,
          errorResponseUnauthorized(
            'Missing request headers for premium content.'
          ),
          prometheusResult
        )
      case PremiumContentAccessError.INVALID_DISCOVERY_NODE:
        prometheusResult.result =
          'abort_premium_content_invalid_discovery_node_validation'
        return sendResponseWithMetric(
          req,
          res,
          errorResponseForbidden(
            'Failed discovery node signature validation for premium content.'
          ),
          prometheusResult
        )
      case PremiumContentAccessError.FAILED_MATCH:
      default:
        prometheusResult.result =
          'abort_premium_content_failed_match_verification'
        return sendResponseWithMetric(
          req,
          res,
          errorResponseForbidden(
            'Failed match verification for premium content.'
          ),
          prometheusResult
        )
    }
  } catch (e) {
    ;(req as any).logger.error(
      `Could not validate premium content access: ${
        (e as Error).message
      }.\nError: ${JSON.stringify(e, null, 2)}`
    )
    prometheusResult.result = 'failure_premium_content_error'
    return sendResponseWithMetric(
      req,
      res,
      errorResponseServerError('Could not validate premium content access'),
      prometheusResult
    )
  }
}
