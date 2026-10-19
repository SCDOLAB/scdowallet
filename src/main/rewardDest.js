// Reward destination (記帳獎勵去向) — TEST feature, main process only.
//   A) Auto-join wheel: bookkeeping rewards fund the Games Ledger wheel auto-bet (x402, SCDO). 1 round / minute, opt-in.
//   B) Lend to treasury for interest: rewards are lent (x402, SCDO); interest is booked per agent and paid from the
//      subsidy wallet, never the treasury. Principal can be withdrawn at any time.
// Both toggles are OFF by default. Both features are compiled out of App Store / Play / store builds (storeBuild flag).
//
// STUBS in this test build (see PR):
//   - WheelClient: the Games Ledger auto-bet API spec (/workspace/wheel-autobet-api.md) did not exist yet, so
//     StubWheelBackend simulates rounds locally. No SCDO moves, nothing is posted to chat or the ledger.
//   - X402Payer: StubX402Payer returns a "stub-…" reference; no x402 authorization is signed and no SCDO moves.
//   - Lend server: /lend on the agent ledger is behind LEDGER_REWARD_LEND=on (off in production). When it does not
//     answer, a test build falls back to StubLendBackend (local file, marked stub) so the screens can be exercised.
'use strict'
const fs = require('fs')
const path = require('path')
const https = require('https')
const http = require('http')
const { URL } = require('url')

const TREASURY = '0x0889453fe946c75163b3bbdf2266f2566b2f4c03'
const WEI = 10n ** 18n

// ---- build flags ----
// REWARD_LEND / REWARD_AUTOWHEEL are true only in desktop direct-download and test builds.
// A store build (build-info.json storeBuild:true or SCDO_STORE_BUILD=1 at build time) turns both off, and the
// renderer never draws the section.
function readBuildInfo (root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'build-info.json'), 'utf8')) } catch (e) { return {} }
}
function flags (opts) {
  opts = opts || {}
  const info = opts.buildInfo || readBuildInfo(opts.root || path.join(__dirname, '..', '..'))
  const env = opts.env || process.env
  const storeBuild = info.storeBuild === true || env.SCDO_STORE_BUILD === '1'
  const testBuild = info.testBuild === true || env.SCDO_REWARD_TEST === '1'
  return Object.freeze({
    storeBuild,
    testBuild,
    REWARD_LEND: !storeBuild,
    REWARD_AUTOWHEEL: !storeBuild
  })
}

// ---- amounts (SCDO, 18 decimals; strings in, atomic BigInt inside) ----
function toAtomic (s) {
  s = String(s == null ? '' : s).trim()
  if (!/^\d+(\.\d{1,18})?$/.test(s)) return null
  const [i, f = ''] = s.split('.')
  return BigInt(i) * WEI + BigInt((f + '0'.repeat(18)).slice(0, 18))
}
function fromAtomic (v) {
  v = BigInt(v); const neg = v < 0n; if (neg) v = -v
  const i = v / WEI; const f = (v % WEI).toString().padStart(18, '0').replace(/0+$/, '')
  return (neg ? '-' : '') + i.toString() + (f ? '.' + f : '')
}

