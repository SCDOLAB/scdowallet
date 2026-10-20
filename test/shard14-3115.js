// 3.1.15: Shard1–4 only bookkeeping, treasury tax rows, team treasury view, heartbeat node samples.
'use strict'
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const P = require('../src/js/shardPolicy')
const MS = require('../src/js/mineSession')
const MH = require('../src/js/mineHome')
const { normalizeRemote } = require('../src/config/endpoints')
const { NodeSampler } = require('../src/agent/nodeSampler')
const root = path.join(__dirname, '..')
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8')

const T1 = '1S01' + 'a'.repeat(37) + '1'
const T2 = '2S02' + 'b'.repeat(37) + '1'

;(async () => {
  // policy defaults: Shard1–4 only, 60%, no treasury addresses
  const d = P.fromRemote(null)
  assert.strictEqual(d.shard0Mining, false)
  assert.strictEqual(d.taxRate, 0.6)
  assert.deepStrictEqual(d.treasury, { 1: '', 2: '', 3: '', 4: '' })
  // remote config: only a Classic address on its own shard is accepted
  const remote = normalizeRemote({ shardTreasury: { 1: T1, 2: T1, 3: '0x0889453fe946c75163b3bbdf2266f2566b2f4c03', 4: 'junk' }, shardTaxRate: 0.6, shard0Mining: false })
  const pol = P.fromRemote(remote)
  assert.strictEqual(pol.treasury[1], T1)
  assert.strictEqual(pol.treasury[2], '', 'a 1S01 address is not the Shard2 treasury')
  assert.strictEqual(pol.treasury[3], '')
  assert.strictEqual(pol.treasury[4], '')
  assert.strictEqual(P.fromRemote(normalizeRemote({ shard0Mining: true })).shard0Mining, true)
  // classic S-address format
  assert.strictEqual(P.classicShard(T2), 2)
  assert.strictEqual(P.classicShard('2S01' + 'b'.repeat(37) + '1'), null)
  assert.strictEqual(P.classicShard('1S01' + 'a'.repeat(37) + '3'), null)

  // tax rows per shard
  assert.strictEqual(P.txKind({ dir: 'out', to: T1 }, 1, pol), 'tax')
  assert.strictEqual(P.txKind({ dir: 'out', to: T1 }, 2, pol), 'out')
  assert.strictEqual(P.txKind({ dir: 'out', to: T2 }, 2, pol), 'out')
  assert.strictEqual(P.txKind({ dir: 'reward', to: T1 }, 1, pol), 'reward')
  assert.deepStrictEqual(P.taxSplit(1000000000n, pol), { tax: 600000000n, keep: 400000000n })
  const rows = P.treasuryRows(pol, { 1: '5' })
  assert.deepStrictEqual(rows.map(r => r.chain), ['Shard1', 'Shard2', 'Shard3', 'Shard4'])
  assert.strictEqual(rows[0].balance, '5')
  assert.strictEqual(rows[1].balance, null)

  // mining toggle: Shard0 cannot be picked; a new GPU profile takes the Classic shard
  const caps = { gpu: { available: true }, cpu: { available: true }, shard0Stopped: true }
  assert.deepStrictEqual(MS.freshSelection(caps, { gpu: { shard: 3 } }), { cpu: [], gpu: [3] })
  assert.deepStrictEqual(MS.freshSelection(Object.assign({}, caps, { shard0Stopped: false }), {}), { cpu: [], gpu: [0] })
  assert.strictEqual(MH.chainSupport('gpu', 0, caps).ok, false)
  assert.strictEqual(MH.chainSupport('gpu', 0, caps).reasonKey, 'shellShard0Stopped')
  assert.strictEqual(MH.chainSupport('gpu', 2, caps).ok, true)
  assert.deepStrictEqual(MH.sanitizeChainPick({ cpu: [], gpu: [0, 1, 4] }, caps).gpu, [1, 4])
  assert.deepStrictEqual(P.filterPick({ cpu: [1], gpu: [0, 2] }, pol), { cpu: [1], gpu: [2] })

  // every new string exists in both languages, CN has no Latin-only sentence, EN has no CJK
  const i18n = read('src/js/i18n112.js')
  for (const k of ['shellShard0Stopped', 'st_SHARD0_STOPPED', 'd_txTax', 'd_treasuryHead', 'd_treasuryLead', 'd_treasuryNone']) {
    const hits = i18n.split('\n').filter(l => l.includes(k + ':'))
    assert.strictEqual(hits.length, 2, k + ' in CN and EN')
    const val = (l) => (new RegExp(k + ": ([\"'])(.*?)\\1").exec(l) || [])[2]
    assert.ok(/[\u4e00-\u9fff]/.test(val(hits[0])), k + ' CN is Chinese')
    assert.ok(!/[\u4e00-\u9fff]/.test(val(hits[1])), k + ' EN has no Chinese')
    assert.ok(!/mining|挖礦/i.test(val(hits[0]) + val(hits[1])), k + ' says bookkeeping/記帳')
  }
  // main process refuses a Shard0 EVM bookkeeping start and drops a Shard0 resume
  const main = read('main.js')
  assert.ok(main.includes("code: 'SHARD0_STOPPED'"))
  assert.ok(main.includes('caps.shard0Stopped = !currentShardPolicy().shard0Mining'))
  assert.ok(main.includes('shardResume(it.resume || null)'))
  assert.ok(read('preload.js').includes("'shard:policy'"))
  assert.ok(read('index.html').includes('src/js/shardPolicy.js'))

  // heartbeat node samples (linux-agent 0.5.9 fields)
  let t = 1000
  const rpc = async (url, m) => {
    if (url.endsWith(':8545')) { if (m === 'eth_chainId') return '0x1'; throw new Error('x') }
    if (m === 'eth_chainId') return '0x1630'
    if (m === 'eth_getBlockByNumber') return { number: '0x10', hash: '0xABC' }
    if (m === 'net_peerCount') return '0x3'
    if (m === 'admin_nodeInfo') return { id: 'node1' }
  }
  const s = new NodeSampler({ rpc, now: () => t, urls: ['http://127.0.0.1:8545', 'http://127.0.0.1:18545'] })
  assert.strictEqual(await s.sample(), true)
  t = 1060; await s.sample()
  const body = s.addTo({ code: 'ONLINE' })
  assert.strictEqual(body.head_block, 16)
  assert.strictEqual(body.head_hash, '0xabc')
  assert.strictEqual(body.peer_count, 3)
  assert.strictEqual(body.enode, 'node1')
  assert.strictEqual(body.node_samples.length, 2)
  t = 1120; await s.sample(); s.clear()
  assert.strictEqual(s.samples.length, 1)
  const none = new NodeSampler({ rpc: async () => { throw new Error('down') }, urls: ['http://127.0.0.1:1'] })
  assert.strictEqual(await none.sample(), false)
  assert.deepStrictEqual(none.addTo({ code: 'ONLINE' }), { code: 'ONLINE' })
  console.log('shard14-3115 ok')
})().catch(e => { console.error(e); process.exit(1) })
