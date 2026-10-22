// 3.1.15: automatic error reports — redaction, rate limit, report shape, wiring (no network)
'use strict'
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const zlib = require('zlib')
const { redact, RateLimiter, fingerprint, buildReport, ErrorReporter } = require('../src/main/errorReport')

const PK = 'a1'.repeat(32)
const ADDR = '0x' + 'B2'.repeat(20)
const PHRASE = 'abandon ability able about above absent absorb abstract absurd abuse access accident'
const KS = JSON.stringify({ address: 'b2'.repeat(20), crypto: { cipher: 'aes-128-ctr', ciphertext: 'deadbeef' + 'c'.repeat(56), cipherparams: { iv: '0011' }, kdf: 'scrypt', kdfparams: { salt: 'ffee' }, mac: 'abcd' }, version: 3 })
const samples = [
  'key 0x' + PK, 'key ' + PK, 'privateKey=' + PK.slice(0, 20), '{"password":"hunter2"}', 'password: hunter2', '--password hunter2',
  'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig', 'mnemonic=' + PHRASE.replace(/ /g, '-'), PHRASE, KS,
  '-----BEGIN EC PRIVATE KEY-----\nMHcCAQEE\n-----END EC PRIVATE KEY-----', 'seed: "' + PHRASE + '"', 'token=abcd1234efgh'
]
for (const s of samples) {
  const r = redact(s)
  for (const bad of [PK, 'hunter2', 'eyJhbGciOiJIUzI1NiJ9', 'abandon ability', 'deadbeef', 'MHcCAQEE', 'abcd1234efgh']) assert.ok(!r.includes(bad), 'redacted: ' + s + ' -> ' + r)
}
// public addresses and ordinary log text stay
assert.ok(redact('payout to ' + ADDR + ' failed: NO_POOL').includes(ADDR), 'address kept')
assert.strictEqual(redact('rigel exited (code 3) at block 123456'), 'rigel exited (code 3) at block 123456')
// a 64-hex tx hash is also removed (cannot tell it from a key) — accepted
assert.ok(!redact('tx 0x' + 'e'.repeat(64)).includes('e'.repeat(64)))

// rate limit: same error deduped within an hour, max 5/hour overall, window slides
let now = 1e12
const rl = new RateLimiter({ now: () => now })
const fp = n => fingerprint({ kind: 'start', code: 'C' + n, message: 'x' })
assert.ok(rl.allow(fp(1)))
assert.ok(!rl.allow(fp(1)), 'duplicate suppressed')
assert.strictEqual(fingerprint({ code: 'A', message: 'port 123 busy' }), fingerprint({ code: 'A', message: 'port 456 busy' }), 'numbers do not defeat dedupe')
for (let i = 2; i <= 5; i++) assert.ok(rl.allow(fp(i)))
assert.ok(!rl.allow(fp(6)), 'sixth in an hour refused')
now += 3600 * 1000 + 1
assert.ok(rl.allow(fp(6)) && rl.allow(fp(1)), 'window slides')

// report: tail ~500 lines, redacted, user name scrubbed, key fields dropped
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'errrep-'))
const log = path.join(dir, 'wallet-miner.log')
fs.writeFileSync(log, Array.from({ length: 900 }, (_, i) => 'line ' + i + (i === 899 ? ' pk ' + PK + ' user alice-pc' : '')).join('\n'))
const doc = buildReport({ kind: 'start', code: 'NO_POOL', message: 'pool not open', context: { password: 'x', addr: ADDR } }, { version: '3.1.15', commit: 'abc1234', logFiles: [log, path.join(dir, 'missing.log')], scrub: ['alice-pc'], skewMs: -42 })
const lines = doc.logs['wallet-miner.log'].split('\n')
assert.strictEqual(lines.length, 500); assert.ok(lines[0] === 'line 400')
const js = JSON.stringify(doc)
assert.ok(!js.includes(PK) && !js.includes('alice-pc') && js.includes(ADDR))
assert.strictEqual(doc.context.password, '[REDACTED]')
assert.ok(doc.code === 'NO_POOL' && doc.app.version === '3.1.15' && doc.app.commit === 'abc1234' && doc.time.skewMs === -42 && doc.os.type)

;(async () => {
  // reporter: gzip POST, skew from serverTime, toast callback, rate limit, off switch
  const calls = []; const sent = []
  let on = true
  const post = async (m, u, body) => { calls.push({ m, u, body }); return m === 'GET' ? { status: 200, json: { serverTime: Date.now() + 5000 } } : { status: 200, json: { id: '20261022-abc' } } }
  const rep = new ErrorReporter({ enabled: () => on, post, ctx: () => ({ version: '3.1.15', logFiles: [log] }), onSent: r => sent.push(r) })
  const r1 = await rep.report({ kind: 'start', code: 'NO_POOL', message: 'x' })
  assert.ok(r1.ok && r1.id === '20261022-abc' && sent[0].id === '20261022-abc')
  const p = calls.find(c => c.m === 'POST'); assert.ok(p.u.startsWith('https://'))
  const up = JSON.parse(zlib.gunzipSync(p.body).toString())
  assert.ok(up.time.skewMs > 4000 && up.time.skewMs < 6000, 'skew measured')
  assert.ok(!JSON.stringify(up).includes(PK))
  assert.strictEqual((await rep.report({ kind: 'start', code: 'NO_POOL', message: 'x' })).skipped, 'rate')
  on = false
  assert.strictEqual((await rep.report({ kind: 'start', code: 'OTHER', message: 'y' })).skipped, 'off')

  // wiring
  const main = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8')
  const pre = fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8')
  const app = fs.readFileSync(path.join(__dirname, '../src/js/app112.js'), 'utf8')
  assert.ok((main.match(/autoReport\(\{ kind: 'start'/g) || []).length === 2, 'both start-failure paths report')
  assert.ok(main.includes("onMinerStatusReport('shard0'") && main.includes("onMinerStatusReport('classic-gpu'") && main.includes("code: kind === 'crash' ? 'UNCAUGHT_EXCEPTION'"))
  assert.ok(main.includes('errorReports !== false'), 'default ON')
  for (const c of ['errorReport:get', 'errorReport:set', 'errorReport:renderer', 'errorReport:sent']) assert.ok(pre.includes("'" + c + "'"), c)
  assert.ok(app.includes("addEventListener('unhandledrejection'") && app.includes("T('errRepSent'"))
  global.window = {}; require('../src/js/i18n112.js')
  const { CN, EN } = global.window.I18N112
  for (const k of ['errRepToggle', 'errRepHint', 'errRepSent']) { assert.ok(EN[k] && CN[k], k); assert.ok(!/[\u3400-\u9fff]/.test(EN[k])); assert.ok(/[\u3400-\u9fff]/.test(CN[k])) }
  assert.strictEqual(EN.errRepToggle, 'Send error reports automatically')
  assert.ok(EN.errRepSent.startsWith('Error report sent') && EN.errRepSent.includes('{id}') && CN.errRepSent.includes('{id}'))
  // Traditional only: none of these Simplified forms
  for (const k of ['errRepToggle', 'errRepHint', 'errRepSent']) assert.ok(!/[错误报传设开启钱时会统显码题钥记词删编号发]/.test(CN[k]), 'CN.' + k + ' is Traditional')
  console.log('error-report: ok')
})().catch(e => { console.error(e); process.exit(1) })