// ---- prefs (userData/reward-destination.json) ----
const DEFAULT_PREFS = Object.freeze({
  lend: { on: false },
  wheel: { on: false, stake: '1', lossLimit: '10', sessionMinutes: 30 }
})
function cleanPrefs (p) {
  p = p && typeof p === 'object' ? p : {}
  const w = p.wheel && typeof p.wheel === 'object' ? p.wheel : {}
  const l = p.lend && typeof p.lend === 'object' ? p.lend : {}
  const stake = toAtomic(w.stake) != null && toAtomic(w.stake) > 0n ? String(w.stake) : DEFAULT_PREFS.wheel.stake
  const loss = toAtomic(w.lossLimit) != null && toAtomic(w.lossLimit) > 0n ? String(w.lossLimit) : DEFAULT_PREFS.wheel.lossLimit
  const mins = Number.isInteger(Number(w.sessionMinutes)) && Number(w.sessionMinutes) >= 1 && Number(w.sessionMinutes) <= 240 ? Number(w.sessionMinutes) : DEFAULT_PREFS.wheel.sessionMinutes
  return { lend: { on: l.on === true }, wheel: { on: w.on === true, stake, lossLimit: loss, sessionMinutes: mins } }
}
function validateWheel (w) {
  const stake = toAtomic(w.stake); const loss = toAtomic(w.lossLimit); const mins = Number(w.sessionMinutes)
  if (stake == null || stake <= 0n) return 'stake'
  if (loss == null || loss <= 0n) return 'lossLimit'
  if (loss < stake) return 'lossBelowStake'
  if (!Number.isInteger(mins) || mins < 1 || mins > 240) return 'session'
  return ''
}

// ---- small JSON HTTP helper ----
function request (method, url, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    let u; try { u = new URL(url) } catch (e) { reject(new Error('bad url')); return }
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost'))) { reject(new Error('https only')); return }
    const data = body == null ? null : Buffer.from(JSON.stringify(body))
    const req = (u.protocol === 'https:' ? https : http).request(u, {
      method,
      headers: Object.assign({ accept: 'application/json' }, data ? { 'content-type': 'application/json', 'content-length': data.length } : {}),
      timeout: timeoutMs || 6000
    }, res => {
      const chunks = []
      res.on('data', c => { chunks.push(c); if (chunks.reduce((n, x) => n + x.length, 0) > 262144) req.destroy(new Error('too large')) })
      res.on('end', () => {
        let json = null
        try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch (e) {}
        resolve({ status: res.statusCode, json })
      })
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
    if (data) req.write(data)
    req.end()
  })
}

// ---- x402 payer (interface + STUB) ----
// Real implementation (later): sign an EIP-3009 WSCDO transferWithAuthorization for `to`/`amount`, hand the
// X-PAYMENT header to the resource, return the facilitator settlement tx hash.
class StubX402Payer {
  constructor () { this.stub = true; this.n = 0 }
  async pay ({ to, amountAtomic, purpose }) {
    this.n += 1
    return { stub: true, ref: 'stub-x402-' + Date.now().toString(36) + '-' + this.n, to, amount: fromAtomic(amountAtomic), purpose }
  }
}

