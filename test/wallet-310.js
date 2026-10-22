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
const { Shard0, DEFAULT_SHARD0 } = require('../src/api/evm')

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
const bal3244 = amount.fmtBalance(324412000000n, 8)
assert.strictEqual(bal3244.short, '3,244.12')
assert.strictEqual(bal3244.full, '3,244.12')
const balCut = amount.fmtBalance(123456789n, 8)
assert.strictEqual(balCut.short, '1.2345')
assert.strictEqual(balCut.full, '1.23456789')
assert.strictEqual(amount.SHOW_DP, 4)
assert.strictEqual(amount.clipDecimals(tooMany, 8).value, '1.11111111')
assert.strictEqual(amount.clipDecimals(tooMany, 8).blocked, true)
assert.strictEqual(amount.maxAmount(1000000000n, 1n, 8), '9.99999999')
assert.strictEqual(amount.classicFeeUnits(null), 21000n)
assert.strictEqual(amount.classicFeeUnits(0), 21000n)
assert.strictEqual(amount.classicFeeUnits(''), 21000n)
assert.strictEqual(amount.maxAmount(100000000n, amount.classicFeeUnits(null), 8), '0.99979')
assert.strictEqual(amount.maxAmount(100000000n, 0n, 8), '1')
assert.strictEqual(amount.exceedsBalance('0.99979', 100000000n, 21000n, 8), false)
assert.strictEqual(amount.exceedsBalance('0.99980', 100000000n, 21000n, 8), true)
assert.strictEqual(amount.exceedsBalance('1', 100000000n, 0n, 8), false)
assert.strictEqual(amount.exceedsBalance('1', null, 21000n, 8), false)
assert.strictEqual(amount.exceedsBalance('', 100000000n, 21000n, 8), false)
const paySrc = read('src/js/app112.js')
const fillMax = paySrc.slice(paySrc.indexOf('async function fillMax'), paySrc.indexOf('if (toEl)'))
assert.ok(fillMax.includes('btn.disabled = true'))
assert.ok(fillMax.indexOf('classicFeeUnits') < fillMax.indexOf('maxAmount'))
assert.ok(fillMax.includes("await api.invoke('s0:estimate'"))
assert.ok(fillMax.includes("await api.invoke('old:estimateGas'"))
assert.ok(read('src/css/shell310.css').includes('body.cat-reserve.cat-bottom #app.shell .shell-col > main { margin-bottom: var(--cat-res, 92px); }'))
assert.ok(read('src/css/shell310.css').includes('#app.shell main { background: #F2F2F7; min-width: 0; min-height: 0; max-width: 100%; overflow-x: hidden; overflow-y: auto; }'))
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
assert.ok(down.includes('Shard3 記帳池暫時連不上'))
assert.ok(!down.includes('記帳池還沒上線'))
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
assert.strictEqual(sum.text, '0')
assert.strictEqual(sum.full, '0.000006')
assert.strictEqual(sum.partial, true)
assert.strictEqual(sum.entries[0].name, 'high')
assert.strictEqual(sum.entries[2].name, 'miss')
const other = chainHome.summarize({ n: 2, entries: [{ name: 'z', address: '2S02' + 'd'.repeat(36), units: 1n, decimals: 8 }] })
assert.strictEqual(other.text, '0')
assert.strictEqual(other.full, '0.00000001')
assert.notStrictEqual(sum.full, other.full)
const unknown = chainHome.summarize({ n: 0, entries: [{ name: 'w', address: '0x' + '11'.repeat(20), units: null, decimals: 18 }] })
assert.strictEqual(unknown.text, '\u2014')
const dashRow = chainHome.rowsHtml([{ n: 0, open: true, entries: unknown.entries, txs: [] }], T, esc)
assert.ok(dashRow.includes('\u2014') && !dashRow.includes('\u2014 SCDO'))
const rows = chainHome.rowsHtml([{ n: 1, open: false, entries: sum.entries, txs: [] }], T, esc)
assert.ok(rows.includes('Shard1 Classic') && rows.includes('>0 SCDO</b>') && rows.includes('title="0.000006 SCDO"'))
assert.ok(!rows.includes('總餘額') && !/<details\b[^>]*\sopen/.test(rows))
const picked = chainHome.pickDefault(sum.entries, a)
assert.strictEqual(picked.address, a)
const highest = chainHome.pickDefault(sum.entries, '')
assert.strictEqual(highest.address, c)
const select = chainHome.selectHtml('payAddr', sum.entries, c, esc)
assert.ok(select.includes('high') && select.includes('SCDO') && select.includes('selected'))
const acctMenu = chainHome.accountMenuHtml('payAddr', sum.entries, c, esc)
assert.ok(acctMenu.includes('pay-acct-name') && acctMenu.includes('pay-acct-addr') && acctMenu.includes('pay-acct-bal'))
assert.ok(acctMenu.includes('high') && acctMenu.includes('data-pay-addr=') && !/<details\b[^>]*\sopen/.test(acctMenu))
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
const sent = []
const win = { isDestroyed () { return false }, webContents: { send (ch, a) { sent.push([ch, a]) } } }
function menuLeaves (items) {
  const out = []
  for (const m of items || []) {
    if (m.click) out.push(m)
    if (m.submenu) out.push(...menuLeaves(m.submenu))
  }
  return out
}
const cnLeaves = menuLeaves(menu.buildTemplate(win, 'CN'))
cnLeaves.find(m => m.label === '會員').click()
cnLeaves.find(m => m.label === '向 SCDO OTC 購買 SCDO').click()
assert.deepStrictEqual(sent, [['menu:action', 'buy:membership'], ['menu:action', 'buy:otc']])
const aboutItem = menu.buildTemplate(win, 'CN').find(m => m.label === '關於')
assert.ok(aboutItem.submenu.some(s => s.label === '團隊'))
assert.strictEqual(aboutItem.submenu[0].label, '關於這個錢包')
aboutItem.click()
aboutItem.submenu[0].click()
assert.deepStrictEqual(sent.slice(2), [['menu:action', 'about'], ['menu:action', 'about']])
assert.ok(menuLeaves(menu.buildTemplate(null, 'EN')).some(m => m.label === 'Buy SCDO from SCDO OTC'))
const labels = menu.buildTemplate(null, 'CN').flatMap(m => [m.label].concat((m.submenu || []).map(s => s.label)))
for (const it of siteNav.flat()) {
  if (it.id === 'remit') assert.ok(labels.includes('匯款…'), it.id)
  else if (it.id === 'create') assert.ok(labels.some(l => String(l).startsWith('建立新地址')), it.id)
  else if (it.id === 'import') assert.ok(labels.some(l => String(l).startsWith('匯入錢包')), it.id)
  else assert.ok(labels.includes(it.cn), it.cn)
}
assert.strictEqual(cat.reply('GPU 共享', { accounts: [] }).actions[0].type, 'openSite')
assert.strictEqual(cat.reply('餘額', { accounts: [] }).actions.length, 0)
const ADDR = '1S01dfdbe4d921d507032cb83ee04bb7efc4fd9a51'
assert.strictEqual(siteNav.MEMBERSHIP_URL, 'https://scdo.com.au/membership/')
assert.strictEqual(siteNav.OTC_URL, 'https://scdo.com.au/membership/')
assert.strictEqual(siteNav.byId('membership').href, siteNav.MEMBERSHIP_URL)
assert.strictEqual(siteNav.byId('otc').href, siteNav.OTC_URL)
assert.strictEqual((read('src/js/siteNavMap.js').match(/https:\/\/scdo\.com\.au\/membership\//g) || []).length, 2)
assert.strictEqual((read('src/js/siteNavMap.js').match(/https:\/\/scdo\.com\.au\/otc\//g) || []).length, 0)
assert.strictEqual(siteNav.visit('membership', { lang: 'CN', address: ADDR }), siteNav.MEMBERSHIP_URL + '?lang=zh-TW&address=' + ADDR)
assert.strictEqual(siteNav.visit('otc', { lang: 'en', address: ADDR }), siteNav.OTC_URL + '?lang=en&address=' + ADDR)
assert.strictEqual(siteNav.visit('otc', { lang: 'EN' }), siteNav.OTC_URL + '?lang=en')
assert.strictEqual(siteNav.visit('games', { lang: 'CN', address: ADDR }), 'https://scdo.com.au/games/')
assert.strictEqual(siteNav.match('開會員').id, 'membership')
assert.strictEqual(siteNav.match('我想買 SCDO').id, 'otc')
assert.strictEqual(cat.reply('開會員', { accounts: [] }).actions[0].id, 'membership')
assert.strictEqual(cat.reply('我想買 SCDO', { accounts: [] }).actions[0].id, 'otc')
assert.strictEqual(cat.reply('我想買 SCDO', { accounts: [] }).actions[0].type, 'openSite')
assert.strictEqual(siteNav.REFERRAL_URL, 'https://scdo.com.au/join')
assert.strictEqual((read('src/js/siteNavMap.js').match(/const REFERRAL_URL = 'https:\/\/scdo\.com\.au\/join'/g) || []).length, 1)
assert.strictEqual(siteNav.referral(ADDR), 'https://scdo.com.au/join?ref=' + ADDR + '&src=wallet')
assert.strictEqual(siteNav.referral(''), 'https://scdo.com.au/join?src=wallet')
assert.strictEqual(siteNav.match('邀請好友').id, 'referral')
assert.strictEqual(cat.reply('邀請好友', { accounts: [] }).actions[0].id, 'referral')
assert.ok(!siteNav.flat().some(it => it.id === 'referral'))
const salesBan = /收益|價格|年化|報酬|yield|return|price|幣安|binance|okx/i
for (const it of [siteNav.byId('membership'), siteNav.byId('otc')]) {
  assert.ok(!salesBan.test(it.cn + ' ' + it.en + ' ' + (it.ask || []).join(' ')), it.id)
}
const i18nBox = { window: {} }
require('vm').runInNewContext(read('src/js/i18n112.js'), i18nBox)
const I = i18nBox.window.I18N112
assert.strictEqual(I.CN.homeBuyTitle, '會員 · 向 SCDO 購買')
assert.strictEqual(I.EN.homeBuyTitle, 'Membership · Buy from SCDO')
assert.strictEqual(I.CN.homeBuyMember, '開通會員')
assert.strictEqual(I.EN.homeBuyMember, 'Open membership')
assert.strictEqual(I.CN.homeBuyOtc, '向 SCDO OTC 購買 SCDO')
assert.strictEqual(I.EN.homeBuyOtc, 'Buy SCDO from SCDO OTC')
const note310 = I.CN.relNotes.find(n => n.v === '3.1.0')
const note310en = I.EN.relNotes.find(n => n.v === '3.1.0')
const cnBuyNote = note310.items.find(s => s.includes('會員 · 向 SCDO 購買'))
const enBuyNote = note310en.items.find(s => s.includes('Membership · Buy from SCDO'))
assert.ok(cnBuyNote && cnBuyNote.includes('開會員'))
assert.ok(enBuyNote)
const cnTone = note310.items.find(s => s.includes('溫馨提醒'))
const enTone = note310en.items.find(s => s.includes('friendly reminders'))
assert.ok(cnTone && enTone)
assert.ok(note310.items[0].includes('各鏈餘額') && note310.items[0].includes('邀請好友'))
assert.ok(note310en.items[0].includes('inviting a friend'))
assert.ok(!/[\u4e00-\u9fff]/.test(I.EN.homeBuyTitle + I.EN.homeBuyMember + I.EN.homeBuyOtc + I.EN.homeInviteLine + note310en.items[0] + enTone + enBuyNote))
assert.ok(!salesBan.test(I.CN.homeBuyTitle + I.CN.homeBuyMember + I.CN.homeBuyOtc + I.CN.homeInviteTitle + I.CN.homeInviteLine))
assert.ok(!salesBan.test(I.EN.homeBuyTitle + I.EN.homeBuyMember + I.EN.homeBuyOtc + I.EN.homeInviteLine + note310en.items[0] + enTone + enBuyNote))

const ui = read('src/js/app112.js')
const home = ui.slice(ui.indexOf('function pageHome'), ui.indexOf('function backHome'))
assert.ok(home.includes('chainRowsHtml()') && home.includes('id="homeMineState"') && !home.includes('mineHomeStripHtml()'))
assert.ok(home.includes('homeBuyHtml()') && home.includes('id="homeInvite"') && home.includes('data-act="shareRef"'))
assert.ok(home.indexOf('home-lead') < home.indexOf('shell-actions') && home.indexOf('shell-actions') < home.indexOf('id="homeChains"') && home.indexOf('id="homeChains"') < home.indexOf('homeBuyHtml()') && home.indexOf('homeBuyHtml()') < home.indexOf('id="homeInvite"'))
assert.ok(ui.includes('data-act="buySite" data-v="membership"') && ui.includes('data-act="buySite" data-v="otc"'))
assert.ok(ui.includes("case 'buySite': openAccountSite(v)"))
assert.ok(ui.includes("localStorage.getItem('recvAddr310-0')"))
assert.ok(ui.includes("localStorage.getItem('recvAddr310-1')"))
assert.ok(ui.includes('nav.referral(selectedShard0())'))
assert.ok(ui.includes('referral(selectedShard0())'))
assert.ok(ui.includes('address: memberAddress() || selectedShard1()'))
assert.ok(ui.includes('class="shell-fold home-buy"') && !ui.includes('home-buy" open'))
assert.ok(read('src/css/shell310.css').includes('.home-buy-pill'))
assert.ok(!home.includes('shellTotal') && !home.includes('recentTxHost'))
assert.ok(ui.includes("case 'remitAddr'") && ui.includes('from: v'))
assert.ok(!read('src/css/shell310.css').toLowerCase().includes('#f5f5f7'))
assert.ok(read('src/css/shell310.css').includes('#F2F2F7'))
assert.ok(read('src/css/app112.css').includes('#F2F2F7'))

const builtIn = Object.fromEntries(DEFAULT_SHARD0.tokens.map(t => [t.symbol, t]))
assert.strictEqual(DEFAULT_SHARD0.chainId, 5680)
assert.strictEqual(builtIn.SCDOR.name, 'SCDO Reward')
assert.strictEqual(builtIn.SCDOR.address, '0xd76C042a0DbA95E0B9d302d33849304CbD4E5fc3')
assert.strictEqual(builtIn.SCDOR.decimals, 18)
assert.strictEqual(builtIn.SCDOR.logo, 'https://scdo.com.au/logos/0xd76C042a0DbA95E0B9d302d33849304CbD4E5fc3.png')
assert.strictEqual(builtIn.WSCDO.name, 'Wrapped SCDO')
assert.strictEqual(builtIn.WSCDO.address, '0x5c2d19142f021375D9f440Ed441015e59E28Ab29')
assert.strictEqual(builtIn.WSCDO.decimals, 18)
assert.strictEqual(builtIn.WSCDO.logo, 'https://scdo.com.au/logos/0x5c2d19142f021375D9f440Ed441015e59E28Ab29.png')
assert.ok(builtIn.tUSDT && builtIn.tAUD)
const boot = read('src/main/walletService.js')
assert.ok(boot.includes('name: t.name || \'\'' ) && boot.includes('logo: t.logo || \'\''))
const appUi = read('src/js/app112.js')
assert.ok(appUi.includes('name: t.name || T(\'assetTest\')'))
assert.ok(appUi.includes('assetIconHtml(x.symbol, x.logo)'))
assert.ok(read('index.html').includes("img-src 'self' data: https://scdo.com.au/logos/;"))
assert.ok(read('src/js/safeDom.js').includes('https:\\/\\/scdoscan\\.io\\/logos\\/0x'))

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
