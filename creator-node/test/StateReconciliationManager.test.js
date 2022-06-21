/* eslint-disable no-unused-expressions */
const nock = require('nock')
const chai = require('chai')
const sinon = require('sinon')
const { expect } = chai
const proxyquire = require('proxyquire')
const BullQueue = require('bull')

const { getApp } = require('./lib/app')
const { getLibsMock } = require('./lib/libsMock')

const config = require('../src/config')
const StateReconciliationManager = require('../src/services/stateMachineManager/stateReconciliation')
const {
  QUEUE_NAMES,
  SyncType
} = require('../src/services/stateMachineManager/stateMachineConstants')

chai.use(require('sinon-chai'))
chai.use(require('chai-as-promised'))

describe('test StateReconciliationManager initialization, events, and job processors', function () {
  let server, sandbox
  beforeEach(async function () {
    const appInfo = await getApp(getLibsMock())
    await appInfo.app.get('redisClient').flushdb()
    server = appInfo.server
    sandbox = sinon.createSandbox()

    nock.disableNetConnect()
  })

  afterEach(async function () {
    await server.close()
    nock.cleanAll()
    nock.enableNetConnect()
    sandbox.restore()
  })

  function getProcessJobMock() {
    const loggerStub = {
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub()
    }
    const createChildLogger = sandbox.stub().returns(loggerStub)
    const processJobMock = proxyquire(
      '../src/services/stateMachineManager/processJob.js',
      {
        '../../logging': {
          createChildLogger
        }
      }
    )
    return { processJobMock, loggerStub }
  }

  it('creates the queue and registers its event handlers', async function () {
    // Initialize StateReconciliationManager and spy on its registerQueueEventHandlersAndJobProcessors function
    const stateReconciliationManager = new StateReconciliationManager()
    sandbox.spy(
      stateReconciliationManager,
      'registerQueueEventHandlersAndJobProcessors'
    )
    const queue = await stateReconciliationManager.init()

    // Verify that the queue was successfully initialized and that its event listeners were registered
    expect(queue).to.exist.and.to.be.instanceOf(BullQueue)
    expect(
      stateReconciliationManager.registerQueueEventHandlersAndJobProcessors
    ).to.have.been.calledOnce
    expect(
      stateReconciliationManager.registerQueueEventHandlersAndJobProcessors.getCall(
        0
      ).args[0]
    )
      .to.have.property('queue')
      .that.has.deep.property('name', QUEUE_NAMES.STATE_RECONCILIATION)
  })

  it('processes manual sync jobs with expected data and returns the expected results', async function () {
    // Mock StateReconciliationManager to have issueSyncRequest job processor return dummy data and mocked processJob util
    const expectedResult = { test: 'test' }
    const issueSyncReqStub = sandbox.stub().resolves(expectedResult)
    const { processJobMock, loggerStub } = getProcessJobMock()
    const MockStateReconciliationManager = proxyquire(
      '../src/services/stateMachineManager/stateReconciliation/index.js',
      {
        './issueSyncRequest.jobProcessor': issueSyncReqStub,
        '../processJob': processJobMock
      }
    )

    // Verify that StateReconciliationManager returns our dummy data
    const job = {
      id: 9,
      data: {
        syncType: SyncType.MANUAL,
        syncRequestParameters: 'test'
      }
    }
    await expect(
      new MockStateReconciliationManager().processManualSyncJob(job)
    ).to.eventually.be.fulfilled.and.deep.equal(expectedResult)
    expect(issueSyncReqStub).to.have.been.calledOnceWithExactly({
      logger: loggerStub,
      syncType: SyncType.MANUAL,
      syncRequestParameters: 'test'
    })
  })

  it('processes recurring sync jobs with expected data and returns the expected results', async function () {
    // Mock StateReconciliationManager to have issueSyncRequest job processor return dummy data and mocked processJob util
    const expectedResult = { test: 'test' }
    const issueSyncReqStub = sandbox.stub().resolves(expectedResult)
    const { processJobMock, loggerStub } = getProcessJobMock()
    const MockStateReconciliationManager = proxyquire(
      '../src/services/stateMachineManager/stateReconciliation/index.js',
      {
        './issueSyncRequest.jobProcessor': issueSyncReqStub,
        '../processJob': processJobMock
      }
    )

    // Verify that StateReconciliationManager returns our dummy data
    const job = {
      id: 9,
      data: {
        syncType: SyncType.RECURRING,
        syncRequestParameters: 'test'
      }
    }
    await expect(
      new MockStateReconciliationManager().processRecurringSyncJob(job)
    ).to.eventually.be.fulfilled.and.deep.equal(expectedResult)
    expect(issueSyncReqStub).to.have.been.calledOnceWithExactly({
      logger: loggerStub,
      syncType: SyncType.MANUAL,
      syncRequestParameters: 'test'
    })
  })

  it('processes updateReplicaSet jobs with expected data and returns the expected results', async function () {
    // Mock StateReconciliationManager to have updateReplicaSet job processor return dummy data and mocked processJob util
    const expectedResult = { test: 'test' }
    const issueSyncReqStub = sandbox.stub().resolves(expectedResult)
    const { processJobMock, loggerStub } = getProcessJobMock()
    const MockStateReconciliationManager = proxyquire(
      '../src/services/stateMachineManager/stateReconciliation/index.js',
      {
        './updateReplicaSet.jobProcessor': issueSyncReqStub,
        '../processJob': processJobMock
      }
    )

    // Verify that StateReconciliationManager returns our dummy data
    const wallet = '0x123456789'
    const userId = 1
    const primary = 'http://cn1.co'
    const secondary1 = 'http://cn2.co'
    const secondary2 = 'http://cn3.co'
    const unhealthyReplicas = ['test']
    const replicaSetNodesToUserClockStatusesMap = { test: 'test' }
    const enabledReconfigModes = ['test1']
    const job = {
      id: 9,
      data: {
        wallet,
        userId,
        primary,
        secondary1,
        secondary2,
        unhealthyReplicas,
        replicaSetNodesToUserClockStatusesMap,
        enabledReconfigModes
      }
    }
    await expect(
      new MockStateReconciliationManager().processUpdateReplicaSetJob(job)
    ).to.eventually.be.fulfilled.and.deep.equal(expectedResult)
    expect(issueSyncReqStub).to.have.been.calledOnceWithExactly({
      logger: loggerStub,
      wallet,
      userId,
      primary,
      secondary1,
      secondary2,
      unhealthyReplicas,
      replicaSetNodesToUserClockStatusesMap,
      enabledReconfigModes
    })
  })
})
