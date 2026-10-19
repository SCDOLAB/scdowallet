'use strict'
// 3.1.13: reward destination ships greyed "Coming soon". Release wiring has no stub and no way to switch A/B on.
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const RD = require('../src/main/rewardDest')
const { StubX402Payer, StubLendBackend, StubWheelBackend } = require('./support/reward-dest-stubs')

const root = path.join(__dirname, '..')
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rd-'))
const AGENT = (a) => () => ({ status: () => ({ agentId: a }) })
const live = (lend, wheel) => async () => ({ status: 200, json: { ok: true, rewardLend: lend, rewardWheel: wheel } })

async function run () {
  // flags: store build hides both; env vars do nothing at runtime
  assert.strictEqual(RD.flags({ buildInfo: { storeBuild: true } }).REWARD_LEND, false)
  assert.strictEqual(RD.flags({ buildInfo: { storeBuild: true } }).REWARD_AUTOWHEEL, false)
  assert.strictEqual(RD.flags({ buildInfo: {} }).REWARD_LEND, true)
  assert.strictEqual(RD.flags({ buildInfo: { testBuild: true } }).testBuild, undefined)
  assert.deepStrictEqual(RD.CLIENT_READY, { wheel: true, lend: false }) // 3.1.14: real autobet client; still gated by /features

  // amounts / validation / treasury / http mapping
  assert.strictEqual(RD.toAtomic('1.5').toString(), (15n * 10n ** 17n).toString())
  assert.strictEqual(RD.fromAtomic(10n ** 18n), '1')
  assert.strictEqual(RD.validateWheel({ stake: '10', lossLimit: '5', sessionMinutes: 30 }), 'lossBelowStake')
  assert.strictEqual(RD.validateWheel({ stake: '10', lossLimit: '100', sessionMinutes: 30 }), '')
  assert.strictEqual(RD.validateWheel({ stake: '1', lossLimit: '10', sessionMinutes: 30 }), 'tier')
  const bad = RD.safeRate({ ok: true, enabled: true, rateBps: 100, interestPayer: RD.TREASURY })
  assert.strictEqual(bad.enabled, false)
  assert.strictEqual(bad.error, 'payer_is_treasury')
  assert.strictEqual(RD.mapWheelHttp(403, { error: 'region_blocked' }).error, 'region_blocked')
  assert.strictEqual(RD.mapWheelHttp(503, { error: 'pool_paused' }).pause, true)
  assert.ok(RD.mapWheelHttp(200, { sessionId: 'x' }).ok)

  // capability probe parsing: only an explicit ok:true + true counts
  assert.deepStrictEqual(RD.parseFeatures({ status: 200, json: { ok: true, rewardLend: true, rewardWheel: true } }), { wheel: true, lend: true })
  assert.deepStrictEqual(RD.parseFeatures({ status: 200, json: { ok: true, rewardLend: 'true', rewardWheel: 1 } }), { wheel: false, lend: false })
  assert.deepStrictEqual(RD.parseFeatures({ status: 404, json: { ok: true, rewardLend: true } }), { wheel: false, lend: false })
  assert.deepStrictEqual(RD.parseFeatures(null), { wheel: false, lend: false })

  // ---- RELEASE wiring (as main.js does it): even a server saying "live" cannot enable A/B in 3.1.13 ----
  let probes = 0
  const dirR = tmp()
  fs.writeFileSync(path.join(dirR, 'reward-destination.json'), JSON.stringify({ lend: { on: true }, wheel: { on: true, stake: '10', lossLimit: '50', sessionMinutes: 5 } }))
  const rel = RD.createController({ userData: dirR, buildInfo: {}, agent: AGENT('0x1111111111111111111111111111111111111111'), featuresUrl: () => 'https://x.invalid/features', fetchJson: async () => { probes++; return { status: 200, json: { ok: true, rewardLend: true, rewardWheel: true } } } })
  const g = await rel.get()
  assert.deepStrictEqual(g.active, { wheel: false, lend: false })
  assert.deepStrictEqual(g.comingSoon, { wheel: true, lend: true })
  assert.strictEqual(g.prefs.lend.on, false, 'old on:true pref must read as off')
  assert.strictEqual(g.prefs.wheel.on, false)
  assert.strictEqual(g.stubs, undefined)
  assert.strictEqual((await rel.setLend(true)).error, 'coming_soon')
  assert.strictEqual((await rel.setWheel({ on: true })).error, 'coming_soon')
  assert.strictEqual((await rel.setWheel({ stake: '2' })).error, 'coming_soon')
  assert.ok((await rel.setWheel({ on: false })).ok, 'turning off is always allowed')
  assert.ok((await rel.setLend(false)).ok)
  for (const fn of ['wheelStart', 'wheelStatus', 'lendRate', 'lendLedger']) assert.strictEqual((await rel[fn]()).error, 'coming_soon', fn)
  assert.strictEqual((await rel.lendDeposit('1')).error, 'coming_soon')
  assert.strictEqual((await rel.lendWithdraw('1')).error, 'coming_soon')
  assert.ok((await rel.wheelStop()).ok)
  assert.strictEqual(probes, 0, 'no backend -> nothing to probe')
  // env vars from the old test build do nothing
  process.env.SCDO_REWARD_TEST = '1'; process.env.SCDO_WHEEL_STUB_REGION = '1'; process.env.SCDO_LEND_URL = 'http://127.0.0.1:1/lend'
  const relEnv = RD.createController({ userData: tmp(), buildInfo: {}, agent: AGENT('0x1'), featuresUrl: () => '' })
  assert.strictEqual((await relEnv.setLend(true)).error, 'coming_soon')
  delete process.env.SCDO_REWARD_TEST; delete process.env.SCDO_WHEEL_STUB_REGION; delete process.env.SCDO_LEND_URL

  // ---- gate with a backend present (future build): server capability defaults off ----
  const mk = (dir, fetchJson, wheelOpts, extra) => RD.createController(Object.assign({
    userData: dir, buildInfo: {}, agent: AGENT('0x2222222222222222222222222222222222222222'), featuresUrl: () => 'https://x.invalid/features', fetchJson,
    backends: { payer: new StubX402Payer(), lend: new StubLendBackend(path.join(dir, 'lend.json')), wheel: new StubWheelBackend(wheelOpts || { roundMs: 50, rand: () => 0.9 }) }
  }, extra || {}))
  const dOff = tmp()
  const cOff = mk(dOff, async () => { throw new Error('down') })
  assert.deepStrictEqual((await cOff.get()).comingSoon, { wheel: true, lend: true })
  assert.strictEqual((await cOff.setLend(true)).error, 'coming_soon')
  const c404 = mk(tmp(), async () => ({ status: 404, json: null }))
  assert.strictEqual((await c404.setWheel({ on: true })).error, 'coming_soon')
  const cLendOnly = mk(tmp(), live(true, false))
  assert.deepStrictEqual((await cLendOnly.get()).active, { wheel: false, lend: true })
  assert.strictEqual((await cLendOnly.setWheel({ on: true })).error, 'coming_soon')

  // both live: behaviour from the test build still works (limits, Stop, region/pool handling)
  const c = mk(tmp(), live(true, true))
  assert.strictEqual((await c.lendDeposit('1')).error, 'off')
  assert.ok((await c.setLend(true)).ok)
  const dep = await c.lendDeposit('10')
  assert.ok(dep.ok, JSON.stringify(dep))
  const w = await c.lendWithdraw(dep.summary.balance)
  assert.strictEqual(w.summary.balance, '0')
  assert.ok((await c.setWheel({ on: true, stake: '10', lossLimit: '50', sessionMinutes: 5 })).ok)
  assert.ok((await c.wheelStart()).ok)
  await new Promise(r => setTimeout(r, 120))
  assert.ok((await c.wheelStatus()).rounds >= 1)
  await c.wheelStop()
  assert.strictEqual((await c.wheelStatus()).stoppedBy, 'user')
  const cR = mk(tmp(), live(true, true), { forceRegion: true })
  await cR.setWheel({ on: true, stake: '10', lossLimit: '50', sessionMinutes: 5 })
  assert.strictEqual((await cR.wheelStart()).error, 'region_blocked')
  assert.strictEqual((await cR.get()).prefs.wheel.on, false)
  const cP = mk(tmp(), live(true, true), { forcePoolPaused: true, poolRetryMs: 50 })
  await cP.setWheel({ on: true, stake: '10', lossLimit: '50', sessionMinutes: 5 })
  assert.strictEqual((await cP.wheelStart()).pause, true)

  // capability cache: probed once per TTL
  let n = 0; let t = 1000
  const cC = mk(tmp(), async () => { n++; return { status: 200, json: { ok: true, rewardLend: false, rewardWheel: false } } }, null, { now: () => t })
  await cC.get(); await cC.get(); assert.strictEqual(n, 1)
  t += 6 * 60_000; await cC.get(); assert.strictEqual(n, 2)

  // store build rejects everything
  const cS = RD.createController({ userData: tmp(), buildInfo: { storeBuild: true }, agent: () => null })
  assert.strictEqual((await cS.setWheel({ on: true })).error, 'not_in_this_build')
  assert.strictEqual((await cS.setLend(true)).error, 'not_in_this_build')

  // ---- packaged sources: no stub, no test switch, no deep link into A/B ----
  const read = (f) => fs.readFileSync(path.join(root, f), 'utf8')
  const shipped = ['main.js', 'preload.js', 'src/main/rewardDest.js', 'src/js/rewardDest.js', 'src/js/app112.js'].map(read).join('\n')
  assert.ok(!/Stub(Wheel|Lend)Backend|StubX402Payer/.test(shipped), 'no stub class in packaged code')
  assert.ok(!/SCDO_REWARD_TEST|SCDO_WHEEL_STUB|SCDO_LEND_URL/.test(shipped), 'no env switch in packaged code')
  assert.ok(!/backends\s*:/.test(read('main.js')), 'main.js must not pass test backends')
  assert.ok(!/rewardDest|reward-destination|autowheel|lend/i.test(read('src/js/agentJoin.js')), 'deep links do not route to reward destination')
  const ui = read('src/js/rewardDest.js')
  assert.ok(ui.includes("comingSoon: 'Coming soon'"))
  assert.ok(ui.includes('\\u5373\\u5c07\\u63a8\\u51fa'), '即將推出')
  // Owner wording rule: SCDO is points; A is "SCDO points auto-play" / 「SCDO 積分自動玩」.
  assert.ok(ui.includes("wheelName: 'SCDO points auto-play'"))
  assert.ok(ui.includes('SCDO \\u7a4d\\u5206\\u81ea\\u52d5\\u73a9'), 'SCDO 積分自動玩')
  const banned = new RegExp(['real', '(money|scdo)'].join('\\s+'), 'i')
  for (const f of ['src/js/rewardDest.js', 'src/main/rewardDest.js', 'src/js/i18n112.js', 'src/js/demoLinks.js', 'src/main/incomingNotifier.js', 'index.html', 'doc/release-notes/3.1.13.md', 'doc/release-notes/3.1.13.zh-Hant.md']) {
    assert.ok(!banned.test(read(f)), f + ': wording rule')
  }
  console.log('reward-dest ok')
}
run().catch(e => { console.error(e); process.exit(1) })
