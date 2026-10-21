// 3.1.15: ERC-8004 self-registration (Agent Ledger verified v1-2026-10-21). Fake Shard0 RPC + fake ledger, no network.
'use strict'
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { Transaction, Interface, getAddress, zeroPadValue, toBeHex } = require('ethers')
const selfMint = require('../src/agent/selfMint')
const { AgentService } = require('../src/agent/agentService')
const { verifyEnvelope } = require('../src/agent/envelope')

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'selfmint-'))
const iface = new Interface(['function ownerOf(uint256) view returns (address)'])

function chain (agentAddr, opts) {
  opts = opts || {}
  const st = { funded: !!opts.funded, minted: null, sent: [], calls: [], dripAt: null }
  const regLog = (id, tx) => ({ topics: [selfMint.REGISTERED, toBeHex(id, 32), zeroPadValue(agentAddr, 32).toLowerCase()], transactionHash: tx })
  st.rpc = async (m, p) => {
    st.calls.push(m)
    switch (m) {
      case 'eth_getLogs': return st.minted ? [regLog(st.minted.id, st.minted.tx)] : (opts.foreign ? [regLog(7, '0x' + 'ab'.repeat(32))] : [])
      case 'eth_call': return iface.encodeFunctionResult('ownerOf', [agentAddr])
      case 'eth_getTransactionByHash': return { from: (opts.foreign && !st.minted) ? '0x48dc8ec5a153641e4a6e5f1fc4452f82452f6357' : agentAddr.toLowerCase() }
      case 'eth_estimateGas': return '0x48cb9'
      case 'eth_gasPrice': return '0x3b9aca00'
      case 'eth_getBalance': return st.funded ? '0x71afd498d0000' : '0x0'
      case 'eth_getTransactionCount': return '0x0'
      case 'eth_sendRawTransaction': {
        if (!st.funded) throw new Error('mint sent before the drip was confirmed')
        const tx = Transaction.from(p[0])
        assert.strictEqual(getAddress(tx.from), getAddress(agentAddr), 'mint must come from the agent key')
        assert.strictEqual(getAddress(tx.to), getAddress(selfMint.REGISTRY))
        assert.strictEqual(Number(tx.chainId), 5680)
        assert.ok(tx.data.startsWith('0x8ea42286'), 'register(string,(string,bytes)[]) selector')
        st.sent.push(tx); const h = '0x' + 'cd'.repeat(32); st.minted = { id: 31, tx: h }; return h
      }
      case 'eth_getTransactionReceipt': return { status: '0x1', logs: [regLog(31, '0x' + 'cd'.repeat(32))] }
      default: throw new Error('unexpected ' + m)
    }
  }
  return st
}

