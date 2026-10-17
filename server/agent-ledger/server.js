// SCDO AI Agent Ledger v1 API. Trustless: verifies each machine's own signature; holds no private keys.
'use strict'
const http = require('http')
const { verifyEnvelope } = require('./envelope')
const { Store } = require('./store')

const CLOCK_SKEW_MS = 10 * 60 * 1000
const MAX_BODY = 8 * 1024
const AGENT_PER_MIN = 20
const IP_PER_MIN = 120
const MAX_AGENTS = 20000
const ONLINE_MS = 15 * 60 * 1000

function createApp (opts) {
  opts = opts || {}
  const store = opts.store || new Store(opts.dataDir || '/var/lib/scdo-agent-ledger')
  const now = opts.now || (() => Date.now())
  const buckets = new Map()
  function limited (key, max) {
    const t = now(); const b = buckets.get(key) || []
    const recent = b.filter(x => t - x < 60000); recent.push(t); buckets.set(key, recent)
    if (buckets.size > 50000) buckets.clear()
    return recent.length > max
  }

  function ingest (type, env, ip) {
    if (limited('ip:' + ip, IP_PER_MIN)) return [429, { ok: false, error: 'rate limited' }]
    const v = verifyEnvelope(env)
    if (!v.ok) return [400, { ok: false, error: v.error }]
    const p = env.payload
    if (p.type !== type) return [400, { ok: false, error: 'type mismatch' }]
    if (Math.abs(now() - p.ts) > CLOCK_SKEW_MS) return [400, { ok: false, error: 'clock' }]
    if (limited('a:' + p.agent.toLowerCase(), AGENT_PER_MIN)) return [429, { ok: false, error: 'rate limited' }]
    const a = store.get(p.agent)
    if (!a && type !== 'register') return [409, { ok: false, error: 'not registered' }]
    if (!a && store.size() >= MAX_AGENTS) return [503, { ok: false, error: 'full' }]
    if (a && p.seq <= a.seq) return [409, { ok: false, error: 'replay', seq: a.seq }]
    store.append(env)
    return [200, { ok: true, agent: v.agent, seq: p.seq }]
  }

  function summary (a, t) {
    const hb = a.heartbeat ? a.heartbeat.body : {}
    const last = a.heals.length ? a.heals[a.heals.length - 1] : null
    return {
      agent: a.agent, online: !!a.lastSeen && t - a.lastSeen < ONLINE_MS, firstSeen: a.firstSeen, lastSeen: a.lastSeen,
      version: hb.version || (a.registration && a.registration.body.version) || null,
      platform: a.registration ? a.registration.body.platform || null : null,
      payout: a.registration && a.registration.body && a.registration.body.payout || null,
      reports: a.counts.report || 0,
      hashrate: hb.hashrate ?? null, gpuTempC: hb.gpuTempC ?? null, peers: hb.peers ?? null,
      localBlock: hb.localBlock ?? null, networkBlock: hb.networkBlock ?? null, code: hb.code || null,
      problems: hb.problems || [], heals: a.counts.heal, heartbeats: a.counts.heartbeat,
      lastHeal: last ? { ts: last.ts, action: last.body.action, outcome: last.body.outcome } : null
    }
  }

  function handler (req, res) {
    const send = (code, obj) => { const b = JSON.stringify(obj); res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(b) }
    const url = String(req.url || '').replace(/^\/agent-ledger\/api/, '').replace(/^\/api/, '').split('?')[0]
    const ip = String(req.headers['x-real-ip'] || req.socket.remoteAddress || '')
    if (req.method === 'POST') {
      const m = url.match(/^\/(register|heartbeat|heal|report)$/)
      if (!m) return send(404, { ok: false, error: 'not found' })
      let body = ''; let over = false
      req.on('data', c => { body += c; if (body.length > MAX_BODY) { over = true; req.destroy() } })
      req.on('end', () => {
        if (over) return send(413, { ok: false, error: 'too large' })
        let env; try { env = JSON.parse(body) } catch (e) { return send(400, { ok: false, error: 'json' }) }
        const [code, out] = ingest(m[1], env, ip); send(code, out)
      })
      return
    }
    if (req.method !== 'GET') return send(405, { ok: false, error: 'method' })
    const t = now()
    if (url === '/health') return send(200, { ok: true, agents: store.size(), time: t })
    if (url === '/agents') {
      const list = [...store.agents.values()].map(a => summary(a, t)).sort((x, y) => (y.lastSeen || 0) - (x.lastSeen || 0))
      return send(200, { ok: true, time: t, total: list.length, online: list.filter(x => x.online).length, agents: list.slice(0, 500) })
    }
    const m = url.match(/^\/agents\/(0x[0-9a-fA-F]{40})$/)
    if (m) {
      const a = store.get(m[1]); if (!a) return send(404, { ok: false, error: 'unknown agent' })
      return send(200, { ok: true, summary: summary(a, t), registration: a.registration, heartbeat: a.heartbeat, heals: a.heals.slice(-20) })
    }
    send(404, { ok: false, error: 'not found' })
  }
  return { handler, ingest, store }
}

if (require.main === module) {
  const port = Number(process.env.PORT || 8147)
  const app = createApp({ dataDir: process.env.DATA_DIR })
  http.createServer(app.handler).listen(port, process.env.HOST || '127.0.0.1', () => console.log('agent-ledger listening on ' + port + ', agents ' + app.store.size()))
}
module.exports = { createApp, CLOCK_SKEW_MS, MAX_BODY }
