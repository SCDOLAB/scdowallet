// 3.1.5: Melbourne Shard0 bootnode and pool, configurable Shard1–4 pools, retired third-party RPC,
// agent ledger on apeccapital.org with fallback, payout, health rules, retry and crash reports.
'use strict'
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const root = path.join(__dirname, '..')
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8')
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'r315-'))
const H = 60 * 60 * 1000

const { BOOTNODE } = require('../src/miner/manager')
const { PEER_HOSTS, staticNodes } = require('../src/miner/zpow/nodeConfig')
const { poolForShard, mergeOverrides, DEFAULT_HOST } = require('../src/miner/zpow/pools')
const { ZpowManager } = require('../src/miner/zpow/manager')
const { OFFICIAL_POOL_HOSTS } = require('../src/main/miningService')
const endpoints = require('../src/config/endpoints')
const { refresh } = require('../src/config/remoteConfig')
const heal = require('../src/agent/healRules')
const identity = require('../src/agent/identity')
const { AgentService } = require('../src/agent/agentService')
const { createApp } = require('../server/agent-ledger/server')

const KEY = 'enode://1d2c370db7c419349e2313f20023f6b379f946990042b9b42df45cb56e4c3487df0d36c52cd81308fcdf312450f758a6213fcac21213e94a71af4a3c9392601f@'
assert.ok(BOOTNODE.startsWith(KEY))
assert.ok(BOOTNODE.endsWith('@139.84.196.31:30368'))
assert.ok(!BOOTNODE.includes('82.223.19.88'))

assert.ok(!PEER_HOSTS.includes('82.223.19.88'))
assert.ok(staticNodes().every(n => n.indexOf('82.223.19.88') < 0))
assert.ok(staticNodes().some(n => n.startsWith('217.160.65.210:')))

// 3.1.6: no built-in Classic pool host, and the former party host is refused even from config.
assert.strictEqual(DEFAULT_HOST, null)
assert.strictEqual(poolForShard(1).stratum, '')
assert.strictEqual(poolForShard(1).statsBase, '')
assert.strictEqual(poolForShard(4).statsPort, 8344)
assert.strictEqual(poolForShard(1, mergeOverrides({ zpowPools: { 1: { host: '82.223.19.88' } } }, null)).stratum, '')
assert.strictEqual(poolForShard(1, { 1: { host: '82.223.19.88' } }).stratum, '')
const remoteOver = mergeOverrides({ zpowPools: { 1: { host: '10.2.2.2' }, 2: { host: 'bad host', port: 14002 } } }, null)
assert.strictEqual(poolForShard(1, remoteOver).host, '10.2.2.2')
assert.strictEqual(poolForShard(1, remoteOver).port, 3341)
assert.strictEqual(poolForShard(2, remoteOver).host, '')
assert.strictEqual(poolForShard(2, remoteOver).port, 14002)
const envWins = mergeOverrides({ zpowPools: { 1: { host: '10.0.0.5' } } }, { 1: { host: '10.1.1.1' } })
assert.strictEqual(poolForShard(1, envWins).host, '10.1.1.1')
const mgr = new ZpowManager({ platform: 'linux', root, remoteConfig: { zpowPools: { 3: { host: '10.8.8.8', statsPort: 18003 } } } })
const caps = mgr.capabilities({})
assert.strictEqual(caps.pools[3].stratum, '10.8.8.8:3343')
assert.strictEqual(caps.pools[3].statsBase, 'http://10.8.8.8:18003')
assert.strictEqual(caps.pools[1].host, '')

assert.deepStrictEqual(OFFICIAL_POOL_HOSTS.slice(0, 1), ['139.84.196.31:3333'])
assert.ok(!OFFICIAL_POOL_HOSTS.includes('82.223.19.88:3333') && OFFICIAL_POOL_HOSTS.includes('139.84.196.31:3333'))
assert.ok(read('src/js/mining/miningSettingsPanel.js').includes('ethproxy+tcp://139.84.196.31:3333'))
assert.ok(read('src/js/app112.js').includes('ethproxy+tcp://139.84.196.31:3333'))