;(async () => {
  // 1. Funded agent mints itself; a second run finds it and sends nothing.
  const w = require('ethers').Wallet.createRandom()
  const c1 = chain(w.address, { funded: true })
  const r1 = await selfMint.ensureSelfMint({ address: w.address, rpc: c1.rpc, signTx: tx => w.signTransaction(tx), sleep: async () => {} })
  assert.deepStrictEqual([r1.already, r1.tokenId, c1.sent.length], [false, '31', 1])
  const r1b = await selfMint.ensureSelfMint({ address: w.address, rpc: c1.rpc, signTx: tx => w.signTransaction(tx), sleep: async () => {} })
  assert.deepStrictEqual([r1b.already, r1b.tokenId, c1.sent.length], [true, '31', 1])

  // 2. A deployer-minted token does not count (tx.from != agent); unfunded without a drip fails without sending.
  const c2 = chain(w.address, { foreign: true })
  await assert.rejects(selfMint.ensureSelfMint({ address: w.address, rpc: c2.rpc, signTx: tx => w.signTransaction(tx), sleep: async () => {} }), /no SCDO for gas/)
  assert.strictEqual(c2.sent.length, 0)

  // 3. AgentService end to end: register -> signed gas_drip -> wait for balance -> agent-key mint -> erc8004.json + status.
  const dir = tmp()
  let svc
  const posts = []
  const post = async (url, env) => {
    posts.push(url)
    if (url.endsWith('/gas/drip')) {
      const v = verifyEnvelope(env)
      assert.ok(v.ok, 'drip envelope is signed by the agent key')
      assert.strictEqual(env.payload.type, 'gas_drip')
      assert.strictEqual(getAddress(env.payload.agent), getAddress(svc.id.address))
      setTimeout(() => { cs.funded = true }, 20)
      return { ok: true, status: 200, body: { ok: true, dripped: true, tx: '0x' + 'ee'.repeat(32), status: 'confirmed' } }
    }
    return { ok: true, status: 200, body: { ok: true } }
  }
  let cs = null
  svc = new AgentService(dir, { version: '3.1.15', platform: 'win32', light: () => true, snapshot: async () => ({}), handlers: {}, payoutAddress: () => '0x2d6f6ebc9686d0316e1f24f8588585c1f22fc956' },
    { ledgerUrl: 'https://ledger.test/api', post, selfMint: true, sleep: ms => new Promise(resolve => setTimeout(resolve, 5)) })
  cs = chain(svc.id.address)
  svc.rpc = cs.rpc
  await svc.tick()
  assert.ok(svc.selfMintBusy, 'self-mint runs in the background after register')
  const st = await svc.selfMintBusy
  assert.ok(st && st.self && st.tokenId === '31', JSON.stringify(st))
  assert.strictEqual(cs.sent.length, 1)
  assert.ok(posts.some(u => u.endsWith('/gas/drip')))
  assert.ok(posts.indexOf('https://ledger.test/api/register') < posts.indexOf('https://ledger.test/api/gas/drip'), 'register before drip')
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'erc8004.json'), 'utf8'))
  assert.strictEqual(saved.tokenId, '31')
  assert.strictEqual((fs.statSync(path.join(dir, 'erc8004.json')).mode & 0o777), 0o600)
  assert.deepStrictEqual(svc.status().erc8004, { tokenId: '31', tx: '0x' + 'cd'.repeat(32) })
  const keyHex = JSON.parse(fs.readFileSync(path.join(dir, 'agent-key.json'), 'utf8')).key.slice(2)
  assert.ok(!fs.readFileSync(path.join(dir, 'erc8004.json'), 'utf8').includes(keyHex), 'key not written')
  // done: no further runs
  assert.strictEqual(svc.kickSelfMint(), null)
  // a restart reads erc8004.json and does not run again
  const again = new AgentService(dir, { snapshot: async () => ({}) }, { ledgerUrl: 'https://ledger.test/api', post, selfMint: true })
  again.registered = true
  assert.strictEqual(again.kickSelfMint(), null)

  // 4. Drip refused (low balance): failure is noted and retried after SELF_MINT_RETRY_MS, heartbeats unaffected.
  const d4 = tmp()
  const post4 = async (url) => url.endsWith('/gas/drip') ? { ok: false, status: 503, body: { ok: false, error: 'drip_low_balance' } } : { ok: true, status: 200, body: { ok: true } }
  let now = 1_000_000
  const s4 = new AgentService(d4, { version: '3.1.15', light: () => true, snapshot: async () => ({}), handlers: {}, payoutAddress: () => '0x2d6f6ebc9686d0316e1f24f8588585c1f22fc956' },
    { ledgerUrl: 'https://ledger.test/api', post: post4, selfMint: true, now: () => now })
  s4.rpc = chain(s4.id.address).rpc
  await s4.tick()
  assert.strictEqual(await s4.selfMintBusy, null)
  assert.strictEqual(s4.kickSelfMint(), null, 'waits before retrying')
  now += 10 * 60 * 1000 + 1
  assert.ok(s4.kickSelfMint(), 'retries after 10 minutes')
  await s4.selfMintBusy

  // 5. Off by default when the ledger is pinned (tests/dev), on for the real app.
  assert.strictEqual(new AgentService(tmp(), {}, { ledgerUrl: 'http://127.0.0.1:1' }).selfMintOn, false)
  assert.strictEqual(new AgentService(tmp(), {}, { env: {} }).selfMintOn, true)
  assert.strictEqual(new AgentService(tmp(), {}, { env: { SCDO_AGENT_SELF_MINT: '0' } }).selfMintOn, false)
  console.log('agent-selfmint-3115: ok')
})().catch(e => { console.error(e); process.exit(1) })
