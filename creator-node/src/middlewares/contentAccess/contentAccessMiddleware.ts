import {
  sendResponse,
  errorResponseServerError,
  errorResponseForbidden,
  errorResponseUnauthorized,
  errorResponseBadRequest,
  CustomRequest
} from '../../apiHelpers'
import { NextFunction, Request, Response } from 'express'
import type Logger from 'bunyan'
import { checkCIDAccess } from '../../contentAccess/contentAccessChecker'
import { tracing } from '../../tracer'

/**
 * Middleware to validate requests to get content.
 * For streaming, CN gets a DN signature:
 * - generated by a DN with the cid along with a timestamp,
 * This middleware will recover the DN signature and verify that it is from a registered DN.
 * It also verifies that cid is same as those in the DN-signed data, and also verify that DN-signed data
 * timestamp is relatively recent.
 * If all these verifications are successful, then this middleware will proceed with the request as normal.
 */
export const contentAccessMiddleware = async (
  request: Request,
  res: Response,
  next: NextFunction
) => {
  const req = request as CustomRequest
  const cid = req.params?.CID
  if (!cid) {
    return sendResponse(
      req,
      res,
      errorResponseBadRequest(`Invalid request, no CID provided.`)
    )
  }

  try {
    const contentAccessHeaders = req.headers['x-content-access'] as string
    const serviceRegistry = req.app.get('serviceRegistry')
    const { libs, redis } = serviceRegistry
    const logger = req.logger as Logger

    const { isValidRequest, shouldCache, error } = await checkCIDAccess({
      cid,
      contentAccessHeaders,
      libs,
      logger,
      redis
    })
    if (!isValidRequest) {
      switch (error) {
        case 'MissingHeaders':
          return sendResponse(
            req,
            res,
            errorResponseUnauthorized('Missing request headers for content.')
          )
        case 'InvalidDiscoveryNode':
          return sendResponse(
            req,
            res,
            errorResponseForbidden(
              'Failed discovery node signature validation for content.'
            )
          )
        case 'IncorrectCID':
          return sendResponse(
            req,
            res,
            errorResponseForbidden('Incorrect CID signature')
          )
        case 'ExpiredTimestamp':
          return sendResponse(
            req,
            res,
            errorResponseForbidden('Timestamp for content is expired')
          )
        default:
          return sendResponse(
            req,
            res,
            errorResponseForbidden('Failed match verification for content.')
          )
      }
    }

    // We need the info because if the content is gated, then we need to set
    // the cache-control response header to no-cache so that nginx does not cache it.
    ;(req as any).shouldCache = shouldCache

    return next()
  } catch (e: any) {
    tracing.recordException(e)
    const error = `Could not validate content access: ${e.message}`
    req.logger.error(`${error}.\nError: ${JSON.stringify(e, null, 2)}`)
    return sendResponse(req, res, errorResponseServerError(error))
  }
}
