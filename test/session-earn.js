// 3.1.4 bug #5 (刘刚): CPU 本次收益 must not reset to 0 when mining restarts (relaunch, auto-resume, reconnect).
// Only the user's Stop ends the session.
'use strict'
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { ZpowManager, earnFile } = require('../src/miner/zpow/manager')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'earn-'))
const ADDR = '1S011c69768901fbcb0189c99ff57ac01d1fd89501'
let pool = { address: ADDR, shares: 12000, paid_scdo: 300, earned_scdo: 302 }
const mk = () => {
  const m = new ZpowManager({ dataRoot: root, fetchJson: async (u) => /\/api\/stats$/.test(u) ? {} : pool })
  // what start() sets up, without spawning a miner
  const { loadEarnBase } = require('../src/miner/zpow/manager')
  m.wantRunning = true
  m.state = Object.assign(m.fresh(), { wallet: ADDR, shard: 1, mode: 'cpu', backend: 'zminer', pool: { stats: 'http://pool/api/miner/' + ADDR }, worker: 'wallet' })
  m.earnBase = loadEarnBase(root, 'cpu', ADDR, 1)
  return m
}
;(async () => {
  let m = mk(); await m.pollPool()
  assert.strictEqual(m.state.sessionEarn.shares, 0); assert.strictEqual(Number(m.state.sessionEarn.paid), 0)
  pool = { address: ADDR, shares: 13452, paid_scdo: 353.22332232, earned_scdo: 355 }
  await m.pollPool()
  assert.strictEqual(m.state.sessionEarn.shares, 1452)
  // app quit / crash / network change + auto-resume: a brand-new manager, same session
  await m.stop()
  assert.ok(fs.existsSync(earnFile(root, 'cpu', ADDR, 1)), 'baseline kept on disk after a non-user stop')
  m = mk(); await m.pollPool()
  assert.strictEqual(m.state.sessionEarn.shares, 1452, '本次收益 survives a restart')
  assert.ok(Math.abs(Number(m.state.sessionEarn.paid) - 53.22332232) < 1e-6)
  // pool-side reset (counters lower than the base) -> new baseline, never negative
  pool = { address: ADDR, shares: 10, paid_scdo: 0, earned_scdo: 0 }
  await m.pollPool(); assert.strictEqual(m.state.sessionEarn.shares, 0)
  // the user's Stop ends the session
  pool = { address: ADDR, shares: 50, paid_scdo: 1, earned_scdo: 1 }
  await m.pollPool(); assert.strictEqual(m.state.sessionEarn.shares, 40)
  await m.stop({ endSession: true })
  assert.ok(!fs.existsSync(earnFile(root, 'cpu', ADDR, 1)), 'user Stop clears the baseline')
  m = mk(); await m.pollPool(); assert.strictEqual(m.state.sessionEarn.shares, 0)
  await m.stop()
  fs.rmSync(root, { recursive: true, force: true })
  console.log('session-earn: 本次收益 persists across restarts; user Stop resets it')
})().catch(e => { console.error(e); process.exit(1) })
