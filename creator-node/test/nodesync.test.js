const request = require('supertest')
const fs = require('fs-extra')
const path = require('path')
const assert = require('assert')
const _ = require('lodash')
const nock = require('nock')
const sinon = require('sinon')

const config = require('../src/config')
const models = require('../src/models')
const { getApp, getServiceRegistryMock } = require('./lib/app')
const { getLibsMock } = require('./lib/libsMock')
const libsMock = getLibsMock()
const { createStarterCNodeUser, testEthereumConstants, destroyUsers } = require('./lib/dataSeeds')
const BlacklistManager = require('../src/blacklistManager')
const ipfsClient = require('../src/ipfsClient')
const ipfs = ipfsClient.ipfs
const ipfsLatest = ipfsClient.ipfsLatest

const redisClient = require('../src/redis')
const { stringifiedDateFields } = require('./lib/utils')
const processSync = require('../src/services/sync/processSync')
const { uploadTrack } = require('./lib/helpers')

const testAudioFilePath = path.resolve(__dirname, 'testTrack.mp3')
const sampleExportDummyCIDPath = path.resolve(__dirname, 'syncAssets/sampleExportDummyCID.json')
const sampleExportDummyCIDFromClock2Path = path.resolve(__dirname, 'syncAssets/sampleExportDummyCIDFromClock2.json')

