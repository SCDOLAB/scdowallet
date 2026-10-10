// 3.1.0: per-chain balances, 8-decimal sends, live pools, and one site list.
'use strict'
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const Module = require('module')
const amount = require('../src/js/amount')
const sendError = require('../src/js/sendError')
const poolStatus = require('../src/js/poolStatus')
const chainHome = require('../src/js/chainHome')
const siteNav = require('../src/js/siteNavMap')
const cat = require('../src/js/aiCat')
const mine = require('../src/js/mineHome')
const { Shard0 } = require('../src/api/evm')

const root = path.join(__dirname, '..')
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8')
const T = (k, p) => {
  if (k === 'shellMineOff') return '已停止'
  if (k === 'shellTxOf') return (p && p.name ? p.name : '') + ' 交易紀錄'
  if (k === 'shellPartial') return '部分地址讀取失敗'
  if (k === 'copy') return '複製'
  if (k === 'shellRecvShort') return '收款'
  if (k === 'shellSendShort') return '匯款'
  if (k === 'shellPickAddr') return '選擇地址'
  if (k === 'shellLoadMore') return '再看更多'
  if (k === 'd_noTx') return '沒有交易'
  if (k === 'd_txDone') return '完成'
  if (k === 'd_txFail') return '失敗'
  if (k === 'd_txPending') return '處理中'
  if (k === 'txReceived') return '收到'
  if (k === 'txSent') return '匯出'
  if (k === 'txSelf') return '自己'
  if (k === 'txReward') return '獎勵'
  if (k === 'viewExplorer') return '查看'
  return k
}
const esc = (s) => String(s == null ? '' : s)

const tooMany = '1.111111111111111111111111111111'
const guarded = amount.guardAmount(tooMany)
assert.strictEqual(guarded.ok, false)
assert.strictEqual(guarded.code, 'TOO_MANY_DECIMALS')
assert.strictEqual(amount.guardAmount('1.11111111').ok, true)
assert.strictEqual(amount.fmtUnits(1000000009000000000n, 18), '1')
assert.strictEqual(amount.clipDecimals(tooMany, 8).value, '1.11111111')
assert.strictEqual(amount.clipDecimals(tooMany, 8).blocked, true)
assert.strictEqual(amount.maxAmount(1000000000n, 1n, 8), '9.99999999')
const shard0 = new Shard0({ rpc: 'http://127.0.0.1:1' })
assert.throws(() => shard0.buildReq('0x' + '11'.repeat(20), tooMany, 'SCDO'), (err) => err && err.code === 'TOO_MANY_DECIMALS')
const evmSrc = read('src/api/evm.js')
assert.ok(evmSrc.indexOf('guardAmount') < evmSrc.indexOf('parseEther'))
assert.ok(evmSrc.indexOf('guardAmount') < evmSrc.indexOf('parseUnits'))
const classicSrc = read('src/main/walletService.js')
assert.ok(classicSrc.indexOf('guardAmount') < classicSrc.indexOf('new BigNumber(amount)'))

const raw = 'too many decimals for format (operation="fromString", fault="underflow", value="' + tooMany + '", code=NUMERIC_FAULT, version=6.17.0)'
const mapped = sendError.present({ code: 'NUMERIC_FAULT', message: raw }, 'CN')
assert.ok(mapped.message.includes('小數'))
assert.ok(!mapped.message.includes('fromString') && !mapped.message.includes('NUMERIC_FAULT'))
const errHtml = sendError.html({ code: 'NUMERIC_FAULT', message: raw }, 'CN', esc)
assert.ok(errHtml.includes('技術細節'))
assert.ok(!/<details\b[^>]*\sopen/.test(errHtml))
assert.ok(sendError.present({ code: 'INSUFFICIENT_FUNDS' }, 'EN').message.includes('balance'))
assert.ok(sendError.present({ message: 'nonce too low' }, 'CN').message.includes('序號'))
assert.ok(sendError.present({ message: 'invalid address' }, 'EN').message.includes('address'))

assert.strictEqual(poolStatus.judge(true, { dry_run: false, chain_height: 12, connections: 4, counters: { blocks_found: 2 } }).online, true)
assert.strictEqual(poolStatus.judge(true, { dry_run: true, chain_height: 12 }).online, false)
assert.strictEqual(poolStatus.judge(true, { dry_run: false }).online, false)
assert.strictEqual(poolStatus.judge(false, null).online, false)
assert.ok(!read('src/miner/zpow/pools.js').includes('live:'))
const down = mine.minePageHtml({
  miners: {},
  caps: { cpu: { available: true }, gpu: { available: true } },
  pools: { 3: { online: false } }
}, T, esc)
assert.ok(down.includes('Shard3 礦池暫時連不上'))
assert.ok(!down.includes('礦池還沒上線'))
assert.ok(mine.chainSupport('cpu', 3, {}).ok)
assert.ok(!mine.chainSupport('cpu', 3, {}, { 3: { online: false } }).ok)

