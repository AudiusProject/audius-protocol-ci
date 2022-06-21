/* eslint-disable no-unused-expressions */
const chai = require('chai')
const sinon = require('sinon')
const proxyquire = require('proxyquire')
const nock = require('nock')

const { getApp } = require('./lib/app')
const { getLibsMock } = require('./lib/libsMock')

const models = require('../src/models')
const config = require('../src/config')
const {
  SyncType,
  QUEUE_NAMES
} = require('../src/services/stateMachineManager/stateMachineConstants')
const issueSyncRequestJobProcessor = require('../src/services/stateMachineManager/stateReconciliation/issueSyncRequest.jobProcessor')

chai.use(require('sinon-chai'))
chai.use(require('chai-as-promised'))
const { expect } = chai

describe('test issueSyncRequest job processor param validation', function () {
  let server, sandbox, originalContentNodeEndpoint, logger
  beforeEach(async function () {
    const appInfo = await getApp(getLibsMock())
    await appInfo.app.get('redisClient').flushdb()
    server = appInfo.server
    sandbox = sinon.createSandbox()
    config.set('spID', 1)
    originalContentNodeEndpoint = config.get('creatorNodeEndpoint')
    logger = {
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub()
    }
    nock.disableNetConnect()
  })

  afterEach(async function () {
    await server.close()
    sandbox.restore()
    config.set('creatorNodeEndpoint', originalContentNodeEndpoint)
    logger = null
    nock.cleanAll()
    nock.enableNetConnect()
  })

  it('catches bad sync request url', async function () {
    const wallet = '0x123456789'
    const url = '/sync'
    const method = 'post'
    const data = { wallet: [wallet] }
    const syncRequestParameters = {
      // Missing baseURL
      url,
      method,
      data
    }

    const expectedErrorMessage = `Invalid sync data found: ${syncRequestParameters}`

    // Verify job outputs the correct results: sync to user1 to secondary1 because its clock value is behind
    await expect(
      issueSyncRequestJobProcessor({
        logger,
        syncType: 'anyDummyType',
        syncRequestParameters
      })
    ).to.eventually.be.fulfilled.and.deep.equal({
      error: {
        message: expectedErrorMessage
      }
    })
    expect(logger.error).to.have.been.calledOnceWithExactly(
      expectedErrorMessage
    )
  })

  it('catches bad wallet in data', async function () {
    const wallet = '0x123456789'
    const baseURL = 'http://some_cn.co'
    const url = '/sync'
    const method = 'post'
    const data = { wallet } // Bad wallet -- should be an array
    const syncRequestParameters = {
      baseURL,
      url,
      method,
      data
    }

    const expectedErrorMessage = `Invalid sync data wallets (expected non-empty array): ${data.wallet}`

    // Verify job outputs the correct results: sync to user1 to secondary1 because its clock value is behind
    await expect(
      issueSyncRequestJobProcessor({
        logger,
        syncType: 'anyDummyType',
        syncRequestParameters
      })
    ).to.eventually.be.fulfilled.and.deep.equal({
      error: {
        message: expectedErrorMessage
      }
    })
    expect(logger.error).to.have.been.calledOnceWithExactly(
      expectedErrorMessage
    )
  })
})