// ---- B) lend: server client + STUB backend ----
function summaryOf (records) {
  let lent = 0n; let interest = 0n; let withdrawn = 0n
  for (const r of records) {
    const a = BigInt(r.amountAtomic)
    if (r.kind === 'lent') lent += a
    else if (r.kind === 'interest') interest += a
    else if (r.kind === 'withdrawn') withdrawn += a
  }
  return { lent: fromAtomic(lent), interestBooked: fromAtomic(interest), withdrawn: fromAtomic(withdrawn), balance: fromAtomic(lent + interest - withdrawn), balanceAtomic: (lent + interest - withdrawn).toString() }
}
class StubLendBackend {
  constructor (file) { this.file = file; this.stub = true }
  read () { try { return JSON.parse(fs.readFileSync(this.file, 'utf8')) } catch (e) { return { records: [] } } }
  write (doc) { fs.mkdirSync(path.dirname(this.file), { recursive: true }); const t = this.file + '.tmp'; fs.writeFileSync(t, JSON.stringify(doc, null, 1)); fs.renameSync(t, this.file) }
  async rate () {
    // Stub rate is a sample value so the label and the variable-rate wording can be checked; it is not an offer.
    return { ok: true, stub: true, enabled: true, rateBps: 350, guaranteed: false, interestPayer: '0x0000000000000000000000000000000000000000', interestPayerLabel: 'subsidy wallet (stub)', asOf: Date.now() }
  }
  async ledger () {
    const d = this.read()
    const records = (d.records || []).map(r => Object.assign({}, r, { amountDisplay: fromAtomic(r.amountAtomic) }))
    return { ok: true, stub: true, records, summary: summaryOf(d.records) }
  }
  async deposit (agent, amountAtomic, x402) {
    const d = this.read()
    d.records.push({ kind: 'lent', amountAtomic: amountAtomic.toString(), ts: Date.now(), ref: x402 && x402.ref, stub: true })
    // stub only: book one day of interest at the stub rate so the "interest booked" row is visible
    const day = (amountAtomic * 350n) / 10000n / 365n
    if (day > 0n) d.records.push({ kind: 'interest', amountAtomic: day.toString(), ts: Date.now(), payer: 'subsidy wallet (stub)', stub: true })
    this.write(d); return { ok: true, stub: true, summary: summaryOf(d.records) }
  }
  async withdraw (agent, amountAtomic) {
    const d = this.read(); const bal = BigInt(summaryOf(d.records).balanceAtomic)
    if (amountAtomic > bal) return { ok: false, error: 'insufficient' }
    d.records.push({ kind: 'withdrawn', amountAtomic: amountAtomic.toString(), ts: Date.now(), stub: true })
    this.write(d); return { ok: true, stub: true, summary: summaryOf(d.records) }
  }
}
class LendClient {
  constructor (opts) {
    this.baseUrl = String(opts.baseUrl || '').replace(/\/$/, '')
    this.sign = opts.sign // (type, body) => envelope | null
    this.stubBackend = opts.stubBackend || null // only set in test builds
    this.usingStub = false
  }
  async tryServer (fn) {
    if (!this.baseUrl) throw new Error('no lend url')
    const r = await fn()
    if (r.status === 404 || !r.json || r.json.enabled === false) throw new Error('lend server off')
    return r
  }
  async rate () {
    try {
      const r = await this.tryServer(() => request('GET', this.baseUrl + '/rate'))
      this.usingStub = false
      return Object.assign({ ok: r.status === 200 }, r.json)
    } catch (e) {
      if (this.stubBackend) { this.usingStub = true; return this.stubBackend.rate() }
      return { ok: false, enabled: false, error: 'unavailable' }
    }
  }
  async ledger (agent) {
    if (this.usingStub && this.stubBackend) return this.stubBackend.ledger(agent)
    try {
      const r = await this.tryServer(() => request('GET', this.baseUrl + '/agents/' + encodeURIComponent(agent)))
      return Object.assign({ ok: r.status === 200 }, r.json)
    } catch (e) {
      if (this.stubBackend) return this.stubBackend.ledger(agent)
      return { ok: false, error: 'unavailable', records: [], summary: summaryOf([]) }
    }
  }
  async deposit (agent, amountAtomic, x402) {
    if (this.usingStub && this.stubBackend) return this.stubBackend.deposit(agent, amountAtomic, x402)
    const env = this.sign && this.sign('lend_deposit', { amount: amountAtomic.toString(), asset: 'WSCDO', x402Ref: x402.ref })
    if (!env) return { ok: false, error: 'no agent key' }
    const r = await request('POST', this.baseUrl + '/deposit', env)
    return Object.assign({ ok: r.status === 200 }, r.json)
  }
  async withdraw (agent, amountAtomic) {
    if (this.usingStub && this.stubBackend) return this.stubBackend.withdraw(agent, amountAtomic)
    const env = this.sign && this.sign('lend_withdraw', { amount: amountAtomic.toString(), asset: 'WSCDO' })
    if (!env) return { ok: false, error: 'no agent key' }
    const r = await request('POST', this.baseUrl + '/withdraw', env)
    return Object.assign({ ok: r.status === 200 }, r.json)
  }
}
// Never show a rate whose interest payer is the treasury.
function safeRate (rate) {
  if (!rate || typeof rate !== 'object') return { ok: false, enabled: false }
  const payer = String(rate.interestPayer || '').toLowerCase()
  if (payer === TREASURY) return { ok: false, enabled: false, error: 'payer_is_treasury' }
  const bps = Number(rate.rateBps)
  return {
    ok: !!rate.ok,
    stub: !!rate.stub,
    enabled: rate.enabled !== false,
    rateBps: Number.isFinite(bps) && bps >= 0 ? bps : null,
    guaranteed: false,
    interestPayer: rate.interestPayer || '',
    interestPayerLabel: rate.interestPayerLabel || '',
    asOf: rate.asOf || null
  }
}

