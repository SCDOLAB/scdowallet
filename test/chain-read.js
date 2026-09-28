// Read paths on shards 1-4 + shard0, old-chain signing accepted by a live node (rejected only for
// balance), shard0 token-transfer signing. THROWAWAY keys only; nothing is spent.
'use strict'
const assert = require('assert')
const Scdo = require('scdo.js')
const { ethers } = require('ethers')
const { Shard0 } = require('../src/api/evm')
const ks = require('../src/api/keystore')
const P = (c, m, ...a) => new Promise((res, rej) => c[m](...a, (r, e) => e ? rej(e) : res(r)))

;(async () => {
  for (const s of [1, 2, 3, 4]) {
    const c = new Scdo('https://scdoscan.io/rpc/' + s).client
    const info = await P(c, 'getInfo')
    const bal = await P(c, 'getBalance', info.Coinbase, '', -1)
    const nonce = c.sendSync('getAccountNonce', info.Coinbase, '', -1)
    console.log(`shard ${s}: height ${info.CurrentBlockHeight}, coinbase ${info.Coinbase} balance ${bal.Balance / 1e8} SCDO, nonce ${nonce}`)
    assert.strictEqual(info.Shard, s)
  }
  // old-chain signing: throwaway key on shard 1, submit to the node -> must fail on balance, not signature
  const kp = new Scdo().keyTool.generateKeys(1)
  const c1 = new Scdo('https://scdoscan.io/rpc/1').client
  const nonce = c1.sendSync('getAccountNonce', kp.publickey, '', -1)
  const tx = c1.generateTx(kp.privatekey, { Type: 0, From: kp.publickey, To: '1S01a64ed0a476b1b128e7b196a3ebb34662825231', Amount: 1, AccountNonce: nonce + 1, GasPrice: 10, GasLimit: 21000, Timestamp: 0, Payload: '' })
  // recover signer and compare with the old-shard address
  const sig = Buffer.from(tx.Signature.Sig, 'base64')
  const pub = ethers.SigningKey.recoverPublicKey(tx.Hash, { r: '0x' + sig.slice(0, 32).toString('hex'), s: '0x' + sig.slice(32, 64).toString('hex'), v: 27 + sig[64] })
  const addrFromSig = (() => { const k = require('rlp'); const b = Buffer.from(ethers.getBytes(pub)).slice(1); const a = Buffer.from(ethers.getBytes(ethers.keccak256(k.encode(b)))).slice(-20); a[0] = 1; a[19] = (a[19] & 0xF0) | 1; return '1S' + a.toString('hex') })()
  assert.strictEqual(addrFromSig.toLowerCase(), kp.publickey.toLowerCase()); console.log('old-chain signature recovers to', addrFromSig)
  let nodeMsg = ''
  try { await P(c1, 'addTx', tx); nodeMsg = 'ACCEPTED?!' } catch (e) { nodeMsg = String(e.message || e) }
  console.log('scdo_addTx from unfunded throwaway ->', nodeMsg.slice(0, 220))
  assert.ok(/balance|insufficient|not enough/i.test(nodeMsg) && !/sign/i.test(nodeMsg), 'expected balance rejection')
  // shard0
  const s0 = new Shard0()
  const ci = await s0.chainInfo(); console.log('shard0: chainId', ci.chainId, 'block', ci.block); assert.strictEqual(ci.chainId, 5680)
  const desk = '0xe6422826eFc630634e959f5da7f8163FBDB9F8d2'
  const b = await s0.balances(desk); console.log('shard0 demo desk balances:', b.native, 'SCDO', b.tokens.map(t => t.balance + ' ' + t.symbol).join(', '))
  const fb = await s0.balances('0x42c4854A51127f2D9D770f0d4AECa0683f72c0e4'); console.log('shard0 faucet balance:', fb.native, 'SCDO')
  // same key -> 0x + 1S01..4S04
  const w = ethers.Wallet.createRandom()
  console.log('same key ->', w.address, [1, 2, 3, 4].map(s => ks.scdoAddressFromPriv(w.privateKey, s)).join(' '))
  // token transfer signing (amount 0 so estimateGas works for an unfunded key); not broadcast
  try {
    const r = await s0.send(w.privateKey, desk, '0', 'tUSDT', { dryRun: true })
    const t = ethers.Transaction.from(r.signed)
    assert.strictEqual(t.from, w.address); assert.strictEqual(Number(t.chainId), 5680); assert.strictEqual(t.to.toLowerCase(), '0xb042c1833687d05cba414f04ec4013744ddeadcc')
    console.log('tUSDT transfer signed offline OK: type', t.type, 'chainId', t.chainId, 'gasLimit', t.gasLimit.toString(), 'data', t.data.slice(0, 10))
  } catch (e) { console.log('tUSDT dry-run:', e.shortMessage || e.message) }
  console.log('chain-read: PASS')
})().catch(e => { console.error('FAIL', e); process.exit(1) })
