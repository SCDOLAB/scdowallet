// RC6: Copy writes the full address via main clipboard and only toasts "Copied" when it really landed.
'use strict'
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { clipWrite } = require('../src/main/clipWrite')
const root = path.join(__dirname, '..')
;(async () => {
  let buf = 'to'
  const good = { writeText: (t) => { buf = t }, readText: () => buf }
  const addr = '1S01ababababababababababababababababababa1'
  assert.deepStrictEqual(await clipWrite(good, addr), { ok: true, code: 'OK' })
  assert.strictEqual(buf, addr)
  const asyncRead = { writeText: (t) => { buf = t }, readText: async () => buf }
  assert.strictEqual((await clipWrite(asyncRead, '0x' + 'ab'.repeat(20))).ok, true)
  const stale = { writeText: () => {}, readText: () => 'to' }
  assert.strictEqual((await clipWrite(stale, addr)).ok, false)
  assert.strictEqual((await clipWrite(good, '')).ok, false)
  const app = fs.readFileSync(path.join(root, 'src/js/app112.js'), 'utf8')
  assert.ok(/api\.invoke\('clip:write', text\)/.test(app))
  assert.ok(/case 'copy': copyText\(v\)/.test(app))
  assert.ok(fs.readFileSync(path.join(root, 'preload.js'), 'utf8').includes("'clip:write'"))
  assert.ok(fs.readFileSync(path.join(root, 'main.js'), 'utf8').includes("ipcMain.handle('clip:write'"))
  for (const f of ['src/js/app112.js', 'src/js/chainHome.js', 'src/js/dashboard.js', 'src/js/agentJoin.js', 'src/js/payInvoice/screen.js']) {
    const s = fs.readFileSync(path.join(root, f), 'utf8')
    const re = /<button([^>]*data-act="copy"[^>]*)>/g; let m
    while ((m = re.exec(s))) assert.ok(/data-v=/.test(m[1]), f + ': copy button without data-v')
  }
  console.log('copy-clip: ok')
})().catch(e => { console.error(e); process.exit(1) })
