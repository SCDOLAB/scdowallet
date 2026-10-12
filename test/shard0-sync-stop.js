// GPU 「等待同步」 bug (3.1.2): Shard0 EVM stuck on waiting-for-sync, Stop looked dead.
// 1) a Shard0 session that is shutting down shows 「正在停止」, never 「等待同步」 + 停止挖礦
// 2) a cleared running flag with live node/proxy still gets a Shard0 miner:stop
// 3) 0 peers / stalled sync says why, and the manager re-dials peers
'use strict'
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const vm = require('vm')

const root = path.join(__dirname, '..')
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8')
const mine = require('../src/js/mineHome.js')
const { MinerManager } = require('../src/miner/manager.js')

const box = { window: {} }
vm.runInNewContext(read('src/js/i18n112.js'), box)
const I = box.window.I18N112
const makeT = (pack) => (k, p) => {
  let s = pack[k]; if (s == null) s = k
  if (p && typeof s === 'string') s = s.replace(/\{(\w+)\}/g, (m, n) => p[n] != null ? p[n] : m)
  return s
}
const CN = makeT(I.CN)
const EN = makeT(I.EN)

const syncing = { chain: 'shard0', mode: 'mine', running: true, phase: 'syncing', code: 'SYNCING', procs: ['geth', 'proxy'], peers: 1, localBlock: 900, networkBlock: 1000 }

// --- waiting while syncing (unchanged behaviour) ---
assert.strictEqual(mine.devicePhase({ miners: { shard0: syncing }, press: {} }, 'gpu'), 'waiting')
assert.strictEqual(mine.planDeviceClick({ phase: 'waiting', alive: true }).op, 'kill')

// --- after Stop: running false, code STOPPING, geth still exiting -> stopping, click ignored ---
const exiting = Object.assign({}, syncing, { running: false, stopping: true, code: 'STOPPING' })
assert.strictEqual(mine.shuttingDown(exiting), true)
assert.strictEqual(mine.stillSyncing(exiting), false)
assert.strictEqual(mine.devicePhase({ miners: { shard0: exiting }, press: {} }, 'gpu'), 'stopping')
assert.strictEqual(mine.planDeviceClick({ phase: 'stopping', alive: true }).op, 'ignore')
// older main process without the stopping flag: code STOPPING + live procs is enough
const exitingOld = Object.assign({}, syncing, { running: false, code: 'STOPPING' })
assert.strictEqual(mine.devicePhase({ miners: { shard0: exitingOld }, press: {} }, 'gpu'), 'stopping')
{
  const page = mine.minePageHtml({ miners: { shard0: exiting }, chains: { cpu: [1], gpu: [0] } }, CN, (s) => String(s))
  assert.ok(!page.includes('等待同步'), 'shutting-down Shard0 must not show 等待同步')
  assert.ok(page.includes('正在停止'))
}
{
  const view = mine.formatMineHome({ miners: { shard0: exiting } }, CN)
  assert.strictEqual(view.phase, 'stopping')
  assert.strictEqual(view.buttonDisabled, true)
}
// fully stopped: no procs -> stopped
const done = Object.assign({}, syncing, { running: false, stopping: false, phase: 'stopped', code: 'STOPPED', procs: [] })
assert.strictEqual(mine.devicePhase({ miners: { shard0: done }, press: {} }, 'gpu'), 'stopped')

