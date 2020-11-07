const assert = require('assert')
const sinon = require('sinon')

const config = require('../src/config')

describe.only('test txRelay: fundRelayerIfEmpty() [staging/production logic]', () => {
  const stagingPOASokolUrl = 'https://poa-gateway.staging.audius.co/'
  const relayerPublicKey = '0xaaaa90Fc2bfa70028D6b444BB9754066d9E2703b'
  const relayerPrivateKey = '34efbbc0431c7f481cdba15d65bbc9ef47196b9cf38d5c4b30afa2bcf86fafba'
  let relayerWallets, fundRelayerIfEmpty, web3

  before(() => {
    // Used for actual utility
    const Web3 = require('web3')
    web3 = new Web3(stagingPOASokolUrl)
  })

  beforeEach(() => {
    // Mock staging environment
    relayerWallets = [
      {
        publicKey: '0xbbbb3B55Dcc7b4a3a5217d2d84F1EFDE86bB8104',
        privateKey: '804fa1256049eac5d350afa7629a275d1c585042e96d88069715226ebd497d53'
      },
      {
        publicKey: '0xaC0aDb2ef3153b216652F74B8b4489876cC344B1',
        privateKey: '897c3e1fd24b5936a60039927d2784911a08b97b06d56fb6da019ccffc5df5ce'
      }
    ]

    // In order to stub one config call, must stub everything else too
    sinon.stub(config, 'get').callsFake(key => {
      switch (key) {
        case 'relayerPublicKey':
          return relayerPublicKey
        case 'relayerPrivateKey':
          return relayerPrivateKey
        case 'relayerWallets':
          return relayerWallets
        case 'environment':
          return 'staging'
        case 'web3Provider':
          return stagingPOASokolUrl
        case 'secondaryWeb3Provider':
          return stagingPOASokolUrl
        case 'minGasPrice':
          return 10 * Math.pow(10, 9)
        case 'highGasPrice':
          return 25 * Math.pow(10, 9)
        case 'ganacheGasPrice':
          return 39062500000
        case 'defaultGasLimit':
          return '0xf7100'
        case 'minimumBalance':
          return 1 // arbitrary
      }
    })

    // Create these instances after stubbing config
    const primaryWeb3 = require('../src/web3').primaryWeb3
    sinon.stub(primaryWeb3.eth, 'getBalance').returns(0)
    fundRelayerIfEmpty = require('../src/txRelay').fundRelayerIfEmpty
  })

  afterEach(() => {
    sinon.restore()
  })

  it('should transfer funds from relayerPublicKey to receivers (relayerWallets)', async () => {
    const acc0InitialBalance = await web3.eth.getBalance(relayerWallets[0].publicKey)
    const acc1InitialBalance = await web3.eth.getBalance(relayerWallets[1].publicKey)
    const relayerInitialBalance = await web3.eth.getBalance(relayerPublicKey)

    await fundRelayerIfEmpty()

    const acc0BumpedBalance = await web3.eth.getBalance(relayerWallets[0].publicKey)
    const acc1BumpedBalance = await web3.eth.getBalance(relayerWallets[1].publicKey)
    const relayerDecreasedBalance = await web3.eth.getBalance(relayerPublicKey)

    console.log('pls')
    console.log(`${acc0InitialBalance}:${acc0BumpedBalance}`)
    console.log(`${acc1InitialBalance}:${acc1BumpedBalance}`)
    console.log(`${relayerInitialBalance}:${relayerDecreasedBalance}`)

    assert(acc0InitialBalance < acc0BumpedBalance)
    assert(acc1InitialBalance < acc1BumpedBalance)
    assert(relayerInitialBalance > relayerDecreasedBalance)
  }).timeout(20000)
})
