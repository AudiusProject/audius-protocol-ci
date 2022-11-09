import assert from 'assert'
import { resFactory, loggerFactory } from '../../../test/lib/reqMock'
import { Request, Response } from 'express'
import Logger from 'bunyan'
import { Redis } from 'ioredis'
import config from '../../config'
import proxyquire from 'proxyquire' // eslint-disable-line node/no-unpublished-import

describe('Test premium content middleware', () => {
  let app: any
  let serviceRegistry: any
  let libs: any
  let logger: Logger
  let redis: Redis
  let headers: any
  let mockReq: any
  let mockRes: any

  const premiumContentMiddlewareProxy = ({
    accessCheckReturnsWith
  }: {
    accessCheckReturnsWith?: Object
  }) => {
    if (
      accessCheckReturnsWith !== undefined &&
      accessCheckReturnsWith !== null
    ) {
      return proxyquire('./premiumContentMiddleware', {
        './../../config': config,
        '../../premiumContent/premiumContentAccessChecker': {
          checkPremiumContentAccess: async () => accessCheckReturnsWith
        }
      })
    }

    return proxyquire('./premiumContentMiddleware', {
      './../../config': config
    })
  }

  beforeEach(() => {
    libs = {
      ethContracts: {
        ServiceProviderFactoryClient: {
          getServiceProviderList: () => []
        }
      }
    }
    logger = loggerFactory() as unknown as Logger
    redis = new Map() as unknown as Redis
    headers = {}
    serviceRegistry = {
      libs,
      redis
    }
    app = new Map()
    app.set('serviceRegistry', serviceRegistry)
    mockReq = {
      logger,
      headers,
      app,
      params: { CID: 'some-cid' }
    }
    mockRes = resFactory()
  })

  describe('when premium content is enabled', () => {
    beforeEach(() => {
      config.set('premiumContentEnabled', true)
    })

    it('returns bad request when missing the CID param', async () => {
      let nextCalled = false
      await premiumContentMiddlewareProxy({}).premiumContentMiddleware(
        { ...mockReq, params: { CID: null } } as unknown as Request,
        mockRes as unknown as Response,
        () => {
          nextCalled = true
        }
      )
      assert.deepStrictEqual(mockRes.statusCode, 400)
      assert.deepStrictEqual(nextCalled, false)
    })

    it('returns unauthorized when it fails because of missing headers', async () => {
      let nextCalled = false
      await premiumContentMiddlewareProxy({
        accessCheckReturnsWith: {
          doesUserHaveAccess: false,
          error: 'MissingHeaders'
        }
      }).premiumContentMiddleware(
        mockReq as unknown as Request,
        mockRes as unknown as Response,
        () => {
          nextCalled = true
        }
      )
      assert.deepStrictEqual(mockRes.statusCode, 401)
      assert.deepStrictEqual(nextCalled, false)
    })

    it('returns forbidden when it fails because of invalid discovery node', async () => {
      let nextCalled = false
      await premiumContentMiddlewareProxy({
        accessCheckReturnsWith: {
          doesUserHaveAccess: false,
          error: 'InvalidDiscoveryNode'
        }
      }).premiumContentMiddleware(
        mockReq as unknown as Request,
        mockRes as unknown as Response,
        () => {
          nextCalled = true
        }
      )
      assert.deepStrictEqual(mockRes.statusCode, 403)
      assert.deepStrictEqual(nextCalled, false)
    })

    it('passes and moves to the next middleware when all checks are fine', async () => {
      let nextCalled = false
      await premiumContentMiddlewareProxy({
        accessCheckReturnsWith: {
          doesUserHaveAccess: true,
          error: null
        }
      }).premiumContentMiddleware(
        mockReq as unknown as Request,
        mockRes as unknown as Response,
        () => {
          nextCalled = true
        }
      )
      assert.deepStrictEqual(nextCalled, true)
    })
  })

  describe('when premium content is disabled', () => {
    it('moves on to the next middleware', async () => {
      config.set('premiumContentEnabled', false)

      let nextCalled = false
      await premiumContentMiddlewareProxy({}).premiumContentMiddleware(
        mockReq as unknown as Request,
        mockRes as unknown as Response,
        () => {
          nextCalled = true
        }
      )
      assert.deepStrictEqual(nextCalled, true)
    })
  })
})
