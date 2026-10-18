// 3.1.4 AI Agent Ledger: signed envelopes, local agent key, self-heal rules for the 2026-10-12 incidents,
// agent service loop, and the key-free ledger server (in-process and over HTTP).
'use strict'
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const env = require('../src/agent/envelope')
const identity = require('../src/agent/identity')
const heal = require('../src/agent/healRules')
const { EventLog } = require('../src/agent/eventLog')
const { AgentService, heartbeatBody, postJson } = require('../src/agent/agentService')
const { createApp } = require('../server/agent-ledger/server')
const { Store } = require('../server/agent-ledger/store')
const root = path.join(__dirname, '..')
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'agl-'))
const MIN = 60000

// envelope + server copy identical
assert.strictEqual(fs.readFileSync(path.join(root, 'src/agent/envelope.js'), 'utf8'), fs.readFileSync(path.join(root, 'server/agent-ledger/envelope.js'), 'utf8'))
assert.strictEqual(env.canonical({ b: 1, a: [2, { d: 1, c: null }] }), '{"a":[2,{"c":null,"d":1}],"b":1}')

// identity: persisted, 0600, key never exposed
const d1 = tmp()
const id1 = identity.loadOrCreate(d1)
const id1b = identity.loadOrCreate(d1)
assert.strictEqual(id1.agentId, id1b.agentId)
assert.ok(/^0x[0-9a-fA-F]{40}$/.test(id1.agentId))
const keyFile = path.join(d1, 'agent-key.json')
if (process.platform !== 'win32') assert.strictEqual(fs.statSync(keyFile).mode & 0o777, 0o600)
const keyHex = JSON.parse(fs.readFileSync(keyFile, 'utf8')).key
assert.ok(!JSON.stringify(id1).includes(keyHex.slice(2, 20)))
assert.ok(!Object.values(id1).some(v => typeof v === 'string' && v.includes(keyHex.slice(2))))
const e1 = id1b.sign('heartbeat', { hashrate: 1 }, Date.now())
assert.ok(!JSON.stringify(e1).includes(keyHex.slice(2)))
assert.strictEqual(e1.payload.seq, 1)
assert.deepStrictEqual(env.verifyEnvelope(e1).ok, true)
// tamper
const t1 = JSON.parse(JSON.stringify(e1)); t1.payload.body.hashrate = 999
assert.strictEqual(env.verifyEnvelope(t1).error, 'signature')
const t2 = JSON.parse(JSON.stringify(e1)); t2.payload.agent = identity.loadOrCreate(tmp()).agentId
assert.strictEqual(env.verifyEnvelope(t2).error, 'signature')
const t3 = JSON.parse(JSON.stringify(e1)); t3.payload.chainId = 1
assert.strictEqual(env.verifyEnvelope(t3).error, 'chainId')
assert.strictEqual(env.verifyEnvelope(null).error, 'malformed')
// seq persists across reload
assert.strictEqual(identity.loadOrCreate(d1).sign('heal', {}).payload.seq, 2)

// heal rules: incident 1, duplicate Rigel on 5055 -> free port + restart (SCDO-4060)
let memo = heal.newMemo(); let now = 1e12
let r = heal.evaluate({ wantMining: true, running: true, otherRigels: [{ pid: 4242 }], quickExits: 3, gaveUp: true, code: 'MINING_STARTING' }, memo, now)
assert.deepStrictEqual(r.actions.map(a => a.type), ['free-port', 'restart-miner'])
assert.deepStrictEqual(r.actions[0].pids, [4242])
assert.strictEqual(r.actions[0].port, 5055)
assert.ok(r.problems.some(p => p.code === 'PORT_BUSY'))
// cooldown: not again immediately
r = heal.evaluate({ wantMining: true, running: true, otherRigels: [{ pid: 4242 }], quickExits: 3 }, memo, now + 1000)
assert.strictEqual(r.actions.length, 0)
// other Rigel but user not mining: never touched
r = heal.evaluate({ wantMining: false, otherRigels: [{ pid: 7 }] }, heal.newMemo(), now)
assert.strictEqual(r.actions.length, 0)
// a foreign Rigel that is healthy and not interfering (no exits, not gave up, port owner unknown) - still freed only when it holds the port
r = heal.evaluate({ wantMining: true, otherRigels: [{ pid: 7 }], portOwnerPid: 99, quickExits: 0 }, heal.newMemo(), now)
assert.strictEqual(r.actions.length, 0)

// incident 2: mining state lost after reboot
r = heal.evaluate({ armedResume: true, running: false, uptimeMs: 30000, resumeChains: ['shard0'] }, heal.newMemo(), now)
assert.strictEqual(r.actions.length, 0)
r = heal.evaluate({ armedResume: true, running: false, uptimeMs: 120000, resumeChains: ['shard0'] }, heal.newMemo(), now)
assert.deepStrictEqual(r.actions.map(a => a.type), ['resume-mining'])
assert.deepStrictEqual(r.actions[0].chains, ['shard0'])
r = heal.evaluate({ armedResume: false, running: false, uptimeMs: 120000 }, heal.newMemo(), now)
assert.strictEqual(r.actions.length, 0)

