'use strict'
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const RD = require('../src/main/rewardDest')

function tmp () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rd-'))
}

async function run () {
  // flags: store build hides both
  assert.strictEqual(RD.flags({ buildInfo: { storeBuild: true }, env: {} }).REWARD_LEND, false)
  assert.strictEqual(RD.flags({ buildInfo: { storeBuild: true }, env: {} }).REWARD_AUTOWHEEL, false)
  assert.strictEqual(RD.flags({ buildInfo: { testBuild: true }, env: {} }).REWARD_LEND, true)
  assert.strictEqual(RD.flags({ env: { SCDO_STORE_BUILD: '1' } }).REWARD_AUTOWHEEL, false)

  // amounts
  assert.strictEqual(RD.toAtomic('1.5').toString(), (15n * 10n ** 17n).toString())
  assert.strictEqual(RD.fromAtomic(10n ** 18n), '1')
  assert.strictEqual(RD.validateWheel({ stake: '1', lossLimit: '0.5', sessionMinutes: 30 }), 'lossBelowStake')
  assert.strictEqual(RD.validateWheel({ stake: '1', lossLimit: '10', sessionMinutes: 30 }), '')

  // safeRate never accepts treasury as interest payer
  const bad = RD.safeRate({ ok: true, enabled: true, rateBps: 100, interestPayer: RD.TREASURY })
  assert.strictEqual(bad.enabled, false)
  assert.strictEqual(bad.error, 'payer_is_treasury')

  // mapWheelHttp
  assert.strictEqual(RD.mapWheelHttp(403, { error: 'region_blocked' }).error, 'region_blocked')
  assert.strictEqual(RD.mapWheelHttp(503, { error: 'pool_paused' }).error, 'pool_paused')
  assert.strictEqual(RD.mapWheelHttp(503, { error: 'pool_paused' }).pause, true)
  assert.ok(RD.mapWheelHttp(200, { sessionId: 'x' }).ok)

  // controller with stub backends (testBuild)
  const dir = tmp()
  let agentOn = true
  const ctl = RD.createController({
    userData: dir,
    buildInfo: { testBuild: true },
    env: {},
    agent: () => ({ status: () => ({ agentId: '0x1111111111111111111111111111111111111111' }), signReward: () => ({ payload: {}, sig: '0x' + 'ab'.repeat(65) }) }),
    lendUrl: () => '',
    wheelOpts: { roundMs: 50, poolRetryMs: 80, rand: () => 0.9 }
  })
  assert.strictEqual(ctl.flags.REWARD_LEND, true)
  assert.strictEqual(ctl.get().prefs.lend.on, false)
  assert.strictEqual(ctl.get().prefs.wheel.on, false)

  // B) lend
  assert.strictEqual((await ctl.lendDeposit('1')).error, 'off')
  assert.ok(ctl.setLend(true).ok)
  const dep = await ctl.lendDeposit('10')
  assert.ok(dep.ok, JSON.stringify(dep))
  assert.ok(Number(dep.summary.balance) > 0)
  const led = await ctl.lendLedger()
  assert.ok(led.records.some(r => r.kind === 'lent'))
  assert.ok(led.records.some(r => r.kind === 'interest'))
  const w = await ctl.lendWithdraw(dep.summary.balance)
  assert.ok(w.ok)
  assert.strictEqual(w.summary.balance, '0')

  // A) wheel happy path
  assert.ok((await ctl.setWheel({ on: true, stake: '1', lossLimit: '5', sessionMinutes: 5 })).ok)
  const start = await ctl.wheelStart()
  assert.ok(start.ok, JSON.stringify(start))
  await new Promise(r => setTimeout(r, 120))
  const st = await ctl.wheelStatus()
  assert.ok(st.running)
  assert.ok(st.rounds >= 1)
  await ctl.wheelStop()
  assert.strictEqual((await ctl.wheelStatus()).running, false)
  assert.strictEqual((await ctl.wheelStatus()).stoppedBy, 'user')

  // 403 region_blocked turns toggle off
  const dir2 = tmp()
  const ctl2 = RD.createController({
    userData: dir2, buildInfo: { testBuild: true }, env: {},
    agent: () => ({ status: () => ({ agentId: '0x2222222222222222222222222222222222222222' }) }),
    lendUrl: () => '',
    wheelOpts: { forceRegion: true }
  })
  await ctl2.setWheel({ on: true, stake: '1', lossLimit: '5', sessionMinutes: 5 })
  const blocked = await ctl2.wheelStart()
  assert.strictEqual(blocked.error, 'region_blocked')
  assert.strictEqual(ctl2.get().prefs.wheel.on, false)

  // 503 pool_paused
  const dir3 = tmp()
  const ctl3 = RD.createController({
    userData: dir3, buildInfo: { testBuild: true }, env: {},
    agent: () => ({ status: () => ({ agentId: '0x3333333333333333333333333333333333333333' }) }),
    lendUrl: () => '',
    wheelOpts: { forcePoolPaused: true, poolRetryMs: 50 }
  })
  await ctl3.setWheel({ on: true, stake: '1', lossLimit: '5', sessionMinutes: 5 })
  const paused = await ctl3.wheelStart()
  assert.strictEqual(paused.error, 'pool_paused')
  assert.strictEqual(paused.pause, true)

  // store build rejects everything
  const ctlS = RD.createController({ userData: tmp(), buildInfo: { storeBuild: true }, env: {}, agent: () => null, lendUrl: () => '' })
  assert.strictEqual((await ctlS.setWheel({ on: true })).error, 'not_in_this_build')
  assert.strictEqual(ctlS.setLend(true).error, 'not_in_this_build')

  console.log('reward-dest ok')
}
run().catch(e => { console.error(e); process.exit(1) })
