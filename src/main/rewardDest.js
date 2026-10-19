// Reward destination (記帳獎勵去向), main process only.
//   A) SCDO points auto-play   B) Lend to treasury for interest
// Release rule (CEO): the UI ships on desktop direct downloads, but each toggle stays OFF, disabled and greyed
// ("Coming soon" / 「即將推出」) until BOTH of these are true:
//   1. the server capability probe (<agent ledger>/features) reports the feature live
//      (rewardWheel: agent-ledger LEDGER_REWARD_WHEEL=on; rewardLend: LEDGER_REWARD_LEND=on). Both default off. Any error = off.
//   2. this client has a production backend for it (CLIENT_READY).
//      3.1.14: A has the real Stake Wheel autobet client (StakeWheelAutobetClient); B has none (lend stays greyed).
// Even when active, A is opt-in per user and OFF by default; every start is confirmed with the wallet password.
// No stub backend is shipped: test doubles live in test/support and are only passed in by unit tests. There is no env var, setting or deep link that turns A or B on.
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

// Production backends this build actually has. 3.1.14: A (SCDO points auto-play) has the real Stake Wheel autobet
// client; B (lend) still has none. A is STILL greyed until <agent ledger>/features reports rewardWheel=true
// (agent-ledger LEDGER_REWARD_WHEEL=on, off by default; the CEO decides when).
const CLIENT_READY = Object.freeze({ wheel: true, lend: false })
// Stake Wheel autobet tiers (SCDO points per round) and the live API base.
const AUTOPLAY_TIERS = Object.freeze(['10', '100'])
const AUTOPLAY_BASE = 'https://scdo.com.au/games/stakewheel/api/autobet'
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
  wheel: { on: false, stake: '10', lossLimit: '100', sessionMinutes: 30 }
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
  if (!AUTOPLAY_TIERS.includes(String(w.stake))) return 'tier'
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

