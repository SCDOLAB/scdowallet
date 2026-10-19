// 3.1.11: the desktop agent always sends a valid Shard0 payout on register AND heartbeat (SCDO Agent Ledger rule
// 2026-10-19: agents without a valid payout are not listed or counted). Classic / placeholder payouts fall back to
// the wallet's own Shard0 account.
'use strict'
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { AgentService } = require('../src/agent/agentService')
const { payoutProblem, ledgerPayout } = require('../src/agent/payoutRule')
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'agp-'))
const OWN = '0x2d6F6ebc9686d0316e1f24F8588585C1f22fC956'

for (const bad of ['0x0000000000000000000000000000000000000000', '0x1111111111111111111111111111111111111111', '0x000000000000000000000000000000000000dEaD',
  '0x1234123412341234123412341234123412341234', '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', '1S01' + 'a'.repeat(37) + '1', '', null]) {
  assert.ok(payoutProblem(bad), 'refused ' + bad)
  assert.strictEqual(ledgerPayout(bad), '')
}
assert.strictEqual(payoutProblem(OWN), null)

function bodies (sent, type) {
  return sent.filter(s => s.url.endsWith('/' + type)).map(s => {
    const e = s.env
    const p = e.payload ? (typeof e.payload === 'string' ? JSON.parse(e.payload) : e.payload) : e
    return p.body || p
  })
}

async function run (host) {
  const sent = []
  const svc = new AgentService(tmp(), Object.assign({ version: '3.1.11', platform: 'win32', light: () => true, snapshot: async () => ({}), handlers: {} }, host),
    { ledgerUrl: 'http://127.0.0.1:9/agent-ledger/api', post: async (url, env) => { sent.push({ url, env }); return { ok: true, status: 200 } } })
  await svc.tick()
  return { svc, reg: bodies(sent, 'register'), hb: bodies(sent, 'heartbeat') }
}

;(async () => {
  // a real payout: sent on register and heartbeat
  let r = await run({ payoutAddress: () => OWN })
  assert.strictEqual(r.reg[0].payout, OWN)
  assert.strictEqual(r.hb[0].payout, OWN)
  // placeholder or classic payout: falls back to the wallet's own Shard0 account
  for (const p of ['0x1111111111111111111111111111111111111111', '1S01' + 'b'.repeat(37) + '2', '']) {
    r = await run({ payoutAddress: () => p, accountPayout: () => OWN })
    assert.strictEqual(r.reg[0].payout, OWN, 'fallback for ' + p)
    assert.strictEqual(r.hb[0].payout, OWN)
  }
  // no account at all: no fake payout is invented
  r = await run({ payoutAddress: () => '0x1111111111111111111111111111111111111111' })
  assert.strictEqual(r.reg[0].payout, undefined)
  console.log('agent-payout: ok')
})().catch(e => { console.error(e); process.exit(1) })
