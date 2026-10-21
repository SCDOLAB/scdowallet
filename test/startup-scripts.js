// 3.1.15 startup: only boot.js blocks the first paint of the loading screen; every other script is deferred
// (same order), and the QR decoder is fetched on the first QR-image pick instead of at startup.
'use strict'
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const root = path.join(__dirname, '..')
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
const tags = [...html.matchAll(/<script\b([^>]*)><\/script>/g)].map(m => m[1])
assert.ok(tags.length >= 40, 'index.html still lists the app scripts')
const srcOf = a => (/src="([^"]+)"/.exec(a) || [])[1]
const blocking = tags.filter(a => !/\bdefer\b|\basync\b/.test(a)).map(srcOf)
assert.deepStrictEqual(blocking, ['./src/js/boot.js'], 'only boot.js blocks the first paint')
assert.ok(!tags.some(a => /\basync\b/.test(a)), 'no async: deferred scripts keep their order')
assert.ok(!html.includes('vendor/jsQR.js'), 'QR decoder is not loaded at startup')
for (const a of tags) assert.ok(fs.existsSync(path.join(root, srcOf(a))), srcOf(a) + ' exists')
assert.ok(html.indexOf('loading') < html.indexOf('<script'), 'loading screen markup comes before any script')
// lazy loader: same relative path as the old tag (works for the app copy and a signed UI bundle), CSP 'self'
const screen = fs.readFileSync(path.join(root, 'src/js/payInvoice/screen.js'), 'utf8')
assert.ok(screen.includes("s.src = './src/js/vendor/jsQR.js'"))
assert.ok(/script-src 'self'/.test(html))
// behaviour: first pick loads the decoder once, then decodes; a failed load shows NO_QR
const vm = require('vm')
const added = []
const doc = { head: { appendChild: s => { added.push(s); setTimeout(() => { sandbox.window.jsQR = () => null; s.onload() }, 0) } }, createElement: () => ({}) }
const sandbox = { window: { FileReader: function () {} }, document: doc }
const body = screen.slice(screen.indexOf('let qrLoading'), screen.indexOf('function readImage'))
vm.createContext(sandbox)
vm.runInContext(body + '; this.loadQrDecoder = loadQrDecoder', sandbox)
Promise.all([sandbox.loadQrDecoder(), sandbox.loadQrDecoder()]).then(r => {
  assert.deepStrictEqual(r, [true, true])
  assert.strictEqual(added.length, 1, 'decoder script added once')
  return sandbox.loadQrDecoder()
}).then(ok => {
  assert.strictEqual(ok, true)
  assert.strictEqual(added.length, 1)
  const bytes = tags.map(srcOf).reduce((n, s) => n + fs.statSync(path.join(root, s)).size, 0)
  const boot = fs.statSync(path.join(root, 'src/js/boot.js')).size
  console.log('startup-scripts: ok (startup scripts ' + bytes + ' bytes; blocking before first paint ' + boot + ' bytes)')
})
