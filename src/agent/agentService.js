// AI Agent Ledger v1, wallet side. Every TICK: read live miner status, run healRules, apply the
// actions through host handlers, log events locally, and send signed heartbeats/heal events.
// Nothing here can spend funds; the wallet keystore is never touched. The agent key is separate.
'use strict'
const https = require('https')
const http = require('http')
const { URL } = require('url')
const identity = require('./identity')
const { EventLog } = require('./eventLog')
const heal = require('./healRules')
const { parseClassicAddress, parseShard0Address } = require('../miner/zpow/address')
const endpoints = require('../config/endpoints')

const TICK_MS = 30 * 1000
const HEARTBEAT_MS = 5 * 60 * 1000
const DEFAULT_LEDGER = endpoints.DEFAULT_LEDGER
const FALLBACK_LEDGER = endpoints.FALLBACK_LEDGER
const PUBLIC_FIELDS = ['hashrate', 'gpuTempC', 'peers', 'localBlock', 'networkBlock', 'code', 'running', 'procs', 'gpuName', 'syncing']
const ATTEMPTS = 3
const RETRY_DELAY_MS = 400

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

function heartbeatBody (snap, version) {
  const b = { version: String(version || '') }
  for (const k of PUBLIC_FIELDS) if (snap[k] !== undefined) b[k] = snap[k]
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
    this.lastBeat = 0
    this.lastSnap = null
    this.timer = null
  }

  reportingOn () { try { return this.host.enabled ? this.host.enabled() !== false : true } catch (e) { return true } }

  setRemote (doc) {
    if (this.ledgerPinned) return
    const urls = endpoints.ledgerUrls({ remote: doc, env: {} })
    if (urls.length) { this.ledgers = urls; this.ledger = urls[0] }
  }

  async payoutAddress () {
    let v = ''
    try {
      const src = this.host.payoutAddress
      v = typeof src === 'function' ? await src() : src
    } catch (e) { v = '' }
    return validPayout(v)
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
    return this.postLedger(type, env)
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

  async register () {
    const payout = await this.payoutAddress()
    const body = { version: String(this.host.version || ''), platform: String(this.host.platform || ''), label: String(this.host.label || '').slice(0, 40), role: 'wallet-miner' }
    if (payout) body.payout = payout
    const r = await this.deliver('register', body)
    if (r && r.ok) { this.registered = true; this.registeredPayout = payout }
    return r
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
    if (this.reportingOn()) {
      const payout = await this.payoutAddress()
      if (!this.registered || (payout && payout !== this.registeredPayout)) await this.register()
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
      const r = await this.deliver('heartbeat', heartbeatBody(snap, this.host.version))
      if (r && r.ok) this.lastBeat = now
    }
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

  stop () { if (this.timer) clearInterval(this.timer); this.timer = null }

  status () { return { agentId: this.id.agentId, ledger: this.ledger, ledgers: this.ledgers.slice(), registered: this.registered, payout: this.registeredPayout || '', reporting: this.reportingOn(), problems: (this.lastSnap && this.lastSnap.problems) || [], events: this.log.recent(30) } }
}

module.exports = { AgentService, heartbeatBody, postJson, validPayout, shouldRetry, TICK_MS, HEARTBEAT_MS, DEFAULT_LEDGER, FALLBACK_LEDGER, PUBLIC_FIELDS, ATTEMPTS }