// incident 3: node 0 peers, waiting for sync
memo = heal.newMemo()
r = heal.evaluate({ nodeRunning: true, peers: 0, localBlock: 10, networkBlock: 5000 }, memo, now)
assert.strictEqual(r.actions.length, 0)
r = heal.evaluate({ nodeRunning: true, peers: 0, localBlock: 10, networkBlock: 5000 }, memo, now + 2 * MIN)
assert.deepStrictEqual(r.actions.map(a => a.type), ['reconnect-peers'])
assert.ok(r.problems.some(p => p.code === 'NO_PEERS'))
// sync stalled with peers
memo = heal.newMemo()
heal.evaluate({ nodeRunning: true, peers: 3, localBlock: 100, networkBlock: 5000 }, memo, now)
r = heal.evaluate({ nodeRunning: true, peers: 3, localBlock: 100, networkBlock: 5000 }, memo, now + 10 * MIN)
assert.ok(r.problems.some(p => p.code === 'SYNC_STALLED'))
// synced -> nothing
memo = heal.newMemo()
heal.evaluate({ nodeRunning: true, peers: 3, localBlock: 100, networkBlock: 101 }, memo, now)
assert.strictEqual(heal.evaluate({ nodeRunning: true, peers: 3, localBlock: 100, networkBlock: 101 }, memo, now + 30 * MIN).actions.length, 0)

// stuck miner 0 H/s for 10 min
memo = heal.newMemo()
heal.evaluate({ wantMining: true, running: true, code: 'MINING', hashrate: 0 }, memo, now)
r = heal.evaluate({ wantMining: true, running: true, code: 'MINING', hashrate: 0 }, memo, now + 9 * MIN)
assert.strictEqual(r.actions.length, 0)
r = heal.evaluate({ wantMining: true, running: true, code: 'MINING', hashrate: 0 }, memo, now + 10 * MIN)
assert.deepStrictEqual(r.actions.map(a => a.type), ['restart-miner'])
assert.strictEqual(heal.evaluate({ wantMining: true, running: true, code: 'MINING', hashrate: 5e6 }, heal.newMemo(), now).actions.length, 0)

// overheat: throttle at 85, pause at 90, unthrottle after 5 min ≤ 80
memo = heal.newMemo()
assert.deepStrictEqual(heal.evaluate({ gpuTempC: 86 }, memo, now).actions.map(a => a.type), ['throttle'])
assert.deepStrictEqual(heal.evaluate({ gpuTempC: 87 }, memo, now + 3 * MIN).actions.map(a => a.type), [])
assert.deepStrictEqual(heal.evaluate({ gpuTempC: 91 }, memo, now + 6 * MIN).actions.map(a => a.type), ['pause-gpu'])
heal.evaluate({ gpuTempC: 75 }, memo, now + 7 * MIN)
assert.deepStrictEqual(heal.evaluate({ gpuTempC: 75 }, memo, now + 12 * MIN).actions.map(a => a.type), ['unthrottle'])
assert.strictEqual(memo.throttled, false)

// hourly cap -> report, needs a human
memo = heal.newMemo()
let types = []
for (let i = 0; i < 8; i++) types.push(heal.evaluate({ wantMining: true, otherRigels: [{ pid: 1 }], gaveUp: true }, memo, now + i * 3 * MIN).actions.map(a => a.type).join('+'))
assert.ok(types.some(t => t.includes('report')))

// event log rotation-safe append/read
const el = new EventLog(tmp()); el.append({ kind: 'heal', action: 'x' }); assert.strictEqual(el.recent(5)[0].action, 'x')

// heartbeat body: only public fields
const hb = heartbeatBody({ hashrate: 1, peers: 2, wallet: '0xabc', otherRigels: [{ pid: 1, exe: 'C:\\x' }], problems: [{ code: 'NO_PEERS' }] }, '3.1.4')
assert.deepStrictEqual(Object.keys(hb).sort(), ['code', 'hashrate', 'peers', 'problems', 'version'])
assert.strictEqual(hb.code, 'ONLINE')
assert.strictEqual(heartbeatBody(null, '3.1.9').code, 'ONLINE')
assert.strictEqual(heartbeatBody({}, '3.1.9').code, 'ONLINE')
assert.strictEqual(heartbeatBody({ code: '  ' }, '3.1.9').code, 'ONLINE')
assert.strictEqual(heartbeatBody({ code: 'MINING' }, '3.1.9').code, 'MINING')

