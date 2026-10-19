'use strict'
// 3.1.14 SCDO points auto-play (「SCDO 積分自動玩」): real Stake Wheel autobet client against a mocked local server.
// A stays greyed unless <agent ledger>/features reports rewardWheel=true; 403 region_blocked and 503 pool_paused honoured.
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const RD = require('../src/main/rewardDest')

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ap-'))
const ADDR = '0x1111111111111111111111111111111111111111'
const GAME = '0x2222222222222222222222222222222222222222'

function mockServer (routes) {
  const hits = []
  const srv = http.createServer((req, res) => {
    let body = ''
    req.on('data', c => { body += c })
    req.on('end', () => {
      const u = new URL(req.url, 'http://x')
      const hit = { method: req.method, path: u.pathname, query: Object.fromEntries(u.searchParams), body: body ? JSON.parse(body) : null }
      hits.push(hit)
      const h = routes[req.method + ' ' + u.pathname]
      const [status, json] = h ? h(hit) : [404, { error: 'not_found' }]
      res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(json))
    })
  })
  return new Promise(resolve => srv.listen(0, '127.0.0.1', () => resolve({ srv, hits, base: 'http://127.0.0.1:' + srv.address().port })))
}

function controller (m, opts) {
  const signs = []
  const c = RD.createController(Object.assign({
    userData: tmp(),
    buildInfo: {},
    agent: () => ({ status: () => ({ agentId: ADDR }) }),
    featuresUrl: () => m.base + '/agent-ledger/features',
    autoplay: {
      baseUrl: m.base + '/games/stakewheel/api/autobet',
      accounts: () => [{ file: 'acc1.json', address: ADDR }],
      sign: async (p) => { signs.push(p); if (p.password !== 'pw') throw new Error('WRONG_PASSWORD'); return { address: ADDR, signature: '0xsig', txHash: p.payTo ? '0xprepaid' : undefined } }
    }
  }, opts || {}))
  return { c, signs }
}

const challengeOk = (h) => [200, { message: 'Stake Wheel autobet ' + h.query.action + ' ' + h.query.address + ' nonce n1', nonce: 'n1', pay_to: GAME, x402_pay_url: 'https://scdo.com.au/x' }]