describe('test issueSyncRequest job processor', function () {
  let server,
    sandbox,
    originalContentNodeEndpoint,
    logger,
    recordSuccessStub,
    recordFailureStub
  beforeEach(async function () {
    const appInfo = await getApp(getLibsMock())
    await appInfo.app.get('redisClient').flushdb()
    server = appInfo.server
    sandbox = sinon.createSandbox()
    config.set('spID', 1)
    originalContentNodeEndpoint = config.get('creatorNodeEndpoint')
    config.set('creatorNodeEndpoint', primary)
    logger = {
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub()
    }
    recordSuccessStub = sandbox.stub().resolves()
    recordFailureStub = sandbox.stub().resolves()
    nock.disableNetConnect()
  })

  afterEach(async function () {
    await server.close()
    sandbox.restore()
    config.set('creatorNodeEndpoint', originalContentNodeEndpoint)
    logger = null
    nock.cleanAll()
    nock.enableNetConnect()
  })

  const syncType = SyncType.Manual
  const primary = 'http://primary_cn.co'
  const wallet = '0x123456789'

  const baseURL = 'http://some_cn.co'
  const url = '/sync'
  const method = 'post'
  const data = { wallet: [wallet] }
  const syncRequestParameters = {
    baseURL,
    url,
    method,
    data
  }

  function getJobProcessorStub({
    getNewOrExistingSyncReqStub,
    getSecondaryUserSyncFailureCountForTodayStub,
    retrieveClockValueForUserFromReplicaStub
  }) {
    return proxyquire(
      '../src/services/stateMachineManager/stateReconciliation/issueSyncRequest.jobProcessor.js',
      {
        '../../../config': config,
        './stateReconciliationUtils': {
          getNewOrExistingSyncReq: getNewOrExistingSyncReqStub
        },
        './SecondarySyncHealthTracker': {
          getSecondaryUserSyncFailureCountForToday:
            getSecondaryUserSyncFailureCountForTodayStub,
          recordSuccess: recordSuccessStub,
          recordFailure: recordFailureStub
        },
        '../stateMachineUtils': {
          retrieveClockValueForUserFromReplica:
            retrieveClockValueForUserFromReplicaStub
        },
        '../stateMachineConstants': {
          SYNC_MONITORING_RETRY_DELAY_MS: 1
        }
      }
    )
  }

  it('issues correct sync when no additional sync is required', async function () {
    const getNewOrExistingSyncReqStub = sandbox.stub().callsFake((args) => {
      throw new Error('getNewOrExistingSyncReq was not expected to be called')
    })

    const getSecondaryUserSyncFailureCountForTodayStub = sandbox
      .stub()
      .returns(0)

    const retrieveClockValueForUserFromReplicaStub = sandbox.stub().resolves(1)

    const issueSyncRequestJobProcessor = getJobProcessorStub({
      getNewOrExistingSyncReqStub,
      getSecondaryUserSyncFailureCountForTodayStub,
      retrieveClockValueForUserFromReplicaStub
    })

    // Make the axios request succeed
    nock(baseURL).post('/sync', data).reply(200)

    // Verify job outputs the correct results: no sync issued (nock will error if the wrong network req was made)
    await expect(
      issueSyncRequestJobProcessor({
        logger,
        syncType,
        syncRequestParameters
      })
    ).to.eventually.be.fulfilled.and.deep.equal({
      error: {},
      jobsToEnqueue: {}
    })
    expect(getNewOrExistingSyncReqStub).to.not.have.been.called
  })

  it('does not issue sync when SecondaryUserSyncFailureCountForToday exceeds threshold', async function () {
    const getNewOrExistingSyncReqStub = sandbox.stub().callsFake((args) => {
      throw new Error('getNewOrExistingSyncReq was not expected to be called')
    })

    // Make sync failure count exceed the threshold
    const failureThreshold = 20
    const failureCount = 21
    config.set('secondaryUserSyncDailyFailureCountThreshold', failureThreshold)
    const getSecondaryUserSyncFailureCountForTodayStub = sandbox
      .stub()
      .returns(failureCount)

    const retrieveClockValueForUserFromReplicaStub = sandbox.stub().resolves(1)

    const issueSyncRequestJobProcessor = getJobProcessorStub({
      getNewOrExistingSyncReqStub,
      getSecondaryUserSyncFailureCountForTodayStub,
      retrieveClockValueForUserFromReplicaStub
    })

    const expectedErrorMessage = `(${syncType}) User ${wallet} | Secondary: ${baseURL} || Secondary has already met SecondaryUserSyncDailyFailureCountThreshold (${failureThreshold}). Will not issue further syncRequests today.`

    // Verify job outputs the correct results: error and no sync issued (nock will error if a network req was made)
    await expect(
      issueSyncRequestJobProcessor({
        logger,
        syncType,
        syncRequestParameters
      })
    ).to.eventually.be.fulfilled.and.deep.equal({
      error: {
        message: expectedErrorMessage
      }
    })
    expect(logger.error).to.have.been.calledOnceWithExactly(
      expectedErrorMessage
    )
    expect(getNewOrExistingSyncReqStub).to.not.have.been.called
  })

  it('requires additional sync when secondary updates clock value but clock value is still behind primary', async function () {
    const primaryClockValue = 5
    const initialSecondaryClockValue = 2
    const finalSecondaryClockValue = 3

    config.set('maxSyncMonitoringDurationInMs', 100)

    const expectedSyncReqToEnqueue = 'expectedSyncReqToEnqueue'
    const getNewOrExistingSyncReqStub = sandbox.stub().callsFake((args) => {
      const { userWallet, secondaryEndpoint, syncType: syncTypeArg } = args
      if (
        userWallet === wallet &&
        secondaryEndpoint === baseURL &&
        syncTypeArg === syncType
      ) {
        return { syncReqToEnqueue: expectedSyncReqToEnqueue }
      }
      throw new Error(
        'getNewOrExistingSyncReq was not expected to be called with the given args'
      )
    })

    const getSecondaryUserSyncFailureCountForTodayStub = sandbox
      .stub()
      .returns(0)

    const retrieveClockValueForUserFromReplicaStub = sandbox
      .stub()
      .resolves(finalSecondaryClockValue)
    retrieveClockValueForUserFromReplicaStub
      .onCall(0)
      .resolves(initialSecondaryClockValue)

    const issueSyncRequestJobProcessor = getJobProcessorStub({
      getNewOrExistingSyncReqStub,
      getSecondaryUserSyncFailureCountForTodayStub,
      retrieveClockValueForUserFromReplicaStub
    })

    sandbox
      .stub(models.CNodeUser, 'findAll')
      .resolves([{ walletPublicKey: wallet, clock: primaryClockValue }])

    // Make the axios request succeed
    nock(baseURL).post('/sync', data).reply(200)

    // Verify job outputs the correct results: an additional sync
    await expect(
      issueSyncRequestJobProcessor({
        logger,
        syncType,
        syncRequestParameters
      })
    ).to.eventually.be.fulfilled.and.deep.equal({
      error: {},
      jobsToEnqueue: {
        [QUEUE_NAMES.STATE_RECONCILIATION]: [expectedSyncReqToEnqueue]
      }
    })
    expect(getNewOrExistingSyncReqStub).to.have.been.calledOnceWithExactly({
      userWallet: wallet,
      secondaryEndpoint: baseURL,
      primaryEndpoint: primary,
      syncType
    })
    expect(
      retrieveClockValueForUserFromReplicaStub.callCount
    ).to.be.greaterThanOrEqual(2)
    expect(recordSuccessStub).to.have.been.calledOnceWithExactly(
      baseURL,
      wallet,
      syncType
    )
    expect(recordFailureStub).to.have.not.been.called
  })

  it("requires additional sync when secondary doesn't update clock during sync", async function () {
    const primaryClockValue = 5
    const finalSecondaryClockValue = 3

    config.set('maxSyncMonitoringDurationInMs', 100)

    const expectedSyncReqToEnqueue = 'expectedSyncReqToEnqueue'
    const getNewOrExistingSyncReqStub = sandbox.stub().callsFake((args) => {
      const { userWallet, secondaryEndpoint, syncType: syncTypeArg } = args
      if (
        userWallet === wallet &&
        secondaryEndpoint === baseURL &&
        syncTypeArg === syncType
      ) {
        return { syncReqToEnqueue: expectedSyncReqToEnqueue }
      }
      throw new Error(
        'getNewOrExistingSyncReq was not expected to be called with the given args'
      )
    })

    const getSecondaryUserSyncFailureCountForTodayStub = sandbox
      .stub()
      .returns(0)

    const retrieveClockValueForUserFromReplicaStub = sandbox
      .stub()
      .resolves(finalSecondaryClockValue)

    const issueSyncRequestJobProcessor = getJobProcessorStub({
      getNewOrExistingSyncReqStub,
      getSecondaryUserSyncFailureCountForTodayStub,
      retrieveClockValueForUserFromReplicaStub
    })

    sandbox
      .stub(models.CNodeUser, 'findAll')
      .resolves([{ walletPublicKey: wallet, clock: primaryClockValue }])

    // Make the axios request succeed
    nock(baseURL).post('/sync', data).reply(200)

    // Verify job outputs the correct results: an additional sync
    await expect(
      issueSyncRequestJobProcessor({
        logger,
        syncType,
        syncRequestParameters
      })
    ).to.eventually.be.fulfilled.and.deep.equal({
      error: {},
      jobsToEnqueue: {
        [QUEUE_NAMES.STATE_RECONCILIATION]: [expectedSyncReqToEnqueue]
      }
    })
    expect(getNewOrExistingSyncReqStub).to.have.been.calledOnceWithExactly({
      userWallet: wallet,
      secondaryEndpoint: baseURL,
      primaryEndpoint: primary,
      syncType
    })
    expect(
      retrieveClockValueForUserFromReplicaStub.callCount
    ).to.be.greaterThanOrEqual(2)
    expect(recordFailureStub).to.have.been.calledOnceWithExactly(
      baseURL,
      wallet,
      syncType
    )
    expect(recordSuccessStub).to.have.not.been.called
  })
})