for (const ip of endpoints.RETIRED_RPC_HOSTS) {
  assert.ok(!read('src/json/viewconfig_1.1.json').includes(ip), ip)
  assert.ok(!read('src/api/scdoClient.js').includes(ip), ip)
}
const migrated = endpoints.migrateWalletConfig({
  connect: ['', 'http://74.208.207.184:8037', 'http://117.50.97.136:8038', 'http://107.150.102.94:8039', 'http://117.50.97.136:8036']
})
assert.strictEqual(migrated.config.connect[0], 'https://apeccapital.org/rpc/0')
assert.strictEqual(migrated.config.connect[1], 'https://apeccapital.org/rpc/1')
assert.strictEqual(migrated.config.connect[3], 'https://apeccapital.org/rpc/3')
assert.strictEqual(migrated.config.connectFallback[4], 'https://scdo.com.au/rpc/4')
assert.strictEqual(migrated.config.configVersion, 3)
const kept = endpoints.migrateWalletConfig({
  connect: ['https://scdo.com.au/rpc/0', 'https://scdo.com.au/rpc/1', 'https://scdo.com.au/rpc/2', 'https://scdo.com.au/rpc/3', 'https://scdo.com.au/rpc/4'],
  connectFallback: endpoints.fallbackConnect(),
  configVersion: 3
})
assert.strictEqual(kept.config.connect[2], 'https://scdo.com.au/rpc/2')
assert.deepStrictEqual(endpoints.rpcCandidates(0, { connect: migrated.config.connect, connectFallback: migrated.config.connectFallback }).slice(0, 2), [
  'https://apeccapital.org/rpc/0', 'https://scdo.com.au/rpc/0'
])
assert.deepStrictEqual(endpoints.rpcCandidates(1, { remote: { rpc: { 1: ['http://127.0.0.1:18037', 'https://scdo.com.au/rpc/1'] } } }), [
  'http://127.0.0.1:18037', 'https://scdo.com.au/rpc/1'
])
assert.deepStrictEqual(endpoints.rpcCandidates(2, { remote: { rpc: { 2: ['http://74.208.207.184:8038'] } } }).indexOf('http://74.208.207.184:8038'), -1)

assert.strictEqual(endpoints.DEFAULT_LEDGER, 'https://apeccapital.org/agent-ledger/api')
assert.strictEqual(endpoints.FALLBACK_LEDGER, 'https://scdo.com.au/agent-ledger/api')
assert.deepStrictEqual(endpoints.ledgerUrls({ env: {} }), [endpoints.DEFAULT_LEDGER, endpoints.FALLBACK_LEDGER])
assert.deepStrictEqual(endpoints.ledgerUrls({ ledgerUrl: 'http://127.0.0.1:9/agent-ledger/api', env: { SCDO_AGENT_LEDGER: 'https://ignored.example/api' } }), ['http://127.0.0.1:9/agent-ledger/api'])
const withRemoteLedger = endpoints.ledgerUrls({ env: {}, remote: { agentLedger: ['https://apeccapital.org/custom/api'] } })
assert.strictEqual(withRemoteLedger[0], 'https://apeccapital.org/custom/api')
assert.ok(withRemoteLedger.includes(endpoints.FALLBACK_LEDGER))

const now = 1e12
let memo = heal.newMemo()
let r = heal.evaluate({ wantMining: true, running: true, miningStartedAt: now - 24 * H, rewardsSeen: false }, memo, now)
assert.ok(r.problems.some(p => p.code === 'NO_REWARD'))
assert.ok(r.actions.some(a => a.about === 'no-reward'))
assert.ok(!heal.evaluate({ wantMining: true, running: true, miningStartedAt: now - 23 * H, rewardsSeen: false }, heal.newMemo(), now).problems.some(p => p.code === 'NO_REWARD'))
assert.ok(heal.evaluate({ wantMining: true, running: true, noRewardHours: 2, lastRewardAt: now - 2 * H }, heal.newMemo(), now).problems.some(p => p.code === 'NO_REWARD'))
assert.ok(!heal.evaluate({ wantMining: true, running: true, miningStartedAt: now - 48 * H, rewardsSeen: true }, heal.newMemo(), now).problems.some(p => p.code === 'NO_REWARD'))
memo = heal.newMemo()
assert.strictEqual(heal.evaluate({ poolMode: true, poolConnected: false }, memo, now).actions.length, 0)
r = heal.evaluate({ poolMode: true, poolConnected: false }, memo, now + heal.POOL_DOWN_MS)
assert.ok(r.problems.some(p => p.code === 'POOL_DISCONNECTED'))
assert.ok(r.actions.some(a => a.about === 'pool-disconnected'))
assert.ok(heal.evaluate({ payoutWatched: true, miningStartedAt: now - 6 * H }, heal.newMemo(), now).problems.some(p => p.code === 'PAYOUT_STALE'))
assert.ok(!heal.evaluate({ payoutWatched: true, payoutBalanceAt: now - H, miningStartedAt: now - 48 * H }, heal.newMemo(), now).problems.some(p => p.code === 'PAYOUT_STALE'))
assert.ok(!heal.evaluate({ payoutWatched: true, payoutBalanceFresh: true, miningStartedAt: now - 48 * H }, heal.newMemo(), now).problems.some(p => p.code === 'PAYOUT_STALE'))

const agentSrc = read('src/agent/agentService.js')
assert.ok(!agentSrc.includes('.catch(() => {})') && !agentSrc.includes('.catch(()=>{})'))
assert.ok(agentSrc.includes('gave-up') && agentSrc.includes("deliver('report'"))
assert.ok(read('index.html').includes("connect-src 'self' https://apeccapital.org"))
assert.ok(read('main.js').includes('apeccapital\\.org'))
assert.ok(read('src/updater.js').includes("'https://apeccapital.org'"))
assert.strictEqual(require('../package.json').version, '3.1.15')
assert.ok(read('server/agent-ledger/server.js').includes('report'))