// --- shard0NeedsStop ---
assert.strictEqual(mine.shard0NeedsStop(syncing), true)
assert.strictEqual(mine.shard0NeedsStop(exiting), false) // stop already running
assert.strictEqual(mine.shard0NeedsStop(Object.assign({}, syncing, { running: false })), true) // orphaned procs
assert.strictEqual(mine.shard0NeedsStop(done), false)
assert.strictEqual(mine.shard0NeedsStop(Object.assign({}, syncing, { mode: 'node' })), false)
assert.strictEqual(mine.shard0NeedsStop(null), false)
const ui = read('src/js/app112.js')
const stopAt = ui.indexOf('async function stopDevice')
const stopFn = ui.slice(stopAt, ui.indexOf('function rememberMineRows', stopAt))
assert.ok(stopFn.includes('shard0NeedsStop(s0)'), 'stopDevice must use shard0NeedsStop')
assert.ok(!stopFn.includes('s0 && s0.running && s0.mode'), 'old running-only check is gone')
const dlAt = ui.indexOf('function armDeviceDeadline')
const dlFn = ui.slice(dlAt, ui.indexOf('function releaseDevicePress', dlAt))
assert.ok(dlFn.includes("api.invoke('miner:stop', 'mine')"), 'stop deadline also stops Shard0')

// --- the waiting line says why ---
const noPeers = Object.assign({}, syncing, { code: 'NO_PEERS', peers: 0 })
assert.strictEqual(mine.waitReason(noPeers), 'noPeers')
assert.strictEqual(mine.waitReason(Object.assign({}, syncing, { syncStalled: true })), 'stalled')
assert.strictEqual(mine.waitReason(syncing), 'syncing')
{
  const v = mine.formatMineHome({ miners: { shard0: noPeers } }, CN)
  assert.ok(v.statusText.includes('沒有連上其他節點'), v.statusText)
  const ve = mine.formatMineHome({ miners: { shard0: noPeers } }, EN)
  assert.ok(ve.statusText.includes('no peers'), ve.statusText)
  const vs = mine.formatMineHome({ miners: { shard0: Object.assign({}, syncing, { syncStalled: true }) } }, CN)
  assert.ok(vs.statusText.includes('同步停在 90%'), vs.statusText)
  const vp = mine.formatMineHome({ miners: { shard0: syncing } }, CN)
  assert.ok(vp.statusText.includes('90%'), vp.statusText)
}

// --- manager: stopping flag, bootnodes, sync watch ---
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scdo-sync-'))
const m = new MinerManager({ dataRoot: tmp, binDir: tmp, platform: 'linux' })
assert.strictEqual(m.status().stopping, false)
m.procs.geth = { pid: 1 }
m.wantRunning = true
assert.strictEqual(m.status().stopping, false)
m.wantRunning = false
assert.strictEqual(m.status().stopping, true)
m.procs.geth = null
assert.strictEqual(m.status().stopping, false)

assert.strictEqual(m.bootnodes().length, 1)
const extra = 'enode://' + 'a'.repeat(128) + '@10.0.0.5:30368'
fs.writeFileSync(path.join(tmp, 'bootnodes.txt'), extra + '\nnot-an-enode\n' + extra + '\n')
assert.deepStrictEqual(m.bootnodes().slice(1), [extra])

const t0 = 1000000
let w = m.syncWatch(100, 0, true, t0)
assert.strictEqual(w.kick, null)
w = m.syncWatch(100, 0, true, t0 + 61000)
assert.strictEqual(w.kick, 'no peers')
m.lastPeerKick = t0 + 61000
w = m.syncWatch(100, 0, true, t0 + 90000)
assert.strictEqual(w.kick, null) // rate-limited
w = m.syncWatch(100, 2, true, t0 + 10 * 60 * 1000 + 1)
assert.strictEqual(w.syncStalled, true)
assert.strictEqual(w.kick, 'sync stalled')
w = m.syncWatch(101, 2, true, t0 + 10 * 60 * 1000 + 2)
assert.strictEqual(w.syncStalled, false)

const src = read('src/miner/manager.js')
assert.ok(!src.includes("'--bootnodes', BOOTNODE,"), 'geth gets the full bootnode list')
assert.ok(src.includes('LOCAL_NODE_PORTS = [18647]'))
fs.rmSync(tmp, { recursive: true, force: true })
console.log('shard0-sync-stop: ok')