// ---- A) SCDO points auto-play (「SCDO 積分自動玩」): Stake Wheel autobet API errors ----
//   403 region_blocked    -> turn the toggle off; UI: "Not available in your region" / 「所在地區暫不提供」
//   503 pool_paused       -> session paused, retry later; UI: "Wheel paused, pool refilling" / 「輪盤暫停，獎池補充中」
//   503 autobet_disabled  -> service switched off server-side (treated as unavailable)
//   429 cap_exceeded, 400 invalid_signature / bad_or_expired_nonce -> shown as errors, nothing retried automatically
function mapWheelHttp (status, json) {
  json = json || {}
  const code = json.error || json.code || ''
  if (code === 'region_blocked' || status === 403) return { ok: false, error: 'region_blocked' }
  if (code === 'autobet_disabled') return { ok: false, error: 'autobet_disabled' }
  if (code === 'pool_paused' || status === 503) return { ok: false, error: 'pool_paused', pause: true, retryAfterMs: Number(json.retryAfterMs) > 0 ? Number(json.retryAfterMs) : 60_000 }
  if (code === 'cap_exceeded' || status === 429) return { ok: false, error: 'cap_exceeded' }
  if (status >= 200 && status < 300 && !code) return Object.assign({ ok: true }, json)
  return { ok: false, error: code || ('http_' + status) }
}
// Rounds and prepaid amount for one opt-in session: 1 round per minute, never more than the loss limit allows.
function autoplayPlan (w) {
  const stake = toAtomic(w.stake); const loss = toAtomic(w.lossLimit)
  if (stake == null || loss == null || stake <= 0n) return null
  const byLoss = Number(loss / stake)
  const rounds = Math.max(0, Math.min(Number(w.sessionMinutes) || 0, byLoss))
  if (rounds < 1) return null
  return { tier: Number(w.stake), rounds, prepaid: fromAtomic(stake * BigInt(rounds)) }
}
// Server status -> the shape the renderer draws (rounds, staked, won, net, running, paused, stoppedBy, lastResult).
function mapAutoplayStatus (j) {
  j = j || {}
  const sess = j.session && typeof j.session === 'object' ? j.session : j
  const state = String(sess.state || sess.status || '').toLowerCase()
  const num = (...ks) => { for (const k of ks) if (sess[k] != null && sess[k] !== '') return String(sess[k]); return '0' }
  const paused = sess.paused === true || state === 'paused' || sess.pause_reason === 'pool_paused'
  return {
    ok: true,
    found: j.found !== false,
    sessionId: sess.session_id || sess.sessionId || null,
    running: sess.running === true || state === 'running' || state === 'active' || paused,
    paused,
    pauseReason: paused ? (sess.pause_reason || 'pool_paused') : null,
    rounds: Number(num('rounds_played', 'rounds_done', 'played')) || 0,
    staked: num('staked', 'total_staked'),
    won: num('paid_out', 'payout', 'won', 'total_paid'),
    net: num('net'),
    stoppedBy: sess.stopped_by || sess.stoppedBy || null,
    lastResult: sess.last_round || sess.lastResult || null
  }
}
// Real Stake Wheel "SCDO points auto-play" client (/games/stakewheel/api/autobet/{challenge,start,stop,status,rounds}).
// Auth: EIP-191 personal_sign of the server challenge; start also pays tier*rounds SCDO points (prepaid_tx) to pay_to.
// opts: baseUrl, sign({file,password,message,payTo?,amount?}) -> {address,signature,txHash?} (walletService.autoplaySign),
//       request(method,url,body,timeoutMs) (tests inject a mock), stateFile (remembers address + session id).
class StakeWheelAutobetClient {
  constructor (opts) {
    opts = opts || {}
    this.baseUrl = String(opts.baseUrl || AUTOPLAY_BASE).replace(/\/$/, '')
    this.sign = opts.sign
    this.req = opts.request || request
    this.stateFile = opts.stateFile || ''
  }
  _state () { try { return JSON.parse(fs.readFileSync(this.stateFile, 'utf8')) || {} } catch (e) { return {} } }
  _save (st) { if (!this.stateFile) return; try { fs.mkdirSync(path.dirname(this.stateFile), { recursive: true }); fs.writeFileSync(this.stateFile, JSON.stringify(st)) } catch (e) {} }
  async _challenge (address, action, extra) {
    const q = new URLSearchParams(Object.assign({ address, action }, extra || {}))
    const r = await this.req('GET', this.baseUrl + '/challenge?' + q.toString(), null, 15000)
    const m = mapWheelHttp(r.status, r.json)
    if (!m.ok) return m
    if (!m.message || !m.nonce) return { ok: false, error: 'bad_challenge' }
    return m
  }
  // cfg: { file, password, address, stake (tier), lossLimit, sessionMinutes }
  async start (cfg) {
    cfg = cfg || {}
    if (typeof this.sign !== 'function') return { ok: false, error: 'no_signer' }
    if (!cfg.file || !cfg.address) return { ok: false, error: 'no_account' }
    if (!cfg.password) return { ok: false, error: 'password' }
    const plan = autoplayPlan(cfg); if (!plan) return { ok: false, error: 'lossBelowStake' }
    const ch = await this._challenge(cfg.address, 'start', { tier: plan.tier, rounds: plan.rounds })
    if (!ch.ok) return ch
    const payTo = String(ch.pay_to || '')
    if (!/^0x[0-9a-fA-F]{40}$/.test(payTo)) return { ok: false, error: 'bad_challenge' }
    if (payTo.toLowerCase() === TREASURY) return { ok: false, error: 'payer_is_treasury' }
    if (ch.amount != null && toAtomic(String(ch.amount)) !== toAtomic(plan.prepaid)) return { ok: false, error: 'amount_mismatch' }
    let sig
    try { sig = await this.sign({ file: cfg.file, password: cfg.password, message: ch.message, payTo, amount: plan.prepaid }) } catch (e) { return { ok: false, error: String((e && e.message) || e) } }
    if (!sig || String(sig.address).toLowerCase() !== String(cfg.address).toLowerCase()) return { ok: false, error: 'KEY_MISMATCH' }
    const r = await this.req('POST', this.baseUrl + '/start', { address: sig.address, nonce: ch.nonce, signature: sig.signature, prepaid_tx: sig.txHash, tier: plan.tier, rounds: plan.rounds }, 20000)
    const m = mapWheelHttp(r.status, r.json)
    if (m.ok) this._save({ address: sig.address, sessionId: m.session_id || m.sessionId || null, prepaidTx: sig.txHash })
    return Object.assign(m, { prepaidTx: sig.txHash, tier: plan.tier, rounds: plan.rounds })
  }
  // Stop needs a signed stop challenge (no payment). cfg: { file, password, address? }
  async stop (cfg) {
    cfg = cfg || {}
    const st = this._state()
    const address = cfg.address || st.address
    if (!address) return { ok: true } // nothing was started from this wallet
    if (!cfg.file || !cfg.password || typeof this.sign !== 'function') return { ok: false, error: 'password' }
    const ch = await this._challenge(address, 'stop', st.sessionId ? { session_id: st.sessionId } : null)
    if (!ch.ok) return ch
    let sig
    try { sig = await this.sign({ file: cfg.file, password: cfg.password, message: ch.message }) } catch (e) { return { ok: false, error: String((e && e.message) || e) } }
    const r = await this.req('POST', this.baseUrl + '/stop', { address: sig.address, nonce: ch.nonce, signature: sig.signature, session_id: st.sessionId || undefined }, 20000)
    return mapWheelHttp(r.status, r.json)
  }
  async status (address) {
    const st = this._state()
    const a = address || st.address
    if (!a) return { ok: true, found: false, running: false, rounds: 0, staked: '0', won: '0', net: '0' }
    const r = await this.req('GET', this.baseUrl + '/status?address=' + encodeURIComponent(a), null, 10000)
    const m = mapWheelHttp(r.status, r.json)
    if (!m.ok) return m
    return mapAutoplayStatus(r.json)
  }
  async rounds (address) {
    const a = address || this._state().address
    if (!a) return { ok: true, rounds: [] }
    const r = await this.req('GET', this.baseUrl + '/rounds?address=' + encodeURIComponent(a), null, 10000)
    const m = mapWheelHttp(r.status, r.json)
    if (!m.ok) return m
    return { ok: true, rounds: Array.isArray(r.json) ? r.json : (r.json.rounds || r.json.rows || []) }
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
  // Release: the real auto-play client (opts.autoplay = { sign, accounts, baseUrl? }). Tests may pass opts.backends.
  const b = opts.backends || {
    wheel: opts.autoplay && typeof opts.autoplay.sign === 'function'
      ? new StakeWheelAutobetClient({ baseUrl: opts.autoplay.baseUrl, sign: opts.autoplay.sign, request: opts.autoplay.request, stateFile: path.join(opts.userData, 'autoplay-session.json') })
      : null
  }
  const ready = opts.backends
    ? { wheel: !!b.wheel, lend: !!(b.lend && b.payer) }
    : { wheel: CLIENT_READY.wheel && !!b.wheel, lend: CLIENT_READY.lend && !!(b.lend && b.payer) }
  const accounts = () => { try { return ((opts.autoplay && opts.autoplay.accounts && opts.autoplay.accounts()) || []).filter(a => a && a.file && /^0x[0-9a-fA-F]{40}$/.test(a.address || '')) } catch (e) { return [] } }
  const accountFor = (file) => accounts().find(a => a.file === file) || null
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
      return { flags: fl, prefs: effective(readPrefs(), a), active: a, comingSoon: { wheel: !a.wheel, lend: !a.lend }, accounts: a.wheel ? accounts().map(x => ({ file: x.file, address: x.address })) : [] }
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
      return { ok: true, prefs: effective(writePrefs(p), a) }
    },
    // args: { file, password } - the user confirms each start with the wallet password (sign + prepaid payment).
    async wheelStart (args) {
      if (!fl.REWARD_AUTOWHEEL) return off
      const a = await active(); if (!a.wheel) return soon
      const p = readPrefs(); if (!p.wheel.on) return { ok: false, error: 'off' }
      const bad = validateWheel(p.wheel); if (bad) return { ok: false, error: bad }
      args = args || {}
      const acc = opts.backends ? { file: args.file, address: args.address } : accountFor(args.file)
      if (!acc) return { ok: false, error: 'no_account' }
      const r = await b.wheel.start(Object.assign({ agent: agentId(), payer: b.payer }, p.wheel, { file: acc.file, address: acc.address, password: args.password }))
      if (r && r.error === 'region_blocked') {
        p.wheel.on = false
        writePrefs(p)
        return Object.assign({}, r, { prefs: p })
      }
      return r
    },
    // Stop is always allowed (no capability check), so a running session can always be ended.
    async wheelStop (args) {
      if (!b.wheel) return { ok: true }
      args = args || {}
      const acc = opts.backends ? { file: args.file, address: args.address } : accountFor(args.file)
      return b.wheel.stop(Object.assign({}, acc || {}, { password: args.password }))
    },
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
    // App quit: the server-side session keeps its own limits; a signed stop needs the password, so nothing to do here.
    stopAll () { return Promise.resolve({ ok: true }) }
  }
}

module.exports = { TREASURY, CLIENT_READY, AUTOPLAY_TIERS, AUTOPLAY_BASE, autoplayPlan, mapAutoplayStatus, StakeWheelAutobetClient, flags, toAtomic, fromAtomic, cleanPrefs, validateWheel, summaryOf, safeRate, mapWheelHttp, parseFeatures, request, LendClient, createController, DEFAULT_PREFS }
