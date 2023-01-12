import { PendingUpdates, startListener, takePending } from './listener'
import { logger } from './logger'
import { setupTriggers } from './setup'
import { getDB } from './conn'
import { program } from 'commander'
import { Knex } from 'knex'
import { AppNotifications } from './appNotifications'

class Processor {

  discoveryDB: Knex
  identityDB: Knex
  appNotifications: AppNotifications

  init = async () => {
    logger.info('starting!')
    // setup postgres listener
    await this.setupDB()
    await setupTriggers(this.discoveryDB)
    await startListener(this.discoveryDB)

    this.appNotifications = new AppNotifications()
  }

  setupDB = async () => {
    const discoveryDBConnection = process.env.DN_DB_URL
    const identityDBConnection = process.env.IDENTITY_DB_URL

    this.discoveryDB = await getDB(discoveryDBConnection)
    this.identityDB = await getDB(identityDBConnection)

  }

  start = async () => {
    // process events
    logger.info('processing events')
    while (true) {
      const pending = takePending()
      if (pending) {

        await Promise.all([
          this.appNotifications.process(pending.appNotifications)
        ])
        logger.info('processed new updates')
      }
      // free up event loop + batch queries to postgres
      await new Promise((r) => setTimeout(r, 500))
    }
  }
}

async function main() {
  try {
    const processor = new Processor()
    await processor.init()
    await processor.start()
  } catch (e) {
    logger.fatal(e, 'save me pm2')
    process.exit(1)
  }
}

main()

process
  .on('unhandledRejection', (reason, promise) => {
    logger.error({ reason, promise }, 'unhandledRejection')
  })
  .on('uncaughtException', (err) => {
    logger.fatal(err, 'uncaughtException')
    process.exit(1)
  })
