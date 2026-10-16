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

const TICK_MS = 30 * 1000
const HEARTBEAT_MS = 5 * 60 * 1000
const DEFAULT_LEDGER = 'https://apeccapital.org/agent-ledger/api'
const PUBLIC_FIELDS = ['hashrate', 'gpuTempC', 'peers', 'localBlock', 'networkBlock', 'code', 'running', 'procs', 'gpuName', 'syncing']

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

class AgentService {
  // host: { snapshot(): Promise<snap>, handlers: { 'free-port'(a), 'restart-miner'(a), ... }, enabled(): bool, version, platform, label }
  constructor (dir, host, opts) {
    opts = opts || {}
    this.host = host
    this.id = identity.loadOrCreate(dir)
    this.log = new EventLog(dir)
    this.memo = heal.newMemo()
    this.ledger = opts.ledgerUrl || process.env.SCDO_AGENT_LEDGER || DEFAULT_LEDGER
    this.post = opts.post || postJson
    this.now = opts.now || (() => Date.now())
    this.registered = false
    this.lastBeat = 0
    this.lastSnap = null
    this.timer = null
  }

  reportingOn () { try { return this.host.enabled ? this.host.enabled() !== false : true } catch (e) { return true } }

  async send (type, body) {
    if (!this.reportingOn()) return { ok: false, error: 'disabled' }
    const env = this.id.sign(type, body, this.now())
    return this.post(this.ledger + '/' + type, env)
  }

  async register () {
    const r = await this.send('register', { version: String(this.host.version || ''), platform: String(this.host.platform || ''), label: String(this.host.label || '').slice(0, 40), role: 'wallet-miner' })
    if (r.ok) this.registered = true
    return r
  }

  async tick () {
    const now = this.now()
    if (!this.registered && this.reportingOn()) await this.register().catch(() => {})
    let snap
    try { snap = await this.host.snapshot() } catch (e) { snap = { error: e.message } }
    const { actions, problems } = heal.evaluate(snap, this.memo, now)
    snap.problems = problems
    this.lastSnap = snap
    const results = []
    for (const a of actions) {
      let outcome = 'reported'
      const fn = this.host.handlers && this.host.handlers[a.type]
      if (a.type !== 'report' && fn) {
        try { const r = await fn(a); outcome = r === false ? 'skipped' : 'done' } catch (e) { outcome = 'failed: ' + String(e && e.message || e).slice(0, 120) }
      } else if (a.type !== 'report') outcome = 'no-handler'
      const ev = this.log.append({ kind: 'heal', action: a.type, reason: a.reason, outcome, detail: a.pids ? { pids: a.pids } : (a.tempC != null ? { tempC: a.tempC } : undefined) })
      results.push(ev)
      if (this.registered) await this.send('heal', { action: a.type, reason: String(a.reason || '').slice(0, 200), outcome, problems: problems.map(p => p.code) }).catch(() => {})
    }
    if (this.registered && now - this.lastBeat >= HEARTBEAT_MS) {
      const r = await this.send('heartbeat', heartbeatBody(snap, this.host.version)).catch(() => ({ ok: false }))
      if (r && r.ok) this.lastBeat = now
    }
    return { actions: results, problems }
  }

  start () {
    if (this.timer) return
    this.log.append({ kind: 'agent', action: 'start', agentId: this.id.agentId })
    this.timer = setInterval(() => { this.tick().catch(() => {}) }, TICK_MS)
    if (this.timer.unref) this.timer.unref()
    setTimeout(() => this.tick().catch(() => {}), 20 * 1000).unref?.()
  }

  stop () { if (this.timer) clearInterval(this.timer); this.timer = null }

  status () { return { agentId: this.id.agentId, ledger: this.ledger, registered: this.registered, reporting: this.reportingOn(), problems: (this.lastSnap && this.lastSnap.problems) || [], events: this.log.recent(30) } }
}

module.exports = { AgentService, heartbeatBody, postJson, TICK_MS, HEARTBEAT_MS, DEFAULT_LEDGER, PUBLIC_FIELDS }
