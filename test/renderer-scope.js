// Page scripts share one global scope. A second top-level `const api` throws
// SyntaxError in the packaged app and the island, cat and 匯款 form never load.
'use strict'
const assert = require('assert')
process.on('unhandledRejection', (err) => {
  if (err && (err.name === 'SyntaxError' || err.name === 'ReferenceError')) {
    console.error(err)
    process.exit(1)
  }
})
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const root = path.join(__dirname, '..')
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
const srcs = []
const re = /<script src="([^"]+)"><\/script>/g
let m
while ((m = re.exec(html))) srcs.push(m[1].replace(/^\.\//, ''))
assert.ok(srcs.length >= 10)
assert.ok(srcs.indexOf('src/js/minePill.js') < srcs.indexOf('src/js/statusIsland.js'))
assert.ok(srcs.indexOf('src/js/statusIsland.js') < srcs.indexOf('src/js/aiCat.js'))
assert.ok(srcs.indexOf('src/js/aiCat.js') < srcs.indexOf('src/js/remitRoute.js'))
assert.ok(srcs.indexOf('src/js/remitRoute.js') < srcs.indexOf('src/js/app112.js'))

const sandbox = {
  console,
  setTimeout: () => 0,
  clearTimeout: () => {},
  setInterval: () => 0,
  clearInterval: () => {},
  queueMicrotask: (fn) => { try { fn() } catch (e) { sandbox.__late = e } },
  BigInt,
  URL,
  URLSearchParams,
  TextEncoder,
  TextDecoder,
  atob: (s) => Buffer.from(s, 'base64').toString('binary'),
  btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  navigator: { clipboard: { writeText: async () => {} }, language: 'zh-Hant' },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  location: { href: 'app://wallet/' }
}
sandbox.window = sandbox
sandbox.self = sandbox
sandbox.globalThis = sandbox
sandbox.document = {
  documentElement: { lang: 'zh-Hant', tagName: 'HTML' },
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ style: {}, setAttribute () {}, appendChild () {}, classList: { add () {}, remove () {} } }),
  addEventListener: () => {},
  createTextNode: (t) => ({ textContent: t })
}
sandbox.scdo = {
  platform: 'linux',
  on: () => () => {},
  invoke: async (ch) => {
    if (ch === 'wallet:boot') return { config: { lang: 'CN', connect: [] }, shard0: { cfg: { tokens: [] } }, ui: {} }
    if (ch === 'app:info') return { version: '3.0.1', displayVersion: '3.0.1', lang: 'CN' }
    return null
  }
}
sandbox.window.scdo = sandbox.scdo
vm.createContext(sandbox)

async function loadAll () {
for (const rel of srcs) {
  const code = fs.readFileSync(path.join(root, rel), 'utf8')
  try {
    const result = vm.runInContext(code, sandbox, { filename: rel })
    if (result && typeof result.then === 'function') {
      await result.catch(err => {
        if (err && (err.name === 'SyntaxError' || err.name === 'ReferenceError')) throw err
      })
    }
  } catch (err) {
    if (err && (err.name === 'SyntaxError' || err.name === 'ReferenceError')) {
      throw new Error(rel + ' failed in the shared page scope: ' + err.name + ': ' + err.message)
    }
    throw err
  }
}
assert.ok(sandbox.SCDOZpow && sandbox.SCDOZpow.parseClassicAddress)
assert.ok(sandbox.SCDOMinePill && sandbox.SCDOMinePill.formatMinePill)
assert.strictEqual(typeof sandbox.SCDOMinePill.format, 'undefined')
assert.ok(sandbox.SCDOIsland && sandbox.SCDOIsland.buildIsland)
assert.ok(sandbox.SCDOCat && sandbox.SCDOCat.planMine)
assert.ok(sandbox.SCDORemitRoute && sandbox.SCDORemitRoute.routePay)
assert.ok(sandbox.SafeDom && sandbox.I18N112)
if (sandbox.__late && (sandbox.__late.name === 'SyntaxError' || sandbox.__late.name === 'ReferenceError')) {
  throw sandbox.__late
}
}

loadAll().then(() => console.log('renderer-scope: ok')).catch(err => { console.error(err); process.exit(1) })
