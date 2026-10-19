// Reward destination (記帳獎勵去向), main process only.
//   A) SCDO points auto-play   B) Lend to treasury for interest
// 3.1.13 release rule (CEO): the UI ships on desktop direct downloads, but both toggles stay OFF, disabled and greyed
// ("Coming soon" / 「即將推出」) until BOTH of these are true:
//   1. the server capability probe (<agent ledger>/features) reports the feature live
//      (rewardWheel: Games Ledger auto-wheel API live; rewardLend: LEDGER_REWARD_LEND=on). Any error = off.
//   2. this client has a production backend for it (CLIENT_READY). 3.1.13 has no production x402 payer and no
//      auto-wheel client, so CLIENT_READY is false for both and a later release must flip it.
// No stub backend is shipped: the simulated wheel / lend / x402 backends live in test/support and are only
// passed in by unit tests. There is no env var, setting or deep link that turns A or B on.
// Store builds (build-info.json storeBuild:true) hide the section entirely.
'use strict'
const fs = require('fs')
const path = require('path')
const https = require('https')
const http = require('http')
const { URL } = require('url')

const TREASURY = '0x0889453fe946c75163b3bbdf2266f2566b2f4c03'
const WEI = 10n ** 18n

// ---- build flags ----
// REWARD_LEND / REWARD_AUTOWHEEL mean "the section is drawn" (desktop direct download). A store build
// (SCDO_STORE_BUILD=1 at build time -> build-info.json storeBuild:true) turns both off and nothing is drawn.
// Whether a toggle can be used at all is decided by createController().active() below.
function readBuildInfo (root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'build-info.json'), 'utf8')) } catch (e) { return {} }
}
function flags (opts) {
  opts = opts || {}
  const info = opts.buildInfo || readBuildInfo(opts.root || path.join(__dirname, '..', '..'))
  const storeBuild = info.storeBuild === true
  return Object.freeze({
    storeBuild,
    REWARD_LEND: !storeBuild,
    REWARD_AUTOWHEEL: !storeBuild
  })
}

// Production backends this build actually has. Both false in 3.1.13 (see header).
const CLIENT_READY = Object.freeze({ wheel: false, lend: false })
const CAPS_TTL_MS = 5 * 60_000

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

// ---- B) lend: server client ----
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
class LendClient {
  constructor (opts) {
    this.baseUrl = String(opts.baseUrl || '').replace(/\/$/, '')
    this.sign = opts.sign // (type, body) => envelope | null
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
      return Object.assign({ ok: r.status === 200 }, r.json)
    } catch (e) {
      return { ok: false, enabled: false, error: 'unavailable' }
    }
  }
  async ledger (agent) {
    try {
      const r = await this.tryServer(() => request('GET', this.baseUrl + '/agents/' + encodeURIComponent(agent)))
      return Object.assign({ ok: r.status === 200 }, r.json)
    } catch (e) {
      return { ok: false, error: 'unavailable', records: [], summary: summaryOf([]) }
    }
  }
  async deposit (agent, amountAtomic, x402) {
    const env = this.sign && this.sign('lend_deposit', { amount: amountAtomic.toString(), asset: 'WSCDO', x402Ref: x402.ref })
    if (!env) return { ok: false, error: 'no agent key' }
    const r = await request('POST', this.baseUrl + '/deposit', env)
    return Object.assign({ ok: r.status === 200 }, r.json)
  }
  async withdraw (agent, amountAtomic) {
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
    enabled: rate.enabled !== false,
    rateBps: Number.isFinite(bps) && bps >= 0 ? bps : null,
    guaranteed: false,
    interestPayer: rate.interestPayer || '',
    interestPayerLabel: rate.interestPayerLabel || '',
    asOf: rate.asOf || null
  }
}

// ---- A) wheel auto-bet: client interface ----
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
// ---- capability probe ----
// GET <agent ledger>/features -> { ok:true, rewardLend:bool, rewardWheel:bool }. Anything else counts as off.
function parseFeatures (res) {
  const off = { wheel: false, lend: false }
  if (!res || res.status !== 200 || !res.json || typeof res.json !== 'object' || res.json.ok !== true) return off
  return { wheel: res.json.rewardWheel === true, lend: res.json.rewardLend === true }
}