const a = '1S01' + 'a'.repeat(36)
const b = '1S01' + 'b'.repeat(36)
const c = '1S01' + 'c'.repeat(36)
const sum = chainHome.summarize({
  n: 1,
  entries: [
    { name: 'low', address: a, units: 100n, decimals: 8 },
    { name: 'miss', address: b, units: null, decimals: 8, failed: true },
    { name: 'high', address: c, units: 500n, decimals: 8 }
  ]
})
assert.strictEqual(sum.text, '0.000006')
assert.strictEqual(sum.partial, true)
assert.strictEqual(sum.entries[0].name, 'high')
assert.strictEqual(sum.entries[2].name, 'miss')
const other = chainHome.summarize({ n: 2, entries: [{ name: 'z', address: '2S02' + 'd'.repeat(36), units: 1n, decimals: 8 }] })
assert.notStrictEqual(sum.text, other.text)
const unknown = chainHome.summarize({ n: 0, entries: [{ name: 'w', address: '0x' + '11'.repeat(20), units: null, decimals: 18 }] })
assert.strictEqual(unknown.text, '\u2014')
const rows = chainHome.rowsHtml([{ n: 1, open: false, entries: sum.entries, txs: [] }], T, esc)
assert.ok(rows.includes('Shard1 Classic') && rows.includes('0.000006 SCDO'))
assert.ok(!rows.includes('總餘額') && !/<details\b[^>]*\sopen/.test(rows))
const picked = chainHome.pickDefault(sum.entries, a)
assert.strictEqual(picked.address, a)
const highest = chainHome.pickDefault(sum.entries, '')
assert.strictEqual(highest.address, c)
const select = chainHome.selectHtml('payAddr', sum.entries, c, esc)
assert.ok(select.includes('high') && select.includes('SCDO') && select.includes('selected'))
const hist = chainHome.historyHtml({
  n: 1,
  entries: sum.entries,
  filter: a,
  txLimit: 1,
  txs: [
    { address: a, t: 2, amount: '1.2', dir: 'in', status: 'done', hash: 'ab'.repeat(32) },
    { address: c, t: 9, amount: '9', dir: 'out', status: 'done' },
    { address: '2S02' + 'e'.repeat(36), t: 8, amount: '3', dir: 'in', status: 'done' }
  ]
}, T, esc)
assert.ok(hist.includes('Shard1 Classic 交易紀錄'))
assert.ok(hist.includes(a.slice(0, 6)) && !hist.includes('2S02'))
assert.ok(hist.includes('chainFilter-1'))

const ids = siteNav.flat().map(it => it.id)
assert.deepStrictEqual(cat.suggestions().map(it => it.id), ids)
const realLoad = Module._load
Module._load = function (req, parent, ...rest) {
  if (req === 'electron') {
    return { Menu: { buildFromTemplate: (t) => t, setApplicationMenu () {} }, app: { getVersion: () => '3.1.0' }, shell: {} }
  }
  return realLoad.call(this, req, parent, ...rest)
}
const menu = require('../src/js/menu.js')
Module._load = realLoad
const labels = menu.buildTemplate(null, 'CN').flatMap(m => [m.label].concat((m.submenu || []).map(s => s.label)))
for (const it of siteNav.flat()) {
  if (it.id === 'remit') assert.ok(labels.includes('匯款…'), it.id)
  else if (it.id === 'create') assert.ok(labels.some(l => String(l).startsWith('建立新地址')), it.id)
  else if (it.id === 'import') assert.ok(labels.some(l => String(l).startsWith('匯入錢包')), it.id)
  else assert.ok(labels.includes(it.cn), it.cn)
}
assert.strictEqual(cat.reply('GPU 共享', { accounts: [] }).actions[0].type, 'openSite')
assert.strictEqual(cat.reply('餘額', { accounts: [] }).actions.length, 0)

const ui = read('src/js/app112.js')
const home = ui.slice(ui.indexOf('function pageHome'), ui.indexOf('function backHome'))
assert.ok(home.includes('chainRowsHtml()') && home.includes('mineHomeStripHtml()'))
assert.ok(!home.includes('shellTotal') && !home.includes('recentTxHost'))
assert.ok(ui.includes("case 'remitAddr'") && ui.includes('from: v'))
assert.ok(!read('src/css/shell310.css').toLowerCase().includes('#f5f5f7'))
assert.ok(read('src/css/shell310.css').includes('#F2F2F7'))
assert.ok(read('src/css/app112.css').includes('#F2F2F7'))

async function livePools () {
  poolStatus.reset()
  let fetches = 0
  const pools = {}
  for (const n of [1, 2, 3, 4]) pools[n] = { statsBase: 'http://pool/' + n }
  const fetchImpl = async (url) => {
    fetches++
    const n = Number(String(url).match(/pool\/(\d)/)[1])
    if (n === 2) throw new Error('down')
    if (n === 3) return { ok: true, json: async () => ({ dry_run: true, chain_height: 1 }) }
    if (n === 1) return { ok: true, json: async () => ({ dry_run: false, chain_height: 9, connections: 3 }) }
    return { ok: true, json: async () => ({}) }
  }
  const status = await poolStatus.readAll(() => pools, fetchImpl, 1000)
  assert.strictEqual(status[1].online, true)
  assert.strictEqual(status[1].chain_height, 9)
  assert.strictEqual(status[2].online, false)
  assert.strictEqual(status[3].online, false)
  assert.strictEqual(status[3].dry_run, true)
  assert.strictEqual(status[4].online, false)
  await poolStatus.readAll(() => pools, fetchImpl, 2000)
  assert.strictEqual(fetches, 4)
  console.log('wallet-310: ok')
}
livePools().catch((err) => { console.error(err); process.exit(1) })