;(async () => {
  // server in-process
  let clock = Date.now()
  const app = createApp({ store: new Store(tmp()), now: () => clock })
  const idA = identity.loadOrCreate(tmp())
  assert.strictEqual(app.ingest('heartbeat', idA.sign('heartbeat', {}, clock), '1')[0], 409) // not registered
  assert.strictEqual(app.ingest('register', idA.sign('register', { version: '3.1.4' }, clock), '1')[0], 200)
  const hbEnv = idA.sign('heartbeat', { hashrate: 10 }, clock)
  assert.strictEqual(app.ingest('heartbeat', hbEnv, '1')[0], 200)
  assert.strictEqual(app.ingest('heartbeat', hbEnv, '1')[1].error, 'replay')
  assert.strictEqual(app.ingest('heartbeat', idA.sign('heartbeat', {}, clock - 11 * MIN), '1')[1].error, 'clock')
  assert.strictEqual(app.ingest('heal', idA.sign('heartbeat', {}, clock), '1')[1].error, 'type mismatch')
  const bad = idA.sign('heartbeat', { hashrate: 1 }, clock); bad.payload.body.hashrate = 2
  assert.strictEqual(app.ingest('heartbeat', bad, '1')[1].error, 'signature')
  // store reload keeps state
  const dir = tmp(); const s1 = new Store(dir); const a2 = createApp({ store: s1 })
  const idB = identity.loadOrCreate(tmp())
  a2.ingest('register', idB.sign('register', {}), '2'); a2.ingest('heal', idB.sign('heal', { action: 'free-port', outcome: 'done' }), '2')
  const s2 = new Store(dir); assert.strictEqual(s2.get(idB.agentId).counts.heal, 1); assert.strictEqual(s2.get(idB.agentId).seq, 2)
  // no key material in the store
  assert.ok(!fs.readFileSync(path.join(dir, 'envelopes.jsonl'), 'utf8').match(/privateKey|"key"/))

  // over HTTP: AgentService -> real server
  const sdir = tmp()
  const srvApp = createApp({ dataDir: sdir })
  const srv = http.createServer(srvApp.handler)
  await new Promise(resolve => srv.listen(0, '127.0.0.1', resolve))
  const base = 'http://127.0.0.1:' + srv.address().port + '/agent-ledger/api'
  let killed = []
  const svc = new AgentService(tmp(), {
    version: '3.1.4', platform: 'win32',
    snapshot: async () => ({ wantMining: true, running: true, code: 'MINING_STARTING', hashrate: 0, otherRigels: [{ pid: 5055 }], quickExits: 3, gaveUp: true, gpuTempC: 70, peers: 5 }),
    handlers: { 'free-port': async a => { killed = a.pids; return true }, 'restart-miner': async () => true }
  }, { ledgerUrl: base })
  const out = await svc.tick()
  assert.deepStrictEqual(killed, [5055])
  assert.deepStrictEqual(out.actions.map(a => a.action + ':' + a.outcome), ['free-port:done', 'restart-miner:done'])
  assert.strictEqual(svc.registered, true)
  await new Promise(resolve => setTimeout(resolve, 200))
  const get = u => new Promise((resolve, reject) => http.get(base + u, res => { let b = ''; res.on('data', c => { b += c }); res.on('end', () => resolve(JSON.parse(b))) }).on('error', reject))
  const list = await get('/agents')
  assert.strictEqual(list.total, 1)
  assert.strictEqual(list.agents[0].agent, svc.id.agentId)
  assert.strictEqual(list.agents[0].heals, 2)
  assert.strictEqual(list.agents[0].hashrate, 0)
  assert.deepStrictEqual(list.agents[0].problems, ['PORT_BUSY'])
  const one = await get('/agents/' + svc.id.agentId)
  assert.strictEqual(one.heals.length, 2)
  assert.strictEqual((await get('/health')).agents, 1)
  const tooBig = await postJson(base + '/heartbeat', { x: 'y'.repeat(20000) })
  assert.strictEqual(tooBig.ok, false)
  // reporting off: nothing sent, heal still runs locally
  const svcOff = new AgentService(tmp(), { enabled: () => false, snapshot: async () => ({}), handlers: {} }, { ledgerUrl: base, post: () => { throw new Error('must not send') } })
  await svcOff.tick()
  assert.strictEqual(svcOff.registered, false)
  srv.close()

  // status pages: one language per page, footer SCDO Laboratory
  const en = fs.readFileSync(path.join(root, 'server/agent-ledger/public/index.html'), 'utf8')
  const zh = fs.readFileSync(path.join(root, 'server/agent-ledger/public/zh/index.html'), 'utf8')
  const visible = h => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, ' ')
  const han = /[\u4e00-\u9fff]/
  assert.ok(en.includes('<footer>SCDO Laboratory</footer>') && zh.includes('<footer>SCDO Laboratory</footer>'))
  assert.ok(!han.test(visible(en).replace('華語繁體', '')), 'English page has Chinese text')
  assert.ok(han.test(visible(zh)))
  assert.ok(!/\b(Agents|Online|Hashrate|Peers|Status)\b/.test(visible(zh).replace('SCDO Laboratory', '')), 'Chinese page has English labels')
  assert.ok(!/[\u4e00-\u9fff]/.test(en.match(/const T=.*;/)[0]))
  console.log('agent-ledger: ok')
})().catch(e => { console.error(e); process.exit(1) })