// ---- A) wheel auto-bet: client interface + STUB backend ----
// Interface the Games Ledger API must satisfy (to be mapped onto /workspace/wheel-autobet-api.md when it exists):
//   start({ agent, stake, lossLimit, sessionMinutes, payer }) -> { ok, sessionId } | { ok:false, error }
//   stop(sessionId) -> { ok }
//   status(sessionId) -> { running, rounds, staked, won, net, lastResult, stoppedBy, pause?, error? }
// Known error codes (HTTP):
//   403 region_blocked  -> turn the toggle off; UI: "Not available in your region" / 「所在地區暫不提供」
//   503 pool_paused     -> pause auto-bet, retry later; UI: "Wheel paused, pool refilling" / 「輪盤暫停，獎池補充中」
//                         (pool below 501 SCDO)
function mapWheelHttp (status, json) {
  json = json || {}
  const code = json.error || json.code || ''
  if (status === 403 || code === 'region_blocked') return { ok: false, error: 'region_blocked' }
  if (status === 503 || code === 'pool_paused') return { ok: false, error: 'pool_paused', pause: true, retryAfterMs: Number(json.retryAfterMs) > 0 ? Number(json.retryAfterMs) : 60_000 }
  if (status >= 200 && status < 300) return Object.assign({ ok: true }, json)
  return { ok: false, error: code || ('http_' + status) }
}
// Real client (unused until the Games Ledger URL is configured). Kept so the mapping is one place.
class GamesLedgerWheelClient {
  constructor (opts) { this.baseUrl = String(opts.baseUrl || '').replace(/\/$/, ''); this.stub = false }
  async start (cfg) {
    if (!this.baseUrl) return { ok: false, error: 'no_url' }
    const r = await request('POST', this.baseUrl + '/autobet/start', cfg)
    return mapWheelHttp(r.status, r.json)
  }
  async stop (sessionId) {
    if (!this.baseUrl) return { ok: true }
    const r = await request('POST', this.baseUrl + '/autobet/stop', { sessionId })
    return mapWheelHttp(r.status, r.json)
  }
  async status (sessionId) {
    if (!this.baseUrl) return { ok: false, error: 'no_url' }
    const r = await request('GET', this.baseUrl + '/autobet/status?sessionId=' + encodeURIComponent(sessionId || ''))
    return mapWheelHttp(r.status, r.json)
  }
}
class StubWheelBackend {
  constructor (opts) {
    this.stub = true
    this.now = (opts && opts.now) || Date.now
    this.rand = (opts && opts.rand) || Math.random
    this.s = null
    this.timer = null
    this.retryTimer = null
    this.roundMs = (opts && opts.roundMs) || 60000
    // Test hooks / env: SCDO_WHEEL_STUB_REGION=1 forces 403; SCDO_WHEEL_STUB_POOL_PAUSED=1 forces 503 on start/round.
    this.forceRegion = !!(opts && opts.forceRegion) || process.env.SCDO_WHEEL_STUB_REGION === '1'
    this.forcePoolPaused = !!(opts && opts.forcePoolPaused) || process.env.SCDO_WHEEL_STUB_POOL_PAUSED === '1'
    this.poolRetryMs = (opts && opts.poolRetryMs) || 60_000
  }
  async start (cfg) {
    if (this.forceRegion) return { ok: false, error: 'region_blocked', stub: true }
    if (this.forcePoolPaused) return { ok: false, error: 'pool_paused', pause: true, retryAfterMs: this.poolRetryMs, stub: true }
    if (this.s && this.s.running) return { ok: false, error: 'already_running' }
    this.s = { id: 'stub-wheel-' + this.now().toString(36), running: true, paused: false, startedAt: this.now(), stake: toAtomic(cfg.stake), lossLimit: toAtomic(cfg.lossLimit), sessionMs: Number(cfg.sessionMinutes) * 60000, rounds: 0, staked: 0n, won: 0n, lastResult: null, stoppedBy: '', pauseReason: '' }
    this.timer = setInterval(() => this.round(), this.roundMs)
    if (this.timer.unref) this.timer.unref()
    return { ok: true, stub: true, sessionId: this.s.id }
  }
  round () {
    const s = this.s; if (!s || !s.running || s.paused) return
    if (this.forcePoolPaused) return this.pausePool()
    if (this.now() - s.startedAt >= s.sessionMs) return this.halt('session')
    if (s.staked - s.won + s.stake > s.lossLimit) return this.halt('lossLimit')
    s.rounds += 1; s.staked += s.stake
    // stub outcome only (no SCDO moves): 0x, 0.5x, 2x
    const r = this.rand(); const mult = r < 0.5 ? 0n : r < 0.8 ? 5n : 20n
    const win = (s.stake * mult) / 10n
    s.won += win; s.lastResult = { round: s.rounds, stake: fromAtomic(s.stake), payout: fromAtomic(win), ts: this.now() }
    if (s.staked - s.won + s.stake > s.lossLimit) this.halt('lossLimit')
  }
  pausePool () {
    const s = this.s; if (!s) return
    s.paused = true; s.pauseReason = 'pool_paused'
    if (this.timer) { clearInterval(this.timer); this.timer = null }
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      // Stub only: clear the forced pause and resume the round timer if the session is still live.
      this.forcePoolPaused = false
      if (this.s && this.s.running) {
        this.s.paused = false; this.s.pauseReason = ''
        this.timer = setInterval(() => this.round(), this.roundMs)
        if (this.timer.unref) this.timer.unref()
      }
    }, this.poolRetryMs)
    if (this.retryTimer.unref) this.retryTimer.unref()
  }
  halt (why) {
    if (!this.s) return
    this.s.running = false; this.s.paused = false; this.s.stoppedBy = why; this.s.pauseReason = ''
    if (this.timer) clearInterval(this.timer); this.timer = null
    if (this.retryTimer) clearTimeout(this.retryTimer); this.retryTimer = null
  }
  async stop () { this.halt('user'); return { ok: true, stub: true } }
  async status () {
    const s = this.s
    if (!s) return { ok: true, stub: true, running: false, paused: false, rounds: 0, staked: '0', won: '0', net: '0', lastResult: null, stoppedBy: '' }
    return { ok: true, stub: true, running: s.running, paused: !!s.paused, pauseReason: s.pauseReason || '', sessionId: s.id, rounds: s.rounds, staked: fromAtomic(s.staked), won: fromAtomic(s.won), net: fromAtomic(s.won - s.staked), lastResult: s.lastResult, stoppedBy: s.stoppedBy, endsAt: s.startedAt + s.sessionMs }
  }
}

