// nodeN.json for one Classic shard. Written only under the wallet data dir.
// The P2P key is generated here. Existing node keys elsewhere on the machine
// (for example ~/.scdo) are never opened.
'use strict'
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const SECP256K1_N = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141')

// Production peers (cmd/node/config/nodeN.json). Port 8058 is shard 2's P2P port;
// each host is also listed on 8057 / 8059 / 8056 so a node can reach every shard.
const PEER_HOSTS = ['217.160.65.210', '82.223.19.88', '74.208.136.152', '74.208.207.184']
const PEER_PORTS = [8057, 8058, 8059, 8056]

const SHARD_PORTS = {
  1: { p2p: 8057, rpc: 8027, http: 8037, ws: 8047, metrics: 8087 },
  2: { p2p: 8058, rpc: 8028, http: 8038, ws: 8048, metrics: 8088 },
  3: { p2p: 8059, rpc: 8029, http: 8039, ws: 8049, metrics: 8089 },
  4: { p2p: 8056, rpc: 8026, http: 8036, ws: 8046, metrics: 8086 }
}

function staticNodes () {
  const out = []
  for (const host of PEER_HOSTS) for (const port of PEER_PORTS) out.push(host + ':' + port)
  return out
}

function newP2PKey () {
  for (;;) {
    const buf = crypto.randomBytes(32)
    const n = BigInt('0x' + buf.toString('hex'))
    if (n > 0n && n < SECP256K1_N) return '0x' + buf.toString('hex')
  }
}

function insideDir (parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child))
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel))
}

function readOrCreateKey (file) {
  try {
    const cur = fs.readFileSync(file, 'utf8').trim()
    if (/^0x[0-9a-fA-F]{64}$/.test(cur)) return cur
  } catch (e) { /* first launch */ }
  const key = newP2PKey()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, key + '\n', { mode: 0o600 })
  try { fs.chmodSync(file, 0o600) } catch (e) {}
  return key
}

function buildNodeConfig (opts) {
  const shard = Number(opts.shard)
  const ports = SHARD_PORTS[shard]
  if (!ports) {
    const err = new Error('classic node shard must be 1, 2, 3 or 4')
    err.code = 'BAD_SHARD'
    throw err
  }
  if (!opts.coinbase) {
    const err = new Error('coinbase address is required')
    err.code = 'BAD_ADDRESS'
    throw err
  }
  if (!opts.dataDir || !path.isAbsolute(opts.dataDir)) {
    const err = new Error('classic node dataDir must be an absolute path inside the wallet data dir')
    err.code = 'BAD_DATADIR'
    throw err
  }
  if (!opts.p2pKey || !/^0x[0-9a-fA-F]{64}$/.test(opts.p2pKey)) {
    const err = new Error('p2p key must be a fresh 0x + 32-byte hex key')
    err.code = 'BAD_KEY'
    throw err
  }
  // basic.privateKey is the coinbase signing key. Leave it unset: rewards go to
  // basic.coinbase, and this wallet does not put an account key in the node config.
  return {
    basic: {
      name: 'SCDO Wallet Shard' + shard,
      version: '1.0.0',
      dataDir: opts.dataDir,
      address: '0.0.0.0:' + ports.rpc,
      coinbase: opts.coinbase,
      algorithm: 'zpow'
    },
    p2p: {
      privateKey: opts.p2pKey,
      staticNodes: staticNodes(),
      address: '0.0.0.0:' + ports.p2p,
      networkID: 'net1'
    },
    log: { isDebug: false, printLog: true },
    httpServer: {
      address: '127.0.0.1:' + ports.http,
      crossorigins: ['*'],
      whiteHost: ['*']
    },
    wsserver: { address: '127.0.0.1:' + ports.ws, crossorigins: ['*'] },
    ipcconfig: { name: 'scdo-wallet-' + shard + '.ipc' },
    metrics: {
      address: '127.0.0.1:' + ports.metrics,
      duration: 10,
      database: 'influxdb',
      username: '',
      password: ''
    },
    genesis: { difficult: 1900000, shard, timestamp: 1596942480 }
  }
}

// Writes nodeN.json. keyFile is the only key path read or written.
function writeNodeConfig (opts) {
  const dir = opts.dir
  if (!dir || !path.isAbsolute(dir)) {
    const err = new Error('node config dir must be absolute')
    err.code = 'BAD_DATADIR'
    throw err
  }
  const resolved = path.resolve(dir)
  const keyFile = path.resolve(opts.keyFile || path.join(resolved, 'p2p.key'))
  const dataDir = path.resolve(opts.dataDir || path.join(resolved, 'data'))
  if (!insideDir(resolved, keyFile) || keyFile === resolved) {
    const err = new Error('refusing to read a node key outside the wallet data dir')
    err.code = 'BAD_KEY'
    throw err
  }
  if (!insideDir(resolved, dataDir) || dataDir === resolved) {
    const err = new Error('refusing to place chain data outside the wallet data dir')
    err.code = 'BAD_DATADIR'
    throw err
  }
  fs.mkdirSync(dataDir, { recursive: true })
  const p2pKey = readOrCreateKey(keyFile)
  const cfg = buildNodeConfig({
    shard: opts.shard,
    coinbase: opts.coinbase,
    p2pKey,
    dataDir
  })
  const file = path.join(resolved, 'node' + Number(opts.shard) + '.json')
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2), { mode: 0o600 })
  return { file, config: cfg, keyFile, dataDir }
}

module.exports = {
  PEER_HOSTS,
  PEER_PORTS,
  SHARD_PORTS,
  staticNodes,
  newP2PKey,
  buildNodeConfig,
  writeNodeConfig
}
