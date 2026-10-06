'use strict'
const { Wallet } = require('ethers')
const Remit = require('../src/api/remit')
const { EventEmitter } = require('events')
class FakeIpc extends EventEmitter {
  constructor () { super(); this.handlers = new Map() }
  handle (ch, fn) { this.handlers.set(ch, fn) }
  async invoke (ch, ...args) { const e = { sender: { isDestroyed: () => false, send: (c, p) => this.emit('send', c, p) } }; return this.handlers.get(ch)(e, ...args) }
}
const keyA = Wallet.createRandom(); const keyB = Wallet.createRandom()
const decrypt = async (file, pw) => { if (pw !== 'ok') throw new Error('could not decrypt key with given passphrase'); if (file === 'A') return keyA.privateKey; if (file === 'B') return keyB.privateKey; throw new Error('unknown file') }
const svc = require('../src/main/remitService')
const ipc = new FakeIpc(); const steps = []
ipc.on('send', (c, p) => { if (c === 'remit:step') steps.push(p) })
svc.register(ipc, decrypt)
;(async () => {
  const info = await ipc.invoke('remit:info'); console.log('BASE', info.base)
  const bad = await ipc.invoke('remit:login', 'A', 'wrong'); console.log('BAD_PW', bad.ok, bad.wrongPw)
  const ok = await ipc.invoke('remit:login', 'A', 'ok'); console.log('LOGIN', ok.ok, ok.address, 'steps', steps.join(','))
  const own = await ipc.invoke('remit:ledger', keyA.address); console.log('OWN_LEDGER', own.ok)
  const foreign = await ipc.invoke('remit:ledger', keyB.address); console.log('FOREIGN_LEDGER_IPC', foreign.ok, foreign.foreign)
  const ch = await fetch(info.base + '/v1/session/challenge', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address: keyB.address }) }).then(r => r.json())
  const sig = await keyA.signMessage(ch.message)
  const fs = await fetch(info.base + '/v1/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address: keyB.address, message: ch.message, signature: sig }) })
  console.log('FOREIGN_SESSION_HTTP', fs.status)
  const okA = await ipc.invoke('remit:login', 'A', 'ok')
  // token-level: grab token via _test to prove gateway 403 on B ledger
  const tok = svc._test.session && svc._test.session.token
  const fl = await fetch(info.base + '/v1/ledger?address=' + keyB.address, { headers: { authorization: 'Bearer ' + tok } })
  console.log('FOREIGN_LEDGER_HTTP', fl.status)
  let clientForeign = false
  try { await Remit.login({ privateKey: keyA.privateKey, address: keyB.address, base: info.base, fetchImpl: async () => { throw new Error('no') } }) } catch (e) { clientForeign = e.code === 'FOREIGN_ADDRESS' }
  console.log('CLIENT_FOREIGN', clientForeign)
  const pass = info.base === 'https://scdoscan.io/remit-api' && bad.wrongPw && ok.ok && okA.ok && ok.address.toLowerCase() === keyA.address.toLowerCase() && own.ok && foreign.foreign && fs.status === 401 && fl.status === 403 && clientForeign
  console.log(pass ? 'PORT_LIVE_PASS' : 'PORT_LIVE_FAIL'); process.exit(pass ? 0 : 1)
})().catch(e => { console.error(e); process.exit(1) })