async function run () {
  assert.deepStrictEqual(RD.CLIENT_READY, { wheel: true, lend: false })
  assert.deepStrictEqual([...RD.AUTOPLAY_TIERS], ['10', '100'])
  assert.ok(RD.AUTOPLAY_BASE.startsWith('https://scdo.com.au/'))
  assert.deepStrictEqual(RD.autoplayPlan({ stake: '10', lossLimit: '100', sessionMinutes: 30 }), { tier: 10, rounds: 10, prepaid: '100' })
  assert.deepStrictEqual(RD.autoplayPlan({ stake: '10', lossLimit: '100', sessionMinutes: 3 }), { tier: 10, rounds: 3, prepaid: '30' })
  assert.strictEqual(RD.autoplayPlan({ stake: '100', lossLimit: '50', sessionMinutes: 3 }), null)
  assert.deepStrictEqual(RD.mapWheelHttp(403, { error: 'region_blocked' }), { ok: false, error: 'region_blocked' })
  assert.strictEqual(RD.mapWheelHttp(503, { error: 'pool_paused' }).pause, true)
  assert.strictEqual(RD.mapWheelHttp(503, { error: 'autobet_disabled' }).error, 'autobet_disabled')
  assert.strictEqual(RD.mapWheelHttp(429, { error: 'cap_exceeded' }).error, 'cap_exceeded')
  assert.strictEqual(RD.mapWheelHttp(400, { error: 'invalid_signature' }).error, 'invalid_signature')

  // 1) Server flag OFF (default): greyed, no autobet call, no signing, even with a saved on:true pref.
  for (const feat of [[200, { ok: true, rewardWheel: false, rewardLend: false }], [404, { error: 'not_found' }], [500, {}]]) {
    const m = await mockServer({ 'GET /agent-ledger/features': () => feat, 'GET /games/stakewheel/api/autobet/challenge': challengeOk })
    const { c, signs } = controller(m)
    const g = await c.get()
    assert.strictEqual(g.active.wheel, false); assert.strictEqual(g.comingSoon.wheel, true); assert.deepStrictEqual(g.accounts, [])
    assert.strictEqual((await c.setWheel({ on: true })).error, 'coming_soon')
    assert.strictEqual((await c.wheelStart({ file: 'acc1.json', password: 'pw' })).error, 'coming_soon')
    assert.strictEqual((await c.wheelStatus()).error, 'coming_soon')
    assert.strictEqual(signs.length, 0)
    assert.ok(!m.hits.some(h => h.path.includes('/autobet/')), 'no autobet traffic while the flag is off')
    m.srv.close()
  }

  // 2) Store build: hidden, never active even if the server says live.
  {
    const m = await mockServer({ 'GET /agent-ledger/features': () => [200, { ok: true, rewardWheel: true }] })
    const { c } = controller(m, { buildInfo: { storeBuild: true } })
    assert.strictEqual((await c.get()).active.wheel, false)
    assert.strictEqual((await c.wheelStart({ file: 'acc1.json', password: 'pw' })).error, 'not_in_this_build')
    m.srv.close()
  }

  // 3) Flag ON: opt-in, off by default, start signs the challenge and prepays tier*rounds; B stays greyed.
  {
    const m = await mockServer({
      'GET /agent-ledger/features': () => [200, { ok: true, rewardWheel: true, rewardLend: true }],
      'GET /games/stakewheel/api/autobet/challenge': challengeOk,
      'POST /games/stakewheel/api/autobet/start': () => [200, { ok: true, session_id: 's-1' }],
      'GET /games/stakewheel/api/autobet/status': () => [200, { found: true, session: { session_id: 's-1', state: 'running', rounds_played: 2, staked: '20', paid_out: '15', net: '-5' } }],
      'POST /games/stakewheel/api/autobet/stop': () => [200, { ok: true, stopped: true }]
    })
    const { c, signs } = controller(m)
    const g = await c.get()
    assert.strictEqual(g.active.wheel, true); assert.strictEqual(g.prefs.wheel.on, false, 'off by default')
    assert.strictEqual(g.active.lend, false, 'B has no client: stays greyed'); assert.strictEqual((await c.setLend(true)).error, 'coming_soon')
    assert.deepStrictEqual(g.accounts, [{ file: 'acc1.json', address: ADDR }])
    assert.strictEqual((await c.wheelStart({ file: 'acc1.json', password: 'pw' })).error, 'off', 'must opt in first')
    assert.strictEqual((await c.setWheel({ stake: '1' })).error, 'tier')
    assert.ok((await c.setWheel({ on: true, stake: '10', lossLimit: '100', sessionMinutes: 30 })).ok)
    assert.strictEqual((await c.wheelStart({ file: 'nope.json', password: 'pw' })).error, 'no_account')
    assert.strictEqual((await c.wheelStart({ file: 'acc1.json', password: 'bad' })).error, 'WRONG_PASSWORD')
    const r = await c.wheelStart({ file: 'acc1.json', password: 'pw' })
    assert.strictEqual(r.ok, true); assert.strictEqual(r.session_id, 's-1'); assert.strictEqual(r.prepaidTx, '0xprepaid')
    const ch = m.hits.filter(h => h.path.endsWith('/challenge')).pop()
    assert.deepStrictEqual(ch.query, { address: ADDR, action: 'start', tier: '10', rounds: '10' })
    const pay = signs.filter(s => s.payTo).pop()
    assert.strictEqual(pay.payTo, GAME); assert.strictEqual(pay.amount, '100'); assert.ok(pay.message.includes('nonce n1'))
    const st = m.hits.find(h => h.path.endsWith('/start'))
    assert.deepStrictEqual({ address: st.body.address, nonce: st.body.nonce, signature: st.body.signature, prepaid_tx: st.body.prepaid_tx }, { address: ADDR, nonce: 'n1', signature: '0xsig', prepaid_tx: '0xprepaid' })
    assert.ok(!JSON.stringify(m.hits).includes('"pw"'), 'password never sent to the server')
    const s = await c.wheelStatus()
    assert.deepStrictEqual([s.running, s.rounds, s.staked, s.won, s.net, s.sessionId], [true, 2, '20', '15', '-5', 's-1'])
    assert.strictEqual((await c.wheelStop({ file: 'acc1.json' })).error, 'password', 'signed stop needs the password')
    assert.strictEqual((await c.wheelStop({ file: 'acc1.json', password: 'pw' })).ok, true)
    const stop = m.hits.find(h => h.path.endsWith('/stop'))
    assert.strictEqual(stop.body.session_id, 's-1'); assert.strictEqual(stop.body.signature, '0xsig')
    assert.strictEqual(m.hits.filter(h => h.path.endsWith('/challenge')).pop().query.action, 'stop')
    m.srv.close()
  }

  // 4) 403 region_blocked: toggle turned off, nothing signed or paid.
  {
    const m = await mockServer({
      'GET /agent-ledger/features': () => [200, { ok: true, rewardWheel: true }],
      'GET /games/stakewheel/api/autobet/challenge': () => [403, { error: 'region_blocked' }]
    })
    const { c, signs } = controller(m)
    await c.setWheel({ on: true, stake: '10', lossLimit: '100', sessionMinutes: 30 })
    const r = await c.wheelStart({ file: 'acc1.json', password: 'pw' })
    assert.strictEqual(r.error, 'region_blocked'); assert.strictEqual(r.prefs.wheel.on, false)
    assert.strictEqual((await c.get()).prefs.wheel.on, false)
    assert.strictEqual(signs.length, 0)
    m.srv.close()
  }

  // 5) 503 pool_paused (tier 100 until the pool refills): reported as a pause, toggle stays on, nothing paid.
  {
    const m = await mockServer({
      'GET /agent-ledger/features': () => [200, { ok: true, rewardWheel: true }],
      'GET /games/stakewheel/api/autobet/challenge': () => [503, { error: 'pool_paused' }],
      'GET /games/stakewheel/api/autobet/status': () => [200, { found: true, session: { state: 'paused', pause_reason: 'pool_paused' } }]
    })
    const { c, signs } = controller(m)
    await c.setWheel({ on: true, stake: '100', lossLimit: '1000', sessionMinutes: 10 })
    const r = await c.wheelStart({ file: 'acc1.json', password: 'pw' })
    assert.strictEqual(r.error, 'pool_paused'); assert.strictEqual(r.pause, true)
    assert.strictEqual((await c.get()).prefs.wheel.on, true)
    assert.strictEqual(signs.length, 0)
    m.srv.close()
  }

  // 6) A pay_to equal to the treasury is refused before anything is signed or paid.
  {
    const m = await mockServer({
      'GET /agent-ledger/features': () => [200, { ok: true, rewardWheel: true }],
      'GET /games/stakewheel/api/autobet/challenge': (h) => [200, { message: 'm', nonce: 'n', pay_to: RD.TREASURY }]
    })
    const { c, signs } = controller(m)
    await c.setWheel({ on: true, stake: '10', lossLimit: '100', sessionMinutes: 30 })
    assert.strictEqual((await c.wheelStart({ file: 'acc1.json', password: 'pw' })).error, 'payer_is_treasury')
    assert.strictEqual(signs.length, 0)
    m.srv.close()
  }

  // 7) Release wiring: real client in main.js, no stub, no test backends, no env switch.
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8')
  assert.ok(/autoplay:\s*\{[\s\S]*autoplaySign/.test(main))
  assert.ok(!/backends\s*:/.test(main))
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/main/rewardDest.js'), 'utf8')
  assert.ok(!/Stub|SCDO_WHEEL_STUB|process\.env/.test(src), 'no stub or env switch in the shipped module')
  console.log('autoplay-3114 ok')
}
run().catch(e => { console.error(e); process.exit(1) })
