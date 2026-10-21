// AI Agent Ledger v1, wallet side. Every TICK: read live miner status, run healRules, apply the
// actions through host handlers, log events locally, and send signed heartbeats/heal events.
// Nothing here can spend funds; the wallet keystore is never touched. The agent key is separate.
'use strict'
const https = require('https')
const http = require('http')
const { URL } = require('url')
const identity = require('./identity')
const { joinBodyFields } = require('../js/agentJoin')
const { EventLog } = require('./eventLog')
const heal = require('./healRules')
const { parseClassicAddress, parseShard0Address } = require('../miner/zpow/address')
const { ledgerPayout } = require('./payoutRule')
const endpoints = require('../config/endpoints')
const selfMint = require('./selfMint')
const fs = require('fs')
const path = require('path')

const TICK_MS = 30 * 1000
const HEARTBEAT_MS = 5 * 60 * 1000
const DEFAULT_LEDGER = endpoints.DEFAULT_LEDGER
const FALLBACK_LEDGER = endpoints.FALLBACK_LEDGER
const PUBLIC_FIELDS = ['hashrate', 'gpuTempC', 'peers', 'localBlock', 'networkBlock', 'code', 'running', 'procs', 'gpuName', 'syncing']
const ATTEMPTS = 3
const RETRY_DELAY_MS = 400
// The ledger calls an agent online while its last accepted post is younger than this (ledger onlineMs).
const ONLINE_MS = 15 * 60 * 1000
// 3.1.12: re-register to pick up the x402 Base reserve when the ledger has not returned one yet.
const RESERVE_RETRY_MS = [60 * 1000, 2 * 60 * 1000, 5 * 60 * 1000, 10 * 60 * 1000, 15 * 60 * 1000]
const ADDR_RE = /^0x[0-9a-fA-F]{40}$/
// 3.1.15: retry pause for the ERC-8004 self-registration.
const SELF_MINT_RETRY_MS = 10 * 60 * 1000

