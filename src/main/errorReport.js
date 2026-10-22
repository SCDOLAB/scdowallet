// 3.1.15: automatic error reports. When bookkeeping fails to start (NO_POOL, ...), a miner crashes, or main/renderer
// throws, a redacted report (versions, OS, GPU, last ~500 log lines, error, clock skew) is gzipped and POSTed to
// https://scdo.com.au/api/wallet-report. Settings toggle "Send error reports automatically" (default ON).
// Nothing secret leaves the machine: redact() strips private keys, seeds, passwords, keystore JSON, 64-hex and bearer tokens.
'use strict'
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const ENDPOINT = 'https://scdo.com.au/api/wallet-report'
const TAIL_LINES = 500
const MAX_PER_HOUR = 5
const HOUR = 3600 * 1000

const R = '[REDACTED]'
const SECRET_KEYS = 'private[_ -]?key|privkey|secret|seed|mnemonic|phrase|password|passwd|passphrase|pwd|pin|token|api[_-]?key|auth(?:orization)?'
function redact (input) {
  let s = String(input == null ? '' : input)
  // PEM blocks
  s = s.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED_PEM]')
  // keystore JSON: the crypto object (ciphertext, kdfparams, mac, iv, salt)
  s = s.replace(/"(crypto|Crypto)"\s*:\s*\{(?:[^{}]|\{[^{}]*\})*\}/g, '"$1":' + JSON.stringify(R))
  s = s.replace(/"(ciphertext|mac|salt|iv)"\s*:\s*"[^"]*"/gi, '"$1":"' + R + '"')
  // bearer / basic auth
  s = s.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 ' + R)
  // key=value / "key": "value" for secret-ish names (JSON, query strings, CLI flags, log lines)
  s = s.replace(new RegExp('("?(?:' + SECRET_KEYS + ')"?\\s*[:=]\\s*)("[^"]*"|\'[^\']*\'|[^\\s,;&}]+)', 'gi'), (m, k) => k + '"' + R + '"')
  s = s.replace(new RegExp('(--?(?:' + SECRET_KEYS + ')[\\w-]*[ =])(\\S+)', 'gi'), '$1' + R)
  // any 64-hex (private keys, raw seeds); 40-hex public addresses are kept
  s = s.replace(/(?<![0-9a-fA-F])(?:0x)?[0-9a-fA-F]{64,}(?![0-9a-fA-F])/g, '[REDACTED_HEX64]')
  // bare mnemonic: 12-24 lowercase words (3-8 letters) in a row
  s = s.replace(/\b(?:[a-z]{3,8}[ \t]+){11,23}[a-z]{3,8}\b/g, m => { const n = m.trim().split(/\s+/).length; return [12, 15, 18, 21, 24].includes(n) ? '[REDACTED_MNEMONIC]' : m })
  return s
}

class RateLimiter {
  constructor (o) { o = o || {}; this.max = o.max || MAX_PER_HOUR; this.window = o.window || HOUR; this.now = o.now || Date.now; this.sent = []; this.seen = new Map() }
  // returns true when a report with this fingerprint may go now (and records it)
  allow (fp) {
    const t = this.now()
    this.sent = this.sent.filter(x => t - x < this.window)
    for (const [k, v] of this.seen) if (t - v >= this.window) this.seen.delete(k)
    if (this.seen.has(fp)) return false
    if (this.sent.length >= this.max) return false
    this.sent.push(t); this.seen.set(fp, t)
    return true
  }
}

function fingerprint (e) {
  const firstLine = String(e.message || '').split('\n')[0].replace(/\d+/g, '#').slice(0, 200)
  return [e.kind || '', e.code || '', firstLine].join('|')
}

function tailLines (file, n) {
  try {
    const st = fs.statSync(file)
    const len = Math.min(st.size, 256 * 1024)
    const fd = fs.openSync(file, 'r'); const b = Buffer.alloc(len)
    fs.readSync(fd, b, 0, len, st.size - len); fs.closeSync(fd)
    return b.toString('utf8').split(/\r?\n/).slice(-(n || TAIL_LINES)).join('\n')
  } catch (e) { return '' }
}

