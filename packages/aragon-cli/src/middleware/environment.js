const Web3 = require('web3')
const { getTruffleConfig } = require('../helpers/truffle-config')

const FRAME_ENDPOINT = 'ws://localhost:1248'
const FRAME_ORIGIN = 'AragonCLI'
const ARAGON_GATEWAY = {
  protocol: 'https',
  host: 'ipfs.eth.aragon.network',
  port: null,
}

const configureNetwork = (
  argv,
  network,
  truffleConfig = getTruffleConfig()
) => {
  // Catch commands that dont require network and return
  const skipNetworkSubcommands = new Set(['version']) // 'aragon apm version'
  if (argv._.length >= 2) {
    if (skipNetworkSubcommands.has(argv._[1])) {
      return {}
    }
  }
  // TODO remove init when commmand not longer supported
  const skipNetworkCommands = new Set(['init', 'devchain', 'ipfs', 'contracts'])

  if (argv._.length >= 1) {
    if (skipNetworkCommands.has(argv._[0])) {
      return {}
    }
  }

  if (argv.useFrame) {
    const providerOptions = {
      headers: {
        origin: FRAME_ORIGIN,
      },
    }
    return {
      name: `frame-${network}`,
      provider: new Web3.providers.WebsocketProvider(
        FRAME_ENDPOINT,
        providerOptions
      ),
    }
  }

  const truffleNetwork = truffleConfig.networks[network]
  if (!truffleNetwork) {
    throw new Error(
      `aragon <command> requires a network '${network}' in your truffle.js. For an example, see http://truffleframework.com/docs/advanced/configuration`
    )
  }
  let provider
  if (truffleNetwork.provider) {
    if (typeof truffleNetwork.provider === 'function') {
      provider = truffleNetwork.provider()
    } else {
      provider = truffleNetwork.provider
    }
  } else if (truffleNetwork.host && truffleNetwork.port) {
    provider = new Web3.providers.WebsocketProvider(
      `ws://${truffleNetwork.host}:${truffleNetwork.port}`
    )
  } else {
    provider = new Web3.providers.HttpProvider(`http://localhost:8545`)
  }
  truffleNetwork.provider = provider
  truffleNetwork.name = network

  return truffleNetwork
}

// TODO this can be cleaned up once --network is no longer supported
module.exports = function environmentMiddleware(argv) {
  const runsInCwd = argv._[0] === 'init'
  const { reporter, module, apm } = argv
  let { environment, network } = argv

  const isTruffleFwd = argv._[0] === 'contracts'

  if (environment && network && !isTruffleFwd) {
    reporter.error(
      "Arguments '--network' and '--environment' are mutually exclusive. Using '--network'  has been deprecated and  '--environment' should be used instead."
    )
    process.exit(1)
  }

  if (!runsInCwd && module) {
    if (network && module.environments && !isTruffleFwd) {
      reporter.error(
        "Your arapp.json contains an `environments` property. The use of '--network' is deprecated and '--environment' should be used instead."
      )
      process.exit(1)
    }
    if (!module.environments) {
      if (environment) {
        reporter.error(
          "Your arapp.json does not contain an `environments` property. The use of '--environment'  is not supported."
        )
        process.exit(1)
      }
      if (!network) network = 'development'
      return { network: configureNetwork(argv, network) }
    }

    if (!environment) environment = 'default'

    const env = module.environments[environment]

    if (!env) {
      reporter.error(
        `${environment} environment was not defined in your arapp.json.`
      )
      process.exit(1)
    }

    // only include the selected environment in the module
    module.environments = {
      [environment]: env,
    }

    const resp = {
      module: Object.assign({}, module, { appName: env.appName }),
      network: configureNetwork(argv, env.network),
    }

    if (env.registry) {
      resp.apmEnsRegistry = env.registry
      if (apm) {
        apm['ens-registry'] = env.registry
        if (apm.ipfs.rpc.default) {
          apm.ipfs.rpc = ARAGON_GATEWAY
        }
      }
    }

    if (env.wsRPC) {
      resp.wsProvider = new Web3.providers.WebsocketProvider(env.wsRPC)
    }

    return resp
  }

  // if there is no arapp.json and the command is not init default to the "global" config
  // designed for the dao commands including dao acl
  if (!module && !runsInCwd) {
    const defaultEnvironments = require('../../config/environments.default')
    const defaultNetworks = require('../../config/truffle.default')

    let { environment, apm } = argv
    const env = defaultEnvironments[environment || 'aragon:local']

    if (environment && !env) {
      reporter.error(
        `Could not find the ${environment} environment. Try using aragon:local, aragon:rinkeby or aragon:mainnet.`
      )
      process.exit(1)
    }

    reporter.debug(
      `Could not find 'arapp.json'. Using the default configuration to connect to ${
        env.network
      }.`
    )

    if (apm && env.registry) {
      apm['ens-registry'] = env.registry
      if (apm.ipfs.rpc.default) {
        apm.ipfs.rpc = ARAGON_GATEWAY
      }
    }

    return {
      apmEnsRegistry: env.registry,
      network: configureNetwork(argv, env.network, defaultNetworks),
      wsProvider: env.wsRPC && new Web3.providers.WebsocketProvider(env.wsRPC),
    }
  }

  return {}
}