;(async () => {
  const cacheDir = tmp()
  const cacheFile = path.join(cacheDir, 'remote-config.json')
  const fetched = await refresh({
    urls: ['https://down.example/wallet/config.json', 'https://ok.example/wallet/config.json'],
    cacheFile,
    fetchImpl: async (url) => {
      if (url.indexOf('down') >= 0) throw new Error('down')
      return { zpowPools: { 4: { host: '10.4.4.4' } }, noRewardHours: 12, ignored: true }
    }
  })
  assert.strictEqual(fetched.from, 'https://ok.example/wallet/config.json')
  assert.strictEqual(fetched.config.zpowPools[4].host, '10.4.4.4')
  assert.strictEqual(fetched.config.noRewardHours, 12)
  assert.strictEqual(fetched.config.ignored, undefined)
  const cached = await refresh({
    urls: ['https://a.example/c', 'https://b.example/c'],
    cacheFile,
    fetchImpl: async () => { throw new Error('no') }
  })
  assert.strictEqual(cached.from, 'cache')
  assert.strictEqual(cached.config.noRewardHours, 12)

  let n = 0
  const retry = new AgentService(tmp(), { version: '3.1.5', snapshot: async () => ({}), payoutAddress: () => '0x2d6f6ebc9686d0316e1f24f8588585c1f22fc956' }, {
    ledgerUrl: 'http://127.0.0.1:9/agent-ledger/api',
    attempts: 3,
    retryDelayMs: 1,
    post: async () => { n++; return n < 3 ? { ok: false, error: 'timeout' } : { ok: true, status: 200, body: { ok: true } } }
  })
  const reg = await retry.register()
  assert.strictEqual(reg.ok, true)
  assert.strictEqual(n, 3)
  assert.ok(retry.log.recent(20).some(e => e.outcome === 'retry'))
  assert.strictEqual(retry.registeredPayout, '0x2d6f6ebc9686d0316e1f24f8588585c1f22fc956')

  const seen = []
  const fb = new AgentService(tmp(), { version: '3.1.5', snapshot: async () => ({}) }, {
    env: {},
    attempts: 1,
    retryDelayMs: 1,
    post: async (url) => {
      seen.push(url)
      return url.indexOf('apeccapital.org') >= 0 ? { ok: false, error: 'down' } : { ok: true, status: 200, body: { ok: true } }
    }
  })
  assert.strictEqual((await fb.register()).ok, true)
  assert.ok(seen[0].indexOf('https://apeccapital.org/agent-ledger/api/register') === 0)
  assert.ok(seen[1].indexOf('https://scdo.com.au/agent-ledger/api/register') === 0)
  assert.strictEqual(fb.ledger, 'https://scdo.com.au/agent-ledger/api')

  const srv = http.createServer(createApp({ dataDir: tmp() }).handler)
  await new Promise(resolve => srv.listen(0, '127.0.0.1', resolve))
  const base = 'http://127.0.0.1:' + srv.address().port + '/agent-ledger/api'
  const addr = '0x52908400098527886e0f7030069857d2e4169ee7'
  const svc = new AgentService(tmp(), {
    version: '3.1.5', platform: 'linux', snapshot: async () => ({}), payoutAddress: () => addr
  }, { ledgerUrl: base, attempts: 1, retryDelayMs: 1 })
  assert.strictEqual((await svc.register()).ok, true)
  const bad = new AgentService(tmp(), { version: '3.1.5', snapshot: async () => ({}), payoutAddress: () => 'not-an-address' }, { ledgerUrl: base, attempts: 1, retryDelayMs: 1 })
  assert.strictEqual((await bad.register()).ok, true)
  const crashed = await svc.reportError({ kind: 'crash', message: 'boom 0x' + 'a'.repeat(64), stack: 'Error: boom' })
  assert.strictEqual(crashed.ok, true)
  const get = (u) => new Promise((resolve, reject) => http.get(base + u, res => {
    let b = ''
    res.on('data', c => { b += c })
    res.on('end', () => resolve(JSON.parse(b)))
  }).on('error', reject))
  const one = await get('/agents/' + svc.id.agentId)
  assert.strictEqual(one.summary.payout, addr)
  assert.strictEqual(one.summary.reports, 1)
  const other = await get('/agents/' + bad.id.agentId)
  assert.strictEqual(other.summary.payout, null)
  const unsigned = identity.loadOrCreate(tmp()).sign('heartbeat', {}, Date.now())
  const rejected = await new Promise((resolve, reject) => {
    const body = JSON.stringify(unsigned)
    const req = http.request(base + '/report', { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, res => {
      let b = ''
      res.on('data', c => { b += c })
      res.on('end', () => resolve(res.statusCode + ' ' + b))
    })
    req.on('error', reject)
    req.end(body)
  })
  assert.ok(rejected.startsWith('400'), rejected)
  srv.close()
  console.log('release-315: ok')
})().catch(e => { console.error(e); process.exit(1) })