// ---- controller wired to IPC ----
// opts: userData, agent(), featuresUrl() -> string, buildInfo?, now?, fetchJson?(method,url) for tests,
//       backends? { wheel, lend, payer } - unit tests only; release main.js never passes it.
function createController (opts) {
  opts = opts || {}
  const fl = flags(opts)
  const now = opts.now || Date.now
  const b = opts.backends || {}
  const ready = opts.backends
    ? { wheel: !!(b.wheel && b.payer), lend: !!(b.lend && b.payer) }
    : CLIENT_READY
  const file = path.join(opts.userData, 'reward-destination.json')
  const readPrefs = () => { try { return cleanPrefs(JSON.parse(fs.readFileSync(file, 'utf8'))) } catch (e) { return cleanPrefs(DEFAULT_PREFS) } }
  const writePrefs = (p) => { const c = cleanPrefs(p); fs.mkdirSync(path.dirname(file), { recursive: true }); const t = file + '.tmp'; fs.writeFileSync(t, JSON.stringify(c, null, 1)); fs.renameSync(t, file); return c }
  const agentId = () => { try { const s = opts.agent && opts.agent(); return (s && s.status && s.status().agentId) || '' } catch (e) { return '' } }
  const off = { ok: false, error: 'not_in_this_build' }
  const soon = { ok: false, error: 'coming_soon' }

  let caps = { wheel: false, lend: false, checkedAt: 0 }
  let probing = null
  async function capabilities (force) {
    if (fl.storeBuild) return { wheel: false, lend: false }
    if (!force && caps.checkedAt && now() - caps.checkedAt < CAPS_TTL_MS) return caps
    if (probing) return probing
    probing = (async () => {
      let next = { wheel: false, lend: false }
      try {
        const url = typeof opts.featuresUrl === 'function' ? String(opts.featuresUrl() || '') : ''
        if (url) next = parseFeatures(await (opts.fetchJson || request)('GET', url, null, 5000))
      } catch (e) {}
      caps = Object.assign(next, { checkedAt: now() })
      return caps
    })()
    try { return await probing } finally { probing = null }
  }
  // A toggle is usable only when the section is in this build, the server says live, and this client has a real backend.
  async function active (force) {
    if (!ready.wheel && !ready.lend) return { wheel: false, lend: false } // 3.1.13: nothing to probe for
    const c = await capabilities(force)
    return { wheel: fl.REWARD_AUTOWHEEL && ready.wheel && c.wheel, lend: fl.REWARD_LEND && ready.lend && c.lend }
  }
  // Prefs as the user sees them: a feature that is not active is always off.
  function effective (p, a) { p.wheel.on = p.wheel.on && a.wheel; p.lend.on = p.lend.on && a.lend; return p }

  return {
    flags: fl,
    clientReady: ready,
    capabilities,
    active,
    async get () {
      const a = await active()
      return { flags: fl, prefs: effective(readPrefs(), a), active: a, comingSoon: { wheel: !a.wheel, lend: !a.lend } }
    },
    async setLend (on) {
      if (!fl.REWARD_LEND) return off
      const a = await active()
      const p = readPrefs()
      if (on === true && !a.lend) return Object.assign({ prefs: effective(p, a) }, soon)
      p.lend.on = on === true
      return { ok: true, prefs: effective(writePrefs(p), a) }
    },
    async setWheel (patch) {
      if (!fl.REWARD_AUTOWHEEL) return off
      const a = await active()
      const p = readPrefs(); patch = patch || {}
      if (!a.wheel) {
        // Turning it off is always allowed; anything else waits for the live API.
        if (patch.on === false && Object.keys(patch).length === 1) { p.wheel.on = false; return { ok: true, prefs: effective(writePrefs(p), a) } }
        return Object.assign({ prefs: effective(p, a) }, soon)
      }
      const next = Object.assign({}, p.wheel, ['stake', 'lossLimit', 'sessionMinutes', 'on'].reduce((o, k) => { if (patch[k] !== undefined) o[k] = patch[k]; return o }, {}))
      next.on = next.on === true
      const bad = validateWheel(next); if (bad) return { ok: false, error: bad, prefs: p }
      p.wheel = next
      if (!next.on && b.wheel) await b.wheel.stop()
      return { ok: true, prefs: effective(writePrefs(p), a) }
    },
    async wheelStart () {
      if (!fl.REWARD_AUTOWHEEL) return off
      const a = await active(); if (!a.wheel) return soon
      const p = readPrefs(); if (!p.wheel.on) return { ok: false, error: 'off' }
      const bad = validateWheel(p.wheel); if (bad) return { ok: false, error: bad }
      const r = await b.wheel.start(Object.assign({ agent: agentId(), payer: b.payer }, p.wheel))
      if (r && r.error === 'region_blocked') {
        p.wheel.on = false
        writePrefs(p)
        return Object.assign({}, r, { prefs: p })
      }
      return r
    },
    // Stop is always allowed (and a no-op when this build has no wheel backend).
    async wheelStop () { return b.wheel ? b.wheel.stop() : { ok: true } },
    async wheelStatus () {
      if (!fl.REWARD_AUTOWHEEL) return off
      if (!(await active()).wheel) return soon
      return b.wheel.status()
    },
    async lendRate () { if (!fl.REWARD_LEND) return off; if (!(await active()).lend) return soon; return safeRate(await b.lend.rate()) },
    async lendLedger () { if (!fl.REWARD_LEND) return off; if (!(await active()).lend) return soon; return b.lend.ledger(agentId()) },
    async lendDeposit (amount) {
      if (!fl.REWARD_LEND) return off
      if (!(await active()).lend) return soon
      if (!readPrefs().lend.on) return { ok: false, error: 'off' }
      const amt = toAtomic(amount); if (amt == null || amt <= 0n) return { ok: false, error: 'amount' }
      const rate = safeRate(await b.lend.rate()); if (!rate.enabled) return { ok: false, error: rate.error || 'unavailable' }
      const x = await b.payer.pay({ to: 'lend-pool', amountAtomic: amt, purpose: 'lend' })
      return b.lend.deposit(agentId(), amt, x)
    },
    async lendWithdraw (amount) {
      // Withdrawing principal stays allowed even if the server later turns lending off, as long as this build has a backend.
      if (!fl.REWARD_LEND) return off
      if (!ready.lend) return soon
      const amt = toAtomic(amount); if (amt == null || amt <= 0n) return { ok: false, error: 'amount' }
      return b.lend.withdraw(agentId(), amt)
    },
    stopAll () { return b.wheel ? b.wheel.stop() : Promise.resolve({ ok: true }) }
  }
}

module.exports = { TREASURY, CLIENT_READY, flags, toAtomic, fromAtomic, cleanPrefs, validateWheel, summaryOf, safeRate, mapWheelHttp, parseFeatures, request, GamesLedgerWheelClient, LendClient, createController, DEFAULT_PREFS }
