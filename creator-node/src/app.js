const express = require('express')
const bodyParser = require('body-parser')
const cors = require('cors')
const promBundle = require('express-prom-bundle')

const DiskManager = require('./diskManager')
const { sendResponse, errorResponseServerError } = require('./apiHelpers')
const { logger, loggingMiddleware } = require('./logging')
const {
  readOnlyMiddleware
} = require('./middlewares/readOnly/readOnlyMiddleware')
const {
  userReqLimiter,
  trackReqLimiter,
  audiusUserReqLimiter,
  metadataReqLimiter,
  imageReqLimiter,
  URSMRequestForSignatureReqLimiter,
  batchCidsExistReqLimiter,
  getRateLimiterMiddleware
} = require('./reqLimiter')
const config = require('./config')
const healthCheckRoutes = require('./components/healthCheck/healthCheckController')
const contentBlacklistRoutes = require('./components/contentBlacklist/contentBlacklistController')
const replicaSetRoutes = require('./components/replicaSet/replicaSetController')

function errorHandler(err, req, res, next) {
  req.logger.error('Internal server error')
  req.logger.error(err.stack)
  sendResponse(req, res, errorResponseServerError('Internal server error'))
}

/**
 * Configures express app object with required properties and starts express server
 *
 * @param {number} port port number on which to expose server
 * @param {ServiceRegistry} serviceRegistry object housing all Content Node Services
 */
const initializeApp = (port, serviceRegistry) => {
  const app = express()

  // middleware functions will be run in order they are added to the app below
  //  - loggingMiddleware must be first to ensure proper error handling
  app.use(loggingMiddleware)
  app.use(bodyParser.json({ limit: '1mb' }))
  app.use(readOnlyMiddleware)
  app.use(cors())

  const prometheusRegistry = serviceRegistry.prometheusRegistry

  // Rate limit routes
  app.use('/users/', userReqLimiter)
  app.use('/track*', trackReqLimiter)
  app.use('/audius_user/', audiusUserReqLimiter)
  app.use('/metadata', metadataReqLimiter)
  app.use('/image_upload', imageReqLimiter)
  app.use('/ursm_request_for_signature', URSMRequestForSignatureReqLimiter)
  app.use('/batch_cids_exist', batchCidsExistReqLimiter)
  app.use('/batch_image_cids_exist', batchCidsExistReqLimiter)
  app.use(getRateLimiterMiddleware())

  // Metric tracking middleware
  app.use(
    promBundle({
      // use existing registry for compatibility with custom metrics
      promRegistry: prometheusRegistry.registry,
      // override metric name to include namespace prefix
      httpDurationMetricName: `${prometheusRegistry.namespacePrefix}http_request_duration_seconds`,
      includeMethod: true,
      includePath: true,
      // do not register separate endpoint
      autoregister: false,
      normalizePath
    })
  )

  // import routes
  require('./routes')(app)
  app.use('/', healthCheckRoutes)
  app.use('/', contentBlacklistRoutes)
  app.use('/', replicaSetRoutes)

  // Get all routes on Content Node
  const routes = app._router.stack.filter(
    (element) =>
      (element.route && element.route.path) ||
      (element.handle && element.handle.stack)
  )

  // Express routing is... unpredictable. Use a set to manage seen paths
  const seenPaths = new Set()
  const parsedRoutes = []
  routes.forEach((element) => {
    if (element.name === 'router') {
      // For routes initialized with the express router
      element.handle.stack.forEach((e) => {
        const path = e.route.path
        const method = Object.keys(e.route.methods)[0]
        const regex = e.regexp
        addToParsedRoutes(path, method, regex)
      })
    } else {
      // For all the other routes
      const path = element.route.path
      const method = Object.keys(element.route.methods)[0]
      const regex = element.regexp
      addToParsedRoutes(path, method, regex)
    }
  })

  function addToParsedRoutes(path, method, regex) {
    // Routes may come in the form of an array (e.g. ['/ipfs/:CID', '/content/:CID'])
    if (Array.isArray(path)) {
      path.forEach((p) => {
        if (!seenPaths.has(p + method)) {
          if (p.includes(':')) {
            seenPaths.add(p + method)
            parsedRoutes.push({
              path: p,
              method,
              regex
            })
          }
        }
      })
    } else {
      if (!seenPaths.has(path + method)) {
        if (path.includes(':')) {
          seenPaths.add(path + method)
          parsedRoutes.push({
            path,
            method,
            regex
          })
        }
      }
    }
  }

  // Note: routes that map to the same app logic will be under one key
  // Example: /ipfs/:CID and /content/:CID -> map to /ipfs/#CID
  const regexes = parsedRoutes
    .filter(({ path }) => path.includes(':'))
    .map(({ path, regex }) => ({
      regex,
      path: path.replace(/:/g, '#')
    }))

  function normalizePath(req, opts) {
    const path = promBundle.normalizePath(req, opts)
    try {
      for (const { regex, path: replacerPath } of regexes) {
        const match = path.match(regex)
        if (match) {
          return replacerPath
        }
      }
    } catch (e) {
      req.logger.warn(`Could not match on regex: ${e.message}`)
    }
    return path
  }

  app.use(errorHandler)

  const storagePath = DiskManager.getConfigStoragePath()

  // TODO: Can remove these when all routes consume serviceRegistry
  app.set('storagePath', storagePath)
  app.set('redisClient', serviceRegistry.redis)
  app.set('audiusLibs', serviceRegistry.libs)
  app.set('blacklistManager', serviceRegistry.blacklistManager)
  app.set('trustedNotifierManager', serviceRegistry.trustedNotifierManager)

  // Eventually, all components should pull services off the serviceRegistry
  app.set('serviceRegistry', serviceRegistry)

  // https://expressjs.com/en/guide/behind-proxies.html
  app.set('trust proxy', true)

  const server = app.listen(port, () =>
    logger.info(`Listening on port ${port}...`)
  )

  // Increase from 2min default to accommodate long-lived requests.
  server.setTimeout(config.get('setTimeout'), () => {
    logger.debug(`Server socket timeout hit`)
  })
  server.timeout = config.get('timeout')
  server.keepAliveTimeout = config.get('keepAliveTimeout')
  server.headersTimeout = config.get('headersTimeout')

  return { app: app, server: server }
}

module.exports = initializeApp