// ---- controller wired to IPC ----
function createController (opts) {
  const fl = flags(opts)
  const file = path.join(opts.userData, 'reward-destination.json')
  const readPrefs = () => { try { return cleanPrefs(JSON.parse(fs.readFileSync(file, 'utf8'))) } catch (e) { return cleanPrefs(DEFAULT_PREFS) } }
  const writePrefs = (p) => { const c = cleanPrefs(p); fs.mkdirSync(path.dirname(file), { recursive: true }); const t = file + '.tmp'; fs.writeFileSync(t, JSON.stringify(c, null, 1)); fs.renameSync(t, file); return c }
  const agentId = () => { try { const s = opts.agent && opts.agent(); return (s && s.status && s.status().agentId) || '' } catch (e) { return '' } }
  const lend = new LendClient({
    baseUrl: opts.lendUrl ? opts.lendUrl() : '',
    sign: (type, body) => { const a = opts.agent && opts.agent(); return a && a.signReward ? a.signReward(type, body) : null },
    stubBackend: fl.testBuild ? new StubLendBackend(path.join(opts.userData, 'reward-lend-stub.json')) : null
  })
  const payer = new StubX402Payer()
  const wheel = new StubWheelBackend(opts.wheelOpts)
  const off = { ok: false, error: 'not_in_this_build' }
  return {
    flags: fl,
    get () { return { flags: fl, prefs: readPrefs(), stubs: { wheel: true, x402: true, lend: lend.usingStub } } },
    setLend (on) { if (!fl.REWARD_LEND) return off; const p = readPrefs(); p.lend.on = on === true; return { ok: true, prefs: writePrefs(p) } },
    async setWheel (patch) {
      if (!fl.REWARD_AUTOWHEEL) return off
      const p = readPrefs(); patch = patch || {}
      const next = Object.assign({}, p.wheel, ['stake', 'lossLimit', 'sessionMinutes', 'on'].reduce((o, k) => { if (patch[k] !== undefined) o[k] = patch[k]; return o }, {}))
      next.on = next.on === true
      const bad = validateWheel(next); if (bad) return { ok: false, error: bad, prefs: p }
      p.wheel = next
      if (!next.on) await wheel.stop()
      return { ok: true, prefs: writePrefs(p) }
    },
    async wheelStart () {
      if (!fl.REWARD_AUTOWHEEL) return off
      const p = readPrefs(); if (!p.wheel.on) return { ok: false, error: 'off' }
      const bad = validateWheel(p.wheel); if (bad) return { ok: false, error: bad }
      const r = await wheel.start(Object.assign({ agent: agentId(), payer }, p.wheel))
      if (r && r.error === 'region_blocked') {
        p.wheel.on = false
        writePrefs(p)
        return Object.assign({}, r, { prefs: p })
      }
      return r
    },
    async wheelStop () { return wheel.stop() }, // always allowed, even when the feature is off
    async wheelStatus () { if (!fl.REWARD_AUTOWHEEL) return off; return wheel.status() },
    async lendRate () { if (!fl.REWARD_LEND) return off; return safeRate(await lend.rate()) },
    async lendLedger () { if (!fl.REWARD_LEND) return off; return lend.ledger(agentId()) },
    async lendDeposit (amount) {
      if (!fl.REWARD_LEND) return off
      if (!readPrefs().lend.on) return { ok: false, error: 'off' }
      const a = toAtomic(amount); if (a == null || a <= 0n) return { ok: false, error: 'amount' }
      const rate = safeRate(await lend.rate()); if (!rate.enabled) return { ok: false, error: rate.error || 'unavailable' }
      const x = await payer.pay({ to: 'lend-pool', amountAtomic: a, purpose: 'lend' })
      return lend.deposit(agentId(), a, x)
    },
    async lendWithdraw (amount) {
      // withdrawing principal is always allowed, even with the toggle off
      if (!fl.REWARD_LEND) return off
      const a = toAtomic(amount); if (a == null || a <= 0n) return { ok: false, error: 'amount' }
      return lend.withdraw(agentId(), a)
    },
    stopAll () { return wheel.stop() }
  }
}

module.exports = { TREASURY, flags, toAtomic, fromAtomic, cleanPrefs, validateWheel, summaryOf, safeRate, mapWheelHttp, GamesLedgerWheelClient, StubX402Payer, StubLendBackend, StubWheelBackend, LendClient, createController, DEFAULT_PREFS }