function postJson (url, obj, timeoutMs) {
  return new Promise(resolve => {
    let u
    try { u = new URL(url) } catch (e) { return resolve({ ok: false, error: 'bad url' }) }
    const data = Buffer.from(JSON.stringify(obj))
    const lib = u.protocol === 'http:' ? http : https
    const req = lib.request(u, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': data.length }, timeout: timeoutMs || 10000 }, res => {
      let body = ''
      res.on('data', c => { if (body.length < 8192) body += c })
      res.on('end', () => { let j = null; try { j = JSON.parse(body) } catch (e) {} resolve({ ok: res.statusCode === 200 && !!(j && j.ok), status: res.statusCode, body: j }) })
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', e => resolve({ ok: false, error: e.message }))
    req.end(data)
  })
}

function statusCode (snap) {
  const raw = snap && snap.code != null ? String(snap.code).trim() : ''
  return raw || 'ONLINE'
}

function heartbeatBody (snap, version) {
  snap = snap || {}
  const b = { version: String(version || ''), code: statusCode(snap) }
  for (const k of PUBLIC_FIELDS) if (k !== 'code' && snap[k] !== undefined) b[k] = snap[k]
  if (Array.isArray(b.procs)) b.procs = b.procs.slice(0, 10).map(String)
  if (snap.problems) b.problems = snap.problems.map(p => p.code)
  return b
}

function validPayout (value) {
  const s = String(value || '').trim()
  const evm = parseShard0Address(s)
  if (evm) return evm.address
  const classic = parseClassicAddress(s)
  return classic ? classic.address : ''
}

function shouldRetry (r) {
  if (!r || r.ok) return false
  if (r.error === 'bad url' || r.error === 'disabled') return false
  const s = Number(r.status)
  if (s === 400 || s === 409 || s === 413) return false
  return true
}

function clip (v, n) { return String(v == null ? '' : v).replace(/0x[0-9a-fA-F]{64}/g, '0x[key]').slice(0, n) }

class AgentService {
  // host: { snapshot(): Promise<snap>, handlers: { 'free-port'(a), 'restart-miner'(a), ... }, enabled(): bool, version, platform, label, payoutAddress }
  constructor (dir, host, opts) {
    opts = opts || {}
    this.host = host
    this.id = identity.loadOrCreate(dir)
    this.log = new EventLog(dir)
    this.memo = heal.newMemo()
    this.ledgerPinned = !!(opts.ledgerUrl || (opts.env || process.env).SCDO_AGENT_LEDGER)
    this.ledgers = endpoints.ledgerUrls({ ledgerUrl: opts.ledgerUrl, env: opts.env || process.env, remote: opts.remote })
    if (!this.ledgers.length) this.ledgers = [DEFAULT_LEDGER, FALLBACK_LEDGER]
    this.ledger = this.ledgers[0]
    this.post = opts.post || postJson
    this.now = opts.now || (() => Date.now())
    this.attempts = opts.attempts || ATTEMPTS
    this.retryDelayMs = opts.retryDelayMs != null ? opts.retryDelayMs : RETRY_DELAY_MS
    this.sleep = opts.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)))
    this.registered = false
    this.registeredPayout = ''
    this.settled = false
    this.lastOkAt = 0
    this.usdcWallet = ''
    this.reserveTries = 0
    this.nextReserveAt = 0
    this.lastBeat = 0
    this.lastSnap = null
    this.timer = null
    // 3.1.15: ERC-8004 self-registration (Agent Ledger verified v1-2026-10-21). opts.selfMint === false turns it off.
    this.dir = dir
    // On for the real app (no injected post/ledgerUrl); tests and pinned dev ledgers opt in with opts.selfMint,
    // so they never touch the live chain. SCDO_AGENT_SELF_MINT=0 turns it off.
    this.selfMintOn = opts.selfMint != null ? opts.selfMint !== false
      : (!opts.post && !opts.ledgerUrl && String((opts.env || process.env).SCDO_AGENT_SELF_MINT || '') !== '0')
    this.rpc = opts.rpc || selfMint.httpRpc(postJson)
    this.selfMintState = null
    try { const j = JSON.parse(fs.readFileSync(path.join(dir, 'erc8004.json'), 'utf8')); if (j && j.self && j.tokenId) this.selfMintState = j } catch (e) {}
    this.selfMintBusy = null
    this.nextSelfMintAt = 0
  }

  // POST /gas/drip once (signed by the agent key). Resolves with the drip answer; throws on refusal.
  async requestDrip () {
    const env = this.id.sign('gas_drip', { purpose: 'erc8004_self_register' }, this.now())
    let last = null
    for (const base of this.ledgers) {
      try { last = await this.post(base.replace(/\/$/, '') + '/gas/drip', env, 120000) } catch (e) { last = { ok: false, error: e.message } }
      if (last && last.ok) return last.body
      if (last && (last.status === 400 || last.status === 403 || last.status === 429 || last.status === 503)) break
    }
    throw new Error('gas drip: ' + clip((last && ((last.body && last.body.error) || last.error || last.status)) || 'failed', 120))
  }

  // Starts one background self-registration when due. Never blocks the tick; a failure retries after SELF_MINT_RETRY_MS.
  kickSelfMint () {
    if (!this.selfMintOn || this.selfMintState || this.selfMintBusy || !this.registered || !this.reportingOn()) return null
    if (this.now() < this.nextSelfMintAt) return null
    if (!this.id.signTransaction || !ADDR_RE.test(String(this.id.address || ''))) return null
    this.selfMintBusy = selfMint.ensureSelfMint({
      address: this.id.address,
      rpc: this.rpc,
      signTx: tx => this.id.signTransaction(tx),
      requestDrip: () => this.requestDrip(),
      sleep: this.sleep
    }).then(r => {
      this.selfMintState = { v: 1, self: true, tokenId: r.tokenId, tx: r.tx, registry: selfMint.REGISTRY, uri: selfMint.agentURI(this.id.address) }
      try { fs.writeFileSync(path.join(this.dir, 'erc8004.json'), JSON.stringify(this.selfMintState), { mode: 0o600 }) } catch (e) {}
      this.note('erc8004', r.already ? 'already' : 'minted', { tokenId: r.tokenId, tx: r.tx })
      return this.selfMintState
    }).catch(e => {
      this.nextSelfMintAt = this.now() + SELF_MINT_RETRY_MS
      this.note('erc8004', 'failed', { error: clip(e && e.message || e, 200) })
      return null
    }).finally(() => { this.selfMintBusy = null })
    return this.selfMintBusy
  }

  reportingOn () { try { return this.host.enabled ? this.host.enabled() !== false : true } catch (e) { return true } }

  setRemote (doc) {
    if (this.ledgerPinned) return
    const urls = endpoints.ledgerUrls({ remote: doc, env: {} })
    if (urls.length) { this.ledgers = urls; this.ledger = urls[0] }
  }

  // 3.1.11: the ledger needs a valid Shard0/EVM payout. A classic (1S01…), placeholder or missing payout falls back to
  // the wallet's own Shard0 account (host.accountPayout), so every desktop agent is listed with a real payout.
  async payoutAddress () {
    let v = ''
    try {
      const src = this.host.payoutAddress
      v = typeof src === 'function' ? await src() : src
    } catch (e) { v = '' }
    const direct = ledgerPayout(validPayout(v))
    if (direct) return direct
    try {
      const f = this.host.accountPayout
      return ledgerPayout(typeof f === 'function' ? await f() : f)
    } catch (e) { return '' }
  }


  note (action, outcome, extra) {
    const rec = Object.assign({ kind: 'ledger', action, outcome }, extra || {})
    try { this.log.append(rec) } catch (e) {}
    console.warn('agent ledger', action, outcome, rec.error || rec.ledger || '')
  }

  async postLedger (type, env) {
    let last = { ok: false, error: 'no ledger' }
    for (let i = 0; i < this.ledgers.length; i++) {
      const base = this.ledgers[i]
      try { last = await this.post(base.replace(/\/$/, '') + '/' + type, env) } catch (e) { last = { ok: false, error: e.message } }
      if (last && last.ok) {
        if (base !== this.ledger) this.note('fallback', 'ok', { ledger: base })
        this.ledger = base
        if (i > 0) this.ledgers = [base].concat(this.ledgers.filter(u => u !== base))
        return last
      }
      this.note(type, 'failed', { error: clip((last && (last.error || last.status)) || 'failed', 200), ledger: base })
    }
    return last
  }

  async send (type, body) {
    if (!this.reportingOn()) return { ok: false, error: 'disabled' }
    const env = this.id.sign(type, body, this.now())
    const r = await this.postLedger(type, env)
    if (r && r.ok && (type === 'register' || type === 'heartbeat' || type === 'heal' || type === 'report')) {
      const wasOnline = this.online()
      this.lastOkAt = this.now()
      // Any accepted answer that carries the reserve fills it (the ledger assigns it when the agent posts).
      if (r.body && r.body.usdcWallet) this.noteReserve(r.body.usdcWallet)
      // The agent just went online (first accepted post, or the first after an offline gap) and still has
      // no reserve: ask for it now instead of waiting for the backoff. register handles its own answer.
      if (!wasOnline && type !== 'register' && !this.usdcWallet && this.registered) this.nextReserveAt = 0
    }
    return r
  }

  // 3.1.12: one online state for the card and the tray. Same rule as the ledger: registered and
  // an accepted post within ONLINE_MS.
  online () {
    return !!(this.registered && this.reportingOn() && this.lastOkAt && this.now() - this.lastOkAt < ONLINE_MS)
  }

  // The x402 Base reserve the ledger assigned (register response), or the one the card read from the ledger.
  noteReserve (address) {
    const a = String(address || '').trim()
    if (!ADDR_RE.test(a)) return false
    const changed = a !== this.usdcWallet
    this.usdcWallet = a
    this.reserveTries = 0
    this.nextReserveAt = 0
    if (changed) { try { if (typeof this.host.onReserve === 'function') this.host.onReserve(a) } catch (e) {} }
    return true
  }

  // Registered but no reserve yet: register again on a backoff (1, 2, 5, 10, then every 15 minutes).
  reserveDue (now) {
    if (!this.registered || this.usdcWallet) return false
    return now >= this.nextReserveAt
  }
  // 3.1.12: the reserve is assigned when the agent goes online. Called after the posts of a tick: if the
  // agent is online and still has no reserve and a request is due, register now (the ledger answers with it).
  async reserveOnOnline () {
    if (!this.reportingOn() || !this.online() || !this.reserveDue(this.now())) return false
    await this.register()
    return !!this.usdcWallet
  }
  scheduleReserve (now) {
    const i = Math.min(this.reserveTries, RESERVE_RETRY_MS.length - 1)
    this.nextReserveAt = now + RESERVE_RETRY_MS[i]
    this.reserveTries += 1
  }

  async deliver (type, body) {
    let last = { ok: false, error: 'not sent' }
    for (let attempt = 1; attempt <= this.attempts; attempt++) {
      try { last = await this.send(type, body) } catch (e) { last = { ok: false, error: e.message } }
      if (last && last.ok) return last
      if (!shouldRetry(last) || attempt === this.attempts) break
      this.note(type, 'retry', { attempt, error: clip((last && (last.error || last.status)) || 'failed', 200) })
      await this.sleep(this.retryDelayMs * attempt)
    }
    this.note(type, 'gave-up', { error: clip((last && (last.error || last.status)) || 'failed', 200) })
    return last
  }

  async joinExtra () {
    let v = {}
    try {
      const src = this.host.joinExtra
      v = typeof src === 'function' ? await src() : (src || {})
    } catch (e) { v = {} }
    return v || {}
  }

  // Live register. Optional ref, src, device and usdcWallet are the join delta.
  // A later register cannot change attribution: the server freezes the first ref/src.
  async register () {
    const payout = await this.payoutAddress()
    const body = { version: String(this.host.version || ''), platform: String(this.host.platform || ''), label: String(this.host.label || '').slice(0, 40), role: 'wallet-miner' }
    if (payout) body.payout = payout
    const extra = joinBodyFields(await this.joinExtra())
    Object.assign(body, extra)
    // 3.1.12: the x402 Base reserve is assigned when the agent goes online (its register is the first post
    // the ledger accepts; the ledger also fills it on a heartbeat). With no reserve chosen yet, ask for this
    // agent's own address (the ledger accepts it as self-proven). Only with a real payout, so the reserve
    // never stands in for a missing payout.
    if (!body.usdcWallet && payout && ADDR_RE.test(String(this.id.agentId || ''))) {
      body.usdcWallet = this.id.agentId
      body.x402Support = true
    }
    const r = await this.deliver('register', body)
    this.settled = true
    if (r && r.ok) {
      this.registered = true
      this.registeredPayout = payout
      const got = r.body && r.body.usdcWallet
      if (!this.noteReserve(got)) this.scheduleReserve(this.now())
    }
    return r
  }

  // One POST /agent-ledger/api/invite/claim. No retry loop: the screen paints on HTTP 200.
  async relayClaim (body) {
    const base = String(this.ledger || '').replace(/\/$/, '')
    if (!base) return { ok: false, status: 0 }
    return this.post(base + '/invite/claim', body || {})
  }

  // POST /agent-ledger/api/refcode. No seq. 409 means register first, then retry once.
  async refcode () {
    if (!this.id.signRefcode) return { ok: false, error: 'no refcode signer' }
    const env = this.id.signRefcode(this.now())
    let last = await this.postLedger('refcode', env)
    if (last && last.status === 409) {
      await this.register()
      const again = this.id.signRefcode(this.now())
      last = await this.postLedger('refcode', again)
    }
    return last
  }

  async reportError (info) {
    info = info || {}
    const body = {
      kind: info.kind === 'crash' ? 'crash' : 'error',
      message: clip(info.message, 500),
      stack: clip(info.stack, 1500),
      version: String(this.host.version || ''),
      platform: String(this.host.platform || '')
    }
    if (!this.registered && this.reportingOn()) await this.register()
    return this.deliver('report', body)
  }

  fail (where, err) {
    const error = clip(err && err.message || err || 'failed', 200)
    try { this.log.append({ kind: 'agent', action: where, outcome: 'failed', error }) } catch (e) {}
    console.warn('agent ' + where + ' failed', error)
  }

  async tick () {
    const now = this.now()
    const light = !!(this.host && this.host.light && this.host.light())
    if (this.reportingOn()) {
      const payout = await this.payoutAddress()
      if (!this.registered || (payout && payout !== this.registeredPayout)) await this.register()
      else if (this.reserveDue(now)) await this.register()
      this.kickSelfMint()
    } else this.settled = true
    if (light) {
      if (this.registered && now - this.lastBeat >= HEARTBEAT_MS) {
        const r = await this.deliver('heartbeat', this.withPayout(heartbeatBody({ code: 'ONLINE' }, this.host.version)))
        if (r && r.ok) this.lastBeat = now
      }
      await this.reserveOnOnline()
      return { actions: [], problems: [], light: true }
    }
    let snap
    try { snap = await this.host.snapshot() } catch (e) { snap = { error: e.message }; this.fail('snapshot', e) }
    const { actions, problems } = heal.evaluate(snap, this.memo, now)
    snap.problems = problems
    this.lastSnap = snap
    const results = []
    for (const a of actions) {
      let outcome = 'reported'
      const fn = this.host.handlers && this.host.handlers[a.type]
      if (a.type !== 'report' && fn) {
        try { const r = await fn(a); outcome = r === false ? 'skipped' : 'done' } catch (e) { outcome = 'failed: ' + clip(e && e.message || e, 120) }
      } else if (a.type !== 'report') outcome = 'no-handler'
      const ev = this.log.append({ kind: 'heal', action: a.type, reason: a.reason, outcome, detail: a.pids ? { pids: a.pids } : (a.tempC != null ? { tempC: a.tempC } : undefined) })
      results.push(ev)
      if (this.registered) await this.deliver('heal', { action: a.type, reason: String(a.reason || '').slice(0, 200), outcome, problems: problems.map(p => p.code) })
    }
    if (this.registered && now - this.lastBeat >= HEARTBEAT_MS) {
      const r = await this.deliver('heartbeat', this.withPayout(heartbeatBody(snap, this.host.version)))
      if (r && r.ok) this.lastBeat = now
    }
    await this.reserveOnOnline()
    return { actions: results, problems }
  }

  start () {
    if (this.timer) return
    this.log.append({ kind: 'agent', action: 'start', agentId: this.id.agentId })
    const run = () => { this.tick().catch(e => this.fail('tick', e)) }
    this.timer = setInterval(run, TICK_MS)
    if (this.timer.unref) this.timer.unref()
    const first = setTimeout(run, 20 * 1000)
    if (first.unref) first.unref()
  }

  // The window can be hidden. The heartbeat timer lives in this process, not in the page.
  nudge () {
    this.start()
    return this.tick().catch(e => this.fail('tick', e))
  }

  stop () { if (this.timer) clearInterval(this.timer); this.timer = null }

  // 3.1.11: every heartbeat carries the payout too (the ledger requires it).
  withPayout (body) {
    if (this.registeredPayout) body.payout = this.registeredPayout
    return body
  }

  status () { return { agentId: this.id.agentId, ledger: this.ledger, ledgers: this.ledgers.slice(), registered: this.registered, online: this.online(), settled: this.settled, started: !!this.timer, lastOkAt: this.lastOkAt || 0, usdcWallet: this.usdcWallet || '', payout: this.registeredPayout || '', reporting: this.reportingOn(), erc8004: this.selfMintState ? { tokenId: this.selfMintState.tokenId, tx: this.selfMintState.tx } : null, problems: (this.lastSnap && this.lastSnap.problems) || [], events: this.log.recent(30) } }
}

module.exports = { SELF_MINT_RETRY_MS, AgentService, heartbeatBody, postJson, validPayout, shouldRetry, TICK_MS, HEARTBEAT_MS, DEFAULT_LEDGER, FALLBACK_LEDGER, PUBLIC_FIELDS, ATTEMPTS, ONLINE_MS, RESERVE_RETRY_MS }