describe('test nodesync', async function () {
  let server, app, mockServiceRegistry, userId

  const originalMaxExportClockValueRange = config.get('maxExportClockValueRange')
  let maxExportClockValueRange = originalMaxExportClockValueRange

  userId = 1

  const setupDepsAndApp = async function () {
    const appInfo = await getApp(ipfs, libsMock, BlacklistManager, ipfsLatest, null, userId)
    server = appInfo.server
    app = appInfo.app
    mockServiceRegistry = appInfo.mockServiceRegistry
  }

  /** Wipe DB + Redis */
  beforeEach(async function () {
    try {
      await destroyUsers()
    } catch (e) {
      // do nothing
    }
    await redisClient.flushdb()
  })

  /**
   * Wipe DB, server, and redis state
   */
  afterEach(async function () {
    await sinon.restore()
    await server.close()
  })

  describe('test /export route', async function () {
    let cnodeUserUUID, sessionToken, metadataMultihash, metadataFileUUID, transcodedTrackCID, transcodedTrackUUID, trackSegments, sourceFile
    let trackMetadataMultihash, trackMetadataFileUUID

    const { pubKey } = testEthereumConstants

    const createUserAndTrack = async function () {
      // Create user
      ({ cnodeUserUUID, sessionToken, userId } = await createStarterCNodeUser(userId))

      // Upload user metadata
      const metadata = {
        metadata: {
          testField: 'testValue'
        }
      }
      const userMetadataResp = await request(app)
        .post('/audius_users/metadata')
        .set('X-Session-ID', sessionToken)
        .set('User-Id', userId)
        .send(metadata)
        .expect(200)
      metadataMultihash = userMetadataResp.body.data.metadataMultihash
      metadataFileUUID = userMetadataResp.body.data.metadataFileUUID

      // Associate user with with blockchain ID
      const associateRequest = {
        blockchainUserId: 1,
        metadataFileUUID,
        blockNumber: 10
      }
      await request(app)
        .post('/audius_users')
        .set('X-Session-ID', sessionToken)
        .set('User-Id', userId)
        .send(associateRequest)
        .expect(200)

      /** Upload a track */

      const trackUploadResponse = await uploadTrack(
        testAudioFilePath,
        cnodeUserUUID,
        mockServiceRegistry.blacklistManager
      )

      transcodedTrackUUID = trackUploadResponse.transcodedTrackUUID
      trackSegments = trackUploadResponse.track_segments
      sourceFile = trackUploadResponse.source_file
      transcodedTrackCID = trackUploadResponse.transcodedTrackCID

      // Upload track metadata
      const trackMetadata = {
        metadata: {
          test: 'field1',
          owner_id: 1,
          track_segments: trackSegments
        },
        source_file: sourceFile
      }
      const trackMetadataResp = await request(app)
        .post('/tracks/metadata')
        .set('X-Session-ID', sessionToken)
        .set('User-Id', userId)
        .send(trackMetadata)
        .expect(200)
      trackMetadataMultihash = trackMetadataResp.body.data.metadataMultihash
      trackMetadataFileUUID = trackMetadataResp.body.data.metadataFileUUID

      // associate track + track metadata with blockchain ID
      await request(app)
        .post('/tracks')
        .set('X-Session-ID', sessionToken)
        .set('User-Id', userId)
        .send({
          blockchainTrackId: 1,
          blockNumber: 10,
          metadataFileUUID: trackMetadataFileUUID,
          transcodedTrackUUID
        })
    }

    describe('Confirm export object matches DB state with a user and track', async function () {
      beforeEach(setupDepsAndApp)

      beforeEach(createUserAndTrack)

      it('Test default export', async function () {
        // confirm maxExportClockValueRange > cnodeUser.clock
        const cnodeUserClock = (await models.CNodeUser.findOne({
          where: { cnodeUserUUID },
          raw: true
        })).clock
        assert.ok(cnodeUserClock <= maxExportClockValueRange)

        const { body: exportBody } = await request(app)
          .get(`/export?wallet_public_key=${pubKey.toLowerCase()}`)

        /**
         * Verify
         */

        // Get user metadata
        const userMetadataFile = stringifiedDateFields((await models.File.findOne({
          where: {
            multihash: metadataMultihash,
            fileUUID: metadataFileUUID,
            clock: 1
          },
          raw: true
        })))

        // get transcoded track file
        const copy320 = stringifiedDateFields((await models.File.findOne({
          where: {
            multihash: transcodedTrackCID,
            fileUUID: transcodedTrackUUID,
            type: 'copy320'
          },
          raw: true
        })))

        // get segment files
        const segmentHashes = trackSegments.map(t => t.multihash)
        const segmentFiles = await Promise.all(segmentHashes.map(async (hash, i) => {
          const segment = await models.File.findOne({
            where: {
              multihash: hash,
              type: 'track'
            },
            raw: true
          })
          return stringifiedDateFields(segment)
        }))

        // Get track metadata file
        const trackMetadataFile = stringifiedDateFields(await models.File.findOne({
          where: {
            multihash: trackMetadataMultihash,
            fileUUID: trackMetadataFileUUID,
            clock: 36
          },
          raw: true
        }))

        // get audiusUser
        const audiusUser = stringifiedDateFields(await models.AudiusUser.findOne({
          where: {
            metadataFileUUID,
            clock: 2
          },
          raw: true
        }))

        // get cnodeUser
        const cnodeUser = stringifiedDateFields(await models.CNodeUser.findOne({
          where: {
            cnodeUserUUID
          },
          raw: true
        }))

        // get clock records
        const clockRecords = (await models.ClockRecord.findAll({
          where: { cnodeUserUUID },
          raw: true
        })).map(stringifiedDateFields)

        // get track file
        const trackFile = stringifiedDateFields(await models.Track.findOne({
          where: {
            cnodeUserUUID,
            metadataFileUUID: trackMetadataFileUUID
          },
          raw: true
        }))

        const clockInfo = {
          localClockMax: cnodeUser.clock,
          requestedClockRangeMin: 0,
          requestedClockRangeMax: maxExportClockValueRange - 1
        }

        // construct the expected response
        const expectedData = {
          [cnodeUserUUID]: {
            ...cnodeUser,
            audiusUsers: [
              audiusUser
            ],
            tracks: [trackFile],
            files: [userMetadataFile, copy320, ...segmentFiles, trackMetadataFile],
            clockRecords,
            clockInfo
          }
        }

        // compare exported data
        const exportedUserData = exportBody.data.cnodeUsers
        assert.deepStrictEqual(clockRecords.length, cnodeUserClock)
        assert.deepStrictEqual(exportedUserData, expectedData)
      })
    })

    describe('Confirm export works for user with data exceeding maxExportClockValueRange', async function () {
      /**
       * override maxExportClockValueRange to smaller value for testing
       */
      beforeEach(async function () {
        maxExportClockValueRange = 10
        process.env.maxExportClockValueRange = maxExportClockValueRange
      })

      beforeEach(setupDepsAndApp)

      beforeEach(createUserAndTrack)

      /**
       * unset maxExportClockValueRange
       */
      afterEach(async function () {
        delete process.env.maxExportClockValueRange
      })

      it('Export from clock = 0', async function () {
        const requestedClockRangeMin = 0
        const requestedClockRangeMax = (maxExportClockValueRange - 1)

        // confirm maxExportClockValueRange < cnodeUser.clock
        const cnodeUserClock = (await models.CNodeUser.findOne({
          where: { cnodeUserUUID },
          raw: true
        })).clock
        assert.ok(cnodeUserClock > maxExportClockValueRange)

        const { body: exportBody } = await request(app)
          .get(`/export?wallet_public_key=${pubKey.toLowerCase()}`)

        /**
         * Verify
         */

        // get cnodeUser
        const cnodeUser = stringifiedDateFields(await models.CNodeUser.findOne({
          where: {
            cnodeUserUUID
          },
          raw: true
        }))
        cnodeUser.clock = requestedClockRangeMax

        // get clockRecords
        const clockRecords = (await models.ClockRecord.findAll({
          where: {
            cnodeUserUUID,
            clock: {
              [models.Sequelize.Op.lte]: requestedClockRangeMax
            }
          },
          order: [['clock', 'ASC']],
          raw: true
        })).map(stringifiedDateFields)

        // Get audiusUsers
        const audiusUsers = (await models.AudiusUser.findAll({
          where: {
            cnodeUserUUID,
            clock: {
              [models.Sequelize.Op.lte]: requestedClockRangeMax
            }
          },
          order: [['clock', 'ASC']],
          raw: true
        })).map(stringifiedDateFields)

        // get tracks
        const tracks = (await models.Track.findAll({
          where: {
            cnodeUserUUID,
            clock: {
              [models.Sequelize.Op.lte]: requestedClockRangeMax
            }
          },
          order: [['clock', 'ASC']],
          raw: true
        })).map(stringifiedDateFields)

        // get files
        const files = (await models.File.findAll({
          where: {
            cnodeUserUUID,
            clock: {
              [models.Sequelize.Op.lte]: requestedClockRangeMax
            }
          },
          order: [['clock', 'ASC']],
          raw: true
        })).map(stringifiedDateFields)

        const clockInfo = {
          requestedClockRangeMin,
          requestedClockRangeMax,
          localClockMax: requestedClockRangeMax
        }

        // construct the expected response
        const expectedData = {
          [cnodeUserUUID]: {
            ...cnodeUser,
            audiusUsers,
            tracks,
            files,
            clockRecords,
            clockInfo
          }
        }

        // compare exported data
        const exportedUserData = exportBody.data.cnodeUsers
        assert.deepStrictEqual(exportedUserData, expectedData)
        // when requesting from 0, exported data set is 1 less than expected range since clock values are 1-indexed
        assert.deepStrictEqual(clockRecords.length, maxExportClockValueRange - 1)
      })

      it('Export from clock = 10', async function () {
        const clockRangeMin = 10
        const requestedClockRangeMin = clockRangeMin
        const requestedClockRangeMax = clockRangeMin + (maxExportClockValueRange - 1)

        // confirm maxExportClockValueRange < cnodeUser.clock
        const cnodeUserClock = (await models.CNodeUser.findOne({
          where: { cnodeUserUUID },
          raw: true
        })).clock
        assert.ok(cnodeUserClock > maxExportClockValueRange)

        const { body: exportBody } = await request(app)
          .get(`/export?wallet_public_key=${pubKey.toLowerCase()}&clock_range_min=${requestedClockRangeMin}`)

        /**
         * Verify
         */

        // get cnodeUser
        const cnodeUser = stringifiedDateFields(await models.CNodeUser.findOne({
          where: {
            cnodeUserUUID
          },
          raw: true
        }))
        cnodeUser.clock = requestedClockRangeMax

        // get clockRecords
        const clockRecords = (await models.ClockRecord.findAll({
          where: {
            cnodeUserUUID,
            clock: {
              [models.Sequelize.Op.gte]: requestedClockRangeMin,
              [models.Sequelize.Op.lte]: requestedClockRangeMax
            }
          },
          order: [['clock', 'ASC']],
          raw: true
        })).map(stringifiedDateFields)

        // Get audiusUsers
        const audiusUsers = (await models.AudiusUser.findAll({
          where: {
            cnodeUserUUID,
            clock: {
              [models.Sequelize.Op.gte]: requestedClockRangeMin,
              [models.Sequelize.Op.lte]: requestedClockRangeMax
            }
          },
          order: [['clock', 'ASC']],
          raw: true
        })).map(stringifiedDateFields)

        // get tracks
        const tracks = (await models.Track.findAll({
          where: {
            cnodeUserUUID,
            clock: {
              [models.Sequelize.Op.gte]: requestedClockRangeMin,
              [models.Sequelize.Op.lte]: requestedClockRangeMax
            }
          },
          order: [['clock', 'ASC']],
          raw: true
        })).map(stringifiedDateFields)

        // get files
        const files = (await models.File.findAll({
          where: {
            cnodeUserUUID,
            clock: {
              [models.Sequelize.Op.gte]: requestedClockRangeMin,
              [models.Sequelize.Op.lte]: requestedClockRangeMax
            }
          },
          order: [['clock', 'ASC']],
          raw: true
        })).map(stringifiedDateFields)

        const clockInfo = {
          requestedClockRangeMin,
          requestedClockRangeMax,
          localClockMax: requestedClockRangeMax
        }

        // construct the expected response
        const expectedData = {
          [cnodeUserUUID]: {
            ...cnodeUser,
            audiusUsers,
            tracks,
            files,
            clockRecords,
            clockInfo
          }
        }

        // compare exported data
        const exportedUserData = exportBody.data.cnodeUsers
        assert.deepStrictEqual(exportedUserData, expectedData)
        assert.deepStrictEqual(clockRecords.length, maxExportClockValueRange)
      })

      it('Export from clock = 30 where range exceeds final value', async function () {
        const clockRangeMin = 30
        const requestedClockRangeMin = clockRangeMin
        const requestedClockRangeMax = clockRangeMin + (maxExportClockValueRange - 1)

        // confirm cnodeUser.clock < (requestedClockRangeMin + maxExportClockValueRange)
        const cnodeUserClock = (await models.CNodeUser.findOne({
          where: { cnodeUserUUID },
          raw: true
        })).clock
        assert.ok(cnodeUserClock < (requestedClockRangeMin + maxExportClockValueRange))

        const { body: exportBody } = await request(app)
          .get(`/export?wallet_public_key=${pubKey.toLowerCase()}&clock_range_min=${requestedClockRangeMin}`)

        /**
         * Verify
         */

        // get cnodeUser
        const cnodeUser = stringifiedDateFields(await models.CNodeUser.findOne({
          where: {
            cnodeUserUUID
          },
          raw: true
        }))
        cnodeUser.clock = Math.min(cnodeUser.clock, requestedClockRangeMax)

        // get clockRecords
        const clockRecords = (await models.ClockRecord.findAll({
          where: {
            cnodeUserUUID,
            clock: {
              [models.Sequelize.Op.gte]: requestedClockRangeMin,
              [models.Sequelize.Op.lte]: requestedClockRangeMax
            }
          },
          order: [['clock', 'ASC']],
          raw: true
        })).map(stringifiedDateFields)

        // Get audiusUsers
        const audiusUsers = (await models.AudiusUser.findAll({
          where: {
            cnodeUserUUID,
            clock: {
              [models.Sequelize.Op.gte]: requestedClockRangeMin,
              [models.Sequelize.Op.lte]: requestedClockRangeMax
            }
          },
          order: [['clock', 'ASC']],
          raw: true
        })).map(stringifiedDateFields)

        // get tracks
        const tracks = (await models.Track.findAll({
          where: {
            cnodeUserUUID,
            clock: {
              [models.Sequelize.Op.gte]: requestedClockRangeMin,
              [models.Sequelize.Op.lte]: requestedClockRangeMax
            }
          },
          order: [['clock', 'ASC']],
          raw: true
        })).map(stringifiedDateFields)

        // get files
        const files = (await models.File.findAll({
          where: {
            cnodeUserUUID,
            clock: {
              [models.Sequelize.Op.gte]: requestedClockRangeMin,
              [models.Sequelize.Op.lte]: requestedClockRangeMax
            }
          },
          order: [['clock', 'ASC']],
          raw: true
        })).map(stringifiedDateFields)

        const clockInfo = {
          requestedClockRangeMin,
          requestedClockRangeMax,
          localClockMax: cnodeUser.clock
        }

        // construct the expected response
        const expectedData = {
          [cnodeUserUUID]: {
            ...cnodeUser,
            audiusUsers,
            tracks,
            files,
            clockRecords,
            clockInfo
          }
        }

        // compare exported data
        const exportedUserData = exportBody.data.cnodeUsers
        assert.deepStrictEqual(exportedUserData, expectedData)
        assert.deepStrictEqual(clockRecords.length, cnodeUser.clock - requestedClockRangeMin + 1)
      })
    })
  })

  describe('Test processSync function', async function () {
    let serviceRegistryMock

    const TEST_ENDPOINT = 'http://test-cn.co'
    const { pubKey } = testEthereumConstants
    const userWallets = [pubKey.toLowerCase()]

    const createUser = async function () {
      // Create user
      const session = await createStarterCNodeUser(userId)

      // Upload user metadata
      const metadata = {
        metadata: {
          testField: 'testValue'
        }
      }
      const userMetadataResp = await request(app)
        .post('/audius_users/metadata')
        .set('X-Session-ID', session.sessionToken)
        .set('User-Id', session.userId)
        .send(metadata)
        .expect(200)

      const metadataFileUUID = userMetadataResp.body.data.metadataFileUUID

      // Associate user with with blockchain ID
      const associateRequest = {
        blockchainUserId: 1,
        metadataFileUUID,
        blockNumber: 10
      }
      await request(app)
        .post('/audius_users')
        .set('X-Session-ID', session.sessionToken)
        .set('User-Id', session.userId)
        .send(associateRequest)
        .expect(200)

      return session.cnodeUserUUID
    }

    /**
     * Setup deps + mocks + app
     */
    beforeEach(async function () {
      nock.cleanAll()

      maxExportClockValueRange = originalMaxExportClockValueRange
      process.env.maxExportClockValueRange = maxExportClockValueRange

      // Mock ipfs.swarm.connect() function for test purposes
      ipfsClient.ipfs.swarm.connect = async function () { return { 'Strings': [] } }

      const appInfo = await getApp(ipfsClient.ipfs, libsMock, BlacklistManager, ipfsClient.ipfsLatest, null, userId)
      server = appInfo.server
      app = appInfo.app

      serviceRegistryMock = getServiceRegistryMock(ipfsClient.ipfs, libsMock, BlacklistManager, ipfsClient.ipfsLatest)
    })

    it('Syncs correctly from clean user state with mocked export object', async function () {
      // Unpack sample export data
      const sampleExport = JSON.parse(fs.readFileSync(sampleExportDummyCIDPath))
      const cnodeUser = Object.values(sampleExport.data.cnodeUsers)[0]
      const audiusUser = cnodeUser.audiusUsers[0]
      const { tracks, files, clockRecords, clockInfo } = cnodeUser

      // Mock /export route response
      nock(TEST_ENDPOINT)
        .persist()
        .get(uri => uri.includes('/export'))
        .reply(200, sampleExport)

      // This text 'audius is cool' is mapped to the hash in the dummy json data
      // If changes are made to the response body, make the corresponding changes to the hash too
      nock('http://mock-cn1.audius.co')
        .persist()
        .get(uri => uri.includes('/ipfs/QmSU6rdPHdTrVohDSfhVCBiobTMr6a3NvPz4J7nLWVDvmE'))
        .reply(200, 'audius is cool')

      nock('http://mock-cn2.audius.co')
        .persist()
        .get(uri => uri.includes('/ipfs/QmSU6rdPHdTrVohDSfhVCBiobTMr6a3NvPz4J7nLWVDvmE'))
        .reply(200, 'audius is cool')

      nock('http://mock-cn3.audius.co')
        .persist()
        .get(uri => uri.includes('/ipfs/QmSU6rdPHdTrVohDSfhVCBiobTMr6a3NvPz4J7nLWVDvmE'))
        .reply(200, 'audius is cool')

      // Confirm no local user state before sync
      const initialCNodeUserCount = await models.CNodeUser.count()
      assert.strictEqual(initialCNodeUserCount, 0)

      // Take data from TEST_ENDPOINT for export with userWallets and adds data to node running code
      await processSync(serviceRegistryMock, userWallets, TEST_ENDPOINT)

      const exportedCnodeUser = {
        walletPublicKey: cnodeUser.walletPublicKey,
        lastLogin: cnodeUser.lastLogin,
        latestBlockNumber: cnodeUser.latestBlockNumber,
        clock: cnodeUser.clock,
        createdAt: cnodeUser.createdAt
      }

      // verify CNodeUser
      const localCNodeUser = stringifiedDateFields(await models.CNodeUser.findOne({
        where: {
          walletPublicKey: cnodeUser.walletPublicKey
        },
        raw: true
      }))
      assert.deepStrictEqual(
        _.omit(localCNodeUser, ['cnodeUserUUID', 'updatedAt']),
        exportedCnodeUser
      )

      const cnodeUserUUID = localCNodeUser.cnodeUserUUID

      // verify AudiusUser
      const localAudiusUser = stringifiedDateFields(await models.AudiusUser.findOne({
        where: {
          cnodeUserUUID,
          clock: audiusUser.clock
        },
        raw: true
      }))
      assert.deepStrictEqual(
        _.omit(localAudiusUser, ['cnodeUserUUID']),
        _.omit(audiusUser, ['cnodeUserUUID'])
      )

      // TODO verify: expected files are all on disc

      // verify clock records
      for (let exportedRecord of clockRecords) {
        const { clock, sourceTable, createdAt, updatedAt } = exportedRecord
        const localRecord = stringifiedDateFields(await models.ClockRecord.findOne({
          where: {
            clock,
            cnodeUserUUID,
            sourceTable,
            createdAt,
            updatedAt
          },
          raw: true
        }))
        assert.deepStrictEqual(
          _.omit(localRecord, ['cnodeUserUUID']),
          _.omit(exportedRecord, ['cnodeUserUUID'])
        )
      }

      // verify files
      for (let exportedFile of files) {
        const { fileUUID, multihash, clock } = exportedFile
        const localFile = stringifiedDateFields(await models.File.findOne({
          where: {
            clock,
            cnodeUserUUID,
            multihash,
            fileUUID
          },
          raw: true
        }))
        assert.deepStrictEqual(
          _.omit(localFile, ['cnodeUserUUID']),
          _.omit(exportedFile, ['cnodeUserUUID'])
        )
      }

      // verify tracks
      for (let exportedTrack of tracks) {
        const { clock, blockchainId, metadataFileUUID } = exportedTrack
        const localFile = stringifiedDateFields(await models.Track.findOne({
          where: {
            clock,
            cnodeUserUUID,
            blockchainId,
            metadataFileUUID
          },
          raw: true
        }))
        assert.deepStrictEqual(
          _.omit(localFile, ['cnodeUserUUID']),
          _.omit(exportedTrack, ['cnodeUserUUID'])
        )
      }

      // verify clockInfo
      const localClockInfo = {
        requestedClockRangeMin: 0,
        requestedClockRangeMax: 0 + (maxExportClockValueRange - 1),
        localClockMax: localCNodeUser.clock
      }
      assert.deepStrictEqual(localClockInfo, clockInfo)
    })

    it('Syncs correctly when cnodeUser data already exists locally', async function () {
      // Get the saved export
      const sampleExport = JSON.parse(fs.readFileSync(sampleExportDummyCIDFromClock2Path))
      const cnodeUser = Object.values(sampleExport.data.cnodeUsers)[0]
      const audiusUser = cnodeUser.audiusUsers[0]
      const { tracks, files, clockRecords, clockInfo } = cnodeUser

      // Setup mocked responses
      nock(TEST_ENDPOINT)
        .persist()
        .get(uri => uri.includes('/export'))
        .reply(200, sampleExport)

      // This text 'audius is cool' is mapped to the hash in the dummy json data
      // If changes are made to the response body, make the corresponding changes to the hash too
      nock('http://mock-cn1.audius.co')
        .persist()
        .get(uri => uri.includes('/ipfs/QmSU6rdPHdTrVohDSfhVCBiobTMr6a3NvPz4J7nLWVDvmE'))
        .reply(200, 'audius is cool')

      nock('http://mock-cn2.audius.co')
        .persist()
        .get(uri => uri.includes('/ipfs/QmSU6rdPHdTrVohDSfhVCBiobTMr6a3NvPz4J7nLWVDvmE'))
        .reply(200, 'audius is cool')

      nock('http://mock-cn3.audius.co')
        .persist()
        .get(uri => uri.includes('/ipfs/QmSU6rdPHdTrVohDSfhVCBiobTMr6a3NvPz4J7nLWVDvmE'))
        .reply(200, 'audius is cool')

      // Confirm initial local state is empty
      let initialCNodeUserCount = await models.CNodeUser.count()
      assert.strictEqual(initialCNodeUserCount, 0)

      // seed user state locally with different cnodeUserUUID
      const cnodeUserUUID = await createUser()

      // Confirm user state exists locally before sync
      const localCNodeUsersBeforeSync = await models.CNodeUser.findAll({
        where: { cnodeUserUUID },
        raw: true
      })
      assert.strictEqual(localCNodeUsersBeforeSync.length, 1)
      const localCNodeUserBeforeSync = stringifiedDateFields(localCNodeUsersBeforeSync[0])

      // test: sync
      await processSync(serviceRegistryMock, userWallets, TEST_ENDPOINT)

      const exportedCnodeUser = {
        walletPublicKey: cnodeUser.walletPublicKey,
        lastLogin: cnodeUser.lastLogin,
        latestBlockNumber: cnodeUser.latestBlockNumber,
        clock: cnodeUser.clock,
        createdAt: cnodeUser.createdAt
      }

      // verify CNodeUser
      const localCNodeUser = stringifiedDateFields(await models.CNodeUser.findOne({
        where: {
          cnodeUserUUID,
          walletPublicKey: cnodeUser.walletPublicKey
        },
        raw: true
      }))
      assert.deepStrictEqual(
        _.omit(localCNodeUser, ['cnodeUserUUID', 'updatedAt']),
        exportedCnodeUser
      )

      // verify AudiusUser
      const localAudiusUser = undefined
      assert.deepStrictEqual(localAudiusUser, audiusUser)

      // TODO verify: expected files are all on disc

      // verify clock records
      for (let exportedRecord of clockRecords) {
        const { clock, sourceTable, createdAt, updatedAt } = exportedRecord
        const localRecord = stringifiedDateFields(await models.ClockRecord.findOne({
          where: {
            clock,
            cnodeUserUUID,
            sourceTable,
            createdAt,
            updatedAt
          },
          raw: true
        }))
        assert.deepStrictEqual(
          _.omit(localRecord, ['cnodeUserUUID']),
          _.omit(exportedRecord, ['cnodeUserUUID'])
        )
      }

      // verify files
      for (let exportedFile of files) {
        const { fileUUID, multihash, clock } = exportedFile
        const localFile = stringifiedDateFields(await models.File.findOne({
          where: {
            clock,
            cnodeUserUUID,
            multihash,
            fileUUID
          },
          raw: true
        }))
        assert.deepStrictEqual(
          _.omit(localFile, ['cnodeUserUUID']),
          _.omit(exportedFile, ['cnodeUserUUID'])
        )
      }

      // verify tracks
      for (let exportedTrack of tracks) {
        const { clock, blockchainId, metadataFileUUID } = exportedTrack
        const localFile = stringifiedDateFields(await models.Track.findOne({
          where: {
            clock,
            cnodeUserUUID,
            blockchainId,
            metadataFileUUID
          },
          raw: true
        }))
        assert.deepStrictEqual(
          _.omit(localFile, ['cnodeUserUUID']),
          _.omit(exportedTrack, ['cnodeUserUUID'])
        )
      }

      // verify clockInfo
      const localClockInfo = {
        requestedClockRangeMin: localCNodeUserBeforeSync.clock + 1,
        requestedClockRangeMax: (localCNodeUserBeforeSync.clock + 1) + (maxExportClockValueRange - 1),
        localClockMax: localCNodeUser.clock
      }
      assert.deepStrictEqual(localClockInfo, clockInfo)
    })
  })
})