function buildReport (e, ctx) {
  ctx = ctx || {}
  const logs = {}
  for (const f of (ctx.logFiles || [])) { const t = tailLines(f, TAIL_LINES); if (t) logs[path.basename(f)] = t }
  const os = require('os')
  const doc = {
    schema: 1,
    kind: e.kind || 'error', code: e.code || '', message: String(e.message || '').slice(0, 4000), stack: String(e.stack || '').slice(0, 8000),
    context: e.context || null,
    app: { version: ctx.version || '', commit: ctx.commit || '', platform: process.platform, arch: process.arch, lang: ctx.lang || '' },
    os: { type: os.type(), release: os.release(), cpus: (os.cpus() || []).length, memGB: Math.round(os.totalmem() / 1e9) },
    gpu: ctx.gpu || null,
    time: { client: new Date().toISOString(), clientMs: Date.now(), skewMs: ctx.skewMs == null ? null : ctx.skewMs },
    logs
  }
  const extra = (ctx.scrub || []).map(String).filter(x => x.length >= 3)
  const clean = v => {
    if (typeof v === 'string') { let t = redact(v); for (const x of extra) t = t.split(x).join('[user]'); return t }
    if (Array.isArray(v)) return v.map(clean)
    if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = /^(private[_-]?key|privkey|seed|mnemonic|password|passphrase|keystore|crypto)$/i.test(k) ? R : clean(v[k]); return o }
    return v
  }
  return clean(doc)
}

function httpsJson (method, url, body, timeoutMs) {
  return new Promise((resolve) => {
    try {
      const u = new URL(url)
      if (u.protocol !== 'https:') return resolve({ status: 0 })
      const headers = { 'User-Agent': 'ScdoWallet-error-report' }
      if (body) { headers['Content-Type'] = 'application/json'; headers['Content-Encoding'] = 'gzip'; headers['Content-Length'] = body.length }
      const req = require('https').request(u, { method, headers, timeout: timeoutMs || 15000 }, res => {
        const chunks = []
        res.on('data', c => chunks.push(c))
        res.on('end', () => { let j = null; try { j = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch (e) {} resolve({ status: res.statusCode, json: j, date: res.headers.date }) })
      })
      req.on('timeout', () => req.destroy(new Error('timeout')))
      req.on('error', () => resolve({ status: 0 }))
      if (body) req.write(body)
      req.end()
    } catch (e) { resolve({ status: 0 }) }
  })
}

class ErrorReporter {
  // o: { enabled(), ctx() -> {version, commit, lang, gpu, logFiles, scrub}, onSent({id, code}), endpoint, limiter, post }
  constructor (o) { this.o = o || {}; this.limiter = this.o.limiter || new RateLimiter(); this.endpoint = this.o.endpoint || ENDPOINT; this.post = this.o.post || httpsJson; this.busy = false }
  async report (e) {
    try {
      e = e || {}
      if (this.o.enabled && !this.o.enabled()) return { ok: false, skipped: 'off' }
      if (!this.limiter.allow(fingerprint(e))) return { ok: false, skipped: 'rate' }
      const ctx = Object.assign({}, this.o.ctx ? await this.o.ctx(e) : {})
      const t0 = Date.now(); const ping = await this.post('GET', this.endpoint, null, 8000); const t1 = Date.now()
      if (ping && ping.json && ping.json.serverTime) ctx.skewMs = Math.round(ping.json.serverTime - (t0 + t1) / 2)
      const body = zlib.gzipSync(Buffer.from(JSON.stringify(buildReport(e, ctx))))
      if (body.length > 1900 * 1024) return { ok: false, skipped: 'size' }
      const r = await this.post('POST', this.endpoint, body, 20000)
      if (r && r.status === 200 && r.json && r.json.id) {
        try { if (this.o.onSent) this.o.onSent({ id: r.json.id, code: e.code || e.kind }) } catch (err) {}
        return { ok: true, id: r.json.id }
      }
      return { ok: false, status: r && r.status }
    } catch (err) { return { ok: false, error: err && err.message } }
  }
}

module.exports = { redact, RateLimiter, fingerprint, buildReport, tailLines, ErrorReporter, ENDPOINT }
