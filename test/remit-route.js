// Merged 匯款 routing: address → chain shard, fiat or remit payee → gateway. Never sends.
'use strict'
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const route = require('../src/js/remitRoute')

const ADDR = '0x' + 'ab'.repeat(20)
const CLASSIC = '1S01dfdbe4d921d507032cb83ee04bb7efc4fd9a51'
const SHARD2 = '2S02' + 'cd'.repeat(19)
const accounts = [
  { label: '小明', filename: 'ming.json', address: CLASSIC, evm: '', shard: 1 },
  { label: '收款', filename: 'recv.json', address: '', evm: ADDR, shard: 0 }
]

const chain0 = route.routePay({ to: ADDR, amount: '1.5', accounts: accounts })
assert.strictEqual(chain0.kind, 'chain')
assert.strictEqual(chain0.shard, 0)
assert.strictEqual(chain0.to, ADDR)
assert.strictEqual(chain0.amount, '1.5')
assert.strictEqual(chain0.line, '鏈上轉帳 · Shard0 EVM · 手續費約 …')

const chain1 = route.routePay({ to: CLASSIC, amount: '2', accounts: accounts, feeText: '0.00021 SCDO' })
assert.strictEqual(chain1.kind, 'chain')
assert.strictEqual(chain1.shard, 1)
assert.strictEqual(chain1.line, '鏈上轉帳 · Shard1 · 手續費約 0.00021 SCDO')

const chain2 = route.routePay({ to: SHARD2, amount: '3', accounts: accounts })
assert.strictEqual(chain2.shard, 2)
assert.strictEqual(chain2.line, '鏈上轉帳 · Shard2 · 手續費約 …')

const named = route.routePay({ to: '小明', amount: '100', accounts: accounts })
assert.strictEqual(named.kind, 'chain')
assert.strictEqual(named.shard, 1)
assert.strictEqual(named.to, CLASSIC)
assert.ok(named.line.startsWith('鏈上轉帳 · Shard1 · 手續費約 '))

const evmName = route.routePay({ to: '收款', amount: '4', accounts: accounts })
assert.strictEqual(evmName.kind, 'chain')
assert.strictEqual(evmName.shard, 0)
assert.strictEqual(evmName.to, ADDR)

const fiatAddr = route.routePay({ to: ADDR, amount: '100 USD', accounts: accounts })
assert.strictEqual(fiatAddr.kind, 'gateway')
assert.strictEqual(fiatAddr.line, '匯款 · 到帳約 …')
assert.ok(!fiatAddr.line.includes('鏈上'))

const fiatYuan = route.routePay({ to: CLASSIC, amount: '50元', accounts: accounts })
assert.strictEqual(fiatYuan.kind, 'gateway')
assert.strictEqual(route.routePay({ to: '媽媽', amount: 'NT$20', accounts: accounts }).kind, 'gateway')
assert.strictEqual(route.routePay({ to: '媽媽', amount: '8 美金', accounts: accounts }).line, '匯款 · 到帳約 …')

const payee = route.routePay({ to: '媽媽', amount: '9', accounts: accounts, payees: [{ name: '媽媽', kind: 'remit' }] })
assert.strictEqual(payee.kind, 'gateway')
assert.strictEqual(payee.line, '匯款 · 到帳約 …')

const unknown = route.routePay({ to: '不存在', amount: '1', accounts: accounts })
assert.strictEqual(unknown.kind, 'gateway')
assert.strictEqual(unknown.to, '不存在')

const many = route.routePay({
  to: '小',
  amount: '1',
  accounts: accounts.concat([{ label: '小華', filename: 'b.json', address: SHARD2, evm: '', shard: 2 }])
})
assert.strictEqual(many.kind, 'incomplete')
assert.strictEqual(many.line, '')
assert.ok(many.many.includes('小明') && many.many.includes('小華'))

const blank = route.routePay({ to: '', amount: '1', accounts: accounts })
assert.strictEqual(blank.kind, 'incomplete')
assert.strictEqual(blank.line, '')
assert.strictEqual(route.routePay({ to: ADDR, amount: '', accounts: accounts }).line, '')
assert.strictEqual(route.routePay({ to: ADDR, amount: '0', accounts: accounts }).kind, 'incomplete')

const wide = route.routePay({ to: '１Ｓ０１dfdbe4d921d507032cb83ee04bb7efc4fd9a51'.normalize('NFKC'), amount: '１', accounts: accounts })
assert.strictEqual(wide.kind, 'chain')
assert.strictEqual(wide.shard, 1)

const src = fs.readFileSync(path.join(__dirname, '../src/js/remitRoute.js'), 'utf8')
assert.ok(!src.includes('s0:send'))
assert.ok(!src.includes('old:send'))
assert.ok(!src.includes('remit:login'))
assert.ok(!src.includes('s0:review'))

const ui = fs.readFileSync(path.join(__dirname, '../src/js/app112.js'), 'utf8')
assert.ok(ui.includes('function payModal (f, prefill)') || ui.includes('function payModal(f, prefill)'))
assert.ok(ui.includes('id="payRoute"'))
// 3.0.2 (v8): no Send button on Home; the 匯款 menu, View → Ctrl+4 and AI小貓 open the same form
assert.ok(!ui.includes('id="btnRemit"') && ui.includes("case 'send': openRemittance(); break") && ui.includes("case 'remit': openRemittance(); break"))
assert.ok(ui.includes('id="btnRemitSign"'))
assert.ok(ui.includes("const TABS = ['home', 'acc', 'mine', 'mineSet']"))
assert.ok(!ui.includes("['remit', 'tabRemit']"))
assert.ok(!ui.includes('id="btnSend"'))
assert.ok(!ui.includes('data-act="sendOld"'))
assert.ok(!ui.includes('data-act="send"'))
assert.ok(ui.includes('function openRemittance'))
assert.ok(ui.includes('SCDORemitRoute.routePay'))
const run = ui.slice(ui.indexOf('function runCatAction'), ui.indexOf('function applyCatPlan'))
assert.ok(run.includes('payModal('))
assert.ok(!run.includes('sendModal'))
assert.ok(!run.includes('sendOldModal'))
assert.ok(!run.includes('s0:send'))
assert.ok(!run.includes('old:send'))
assert.ok(fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8').includes('remitRoute.js'))

// English mode: route lines, fiat words, and the EN text of the merged Send form carry no Chinese.
const CJK = /[\u3000-\u303f\u3400-\u9fff\uf900-\ufaff\uff00-\uffef]/
global.window = { SCDOMining: { lang: 'EN' } }
assert.strictEqual(route.routePay({ to: ADDR, amount: '1.5', accounts: accounts }).line, 'On-chain transfer · Shard0 EVM · fee about …')
assert.strictEqual(route.routePay({ to: CLASSIC, amount: '2', accounts: accounts, feeText: '0.00021 SCDO' }).line, 'On-chain transfer · Shard1 · fee about 0.00021 SCDO')
const enGate = route.routePay({ to: ADDR, amount: '100 USD', accounts: accounts })
assert.strictEqual(enGate.kind, 'gateway')
assert.strictEqual(enGate.line, 'Remittance · arrives in about …')
assert.strictEqual(route.routePay({ to: 'Mum', amount: '100 dollars', accounts: accounts }).kind, 'gateway')
assert.strictEqual(route.routePay({ to: ADDR, amount: '1 dollar', accounts: accounts }).kind, 'gateway')
assert.strictEqual(route.routePay({ to: ADDR, amount: '20 AUD', accounts: accounts }).kind, 'gateway')
assert.strictEqual(route.routePay({ to: '媽媽', amount: '8 美金', accounts: accounts }).kind, 'gateway')
assert.strictEqual(route.routePay({ to: ADDR, amount: '3', accounts: accounts }).kind, 'chain')
global.window.SCDOMining.lang = 'CN'
assert.strictEqual(route.routePay({ to: ADDR, amount: '100 USD', accounts: accounts }).line, '匯款 · 到帳約 …')
assert.strictEqual(route.routePay({ to: ADDR, amount: '1.5', accounts: accounts }).line, '鏈上轉帳 · Shard0 EVM · 手續費約 …')
delete global.window

const vm = require('vm')
const i18nBox = { window: {} }
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/js/i18n112.js'), 'utf8'), i18nBox)
const EN = i18nBox.window.I18N112.EN
const CN = i18nBox.window.I18N112.CN
const enPayKeys = Object.keys(EN).filter(k => /^(pay|remit)/.test(k) || k === 'tabRemit')
assert.ok(enPayKeys.length >= 40, 'EN pay/remit keys: ' + enPayKeys.length)
for (const k of enPayKeys) {
  assert.strictEqual(typeof EN[k], 'string', k)
  assert.ok(!CJK.test(EN[k]), 'EN ' + k + ' has Chinese: ' + EN[k])
}
for (const k of ['tabRemit', 'remitTitle', 'payTitle']) assert.strictEqual(EN[k], 'Send', k)
assert.strictEqual(EN.payGo, 'Confirm and send')
assert.ok(!/kyc|no signup/i.test(EN.remitZeroEn))
const notes300 = EN.relNotes.find(n => n.v === '3.0.0').items.join(' ')
assert.ok(!notes300.includes('匯款'), 'EN 3.0.0 notes still say 匯款')
for (const k of ['tabRemit', 'remitTitle', 'payTitle']) assert.strictEqual(CN[k], '匯款', 'CN ' + k)
assert.strictEqual(CN.payGo, '確認匯款')
// Remit page and Send form text: no developer setting names or raw URLs as instructions, in either language
for (const [name, table] of [['CN', CN], ['EN', EN]]) {
  for (const k of Object.keys(table).filter(k => /^(pay|remit)/.test(k) || k === 'tabRemit')) {
    assert.ok(!String(table[k]).includes('SCDO_'), name + ' ' + k + ' shows a developer setting: ' + table[k])
  }
  for (const k of ['remitEnv', 'remitDown']) assert.ok(!/https?:\/\//.test(table[k]), name + ' ' + k + ' shows a raw URL: ' + table[k])
}
assert.strictEqual(CN.remitDown, '現在連不上匯款服務，請稍後再試。如果一直連不上，請聯絡客服。')
assert.strictEqual(EN.remitDown, "The remittance service can't be reached right now. Please try again later. If it keeps failing, contact support.")
const pageRemit = ui.slice(ui.indexOf('function pageRemit'), ui.indexOf('function remitErrText'))
assert.ok(pageRemit.length > 0 && !pageRemit.includes('SCDO_'))
// English release notes: no Chinese except the deliberate names (AI小貓, the 華語 button label,
// the 繁體中文 option name, the Documents\ScdoWallet\備份 folder)
const DELIBERATE = ['AI小貓', '華語', '繁體中文', '備份']
for (const note of EN.relNotes) {
  for (const item of note.items) {
    let rest = item
    for (const w of DELIBERATE) rest = rest.split(w).join('')
    assert.ok(!CJK.test(rest), 'EN relNotes ' + note.v + ' has Chinese: ' + item)
  }
}
assert.ok(EN.relNotes.find(n => n.v === '2.0.12').items[0].startsWith('New Remittance entry (now called Send) on Home, the tab bar and the menu;'))
assert.ok(EN.relNotes.find(n => n.v === '2.0.5').items[0].startsWith('New language button (Chinese / English) next to the settings button'))
assert.ok(CN.relNotes.find(n => n.v === '2.0.12').items[0].includes('匯款'), 'CN release notes stay as they are')
// "?" legend: Chinese full stop only in Chinese
assert.ok(ui.includes("(it.name ? (lang() === 'CN' ? '。' : ': ') : '')"))
assert.ok(!ui.includes("(it.name ? '。' : '')"))
// network stats source follows the UI language
const mBox = { window: {} }
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/js/mining/types.js'), 'utf8'), mBox)
const M = mBox.window.SCDOMining
const statsSrc = fs.readFileSync(path.join(__dirname, '../src/js/mining/miningNetworkStats.js'), 'utf8')
assert.ok(statsSrc.includes("scdoscanMainPublic: 'scdoscan.io Shard0 EVM public node'") && statsSrc.includes('sourceText(s)'))
M.lang = 'EN'
assert.strictEqual(M.L('scdoscan.io Shard0 EVM public node'), 'scdoscan.io Shard0 EVM public node')
assert.strictEqual(M.L(' · source: '), ' · source: ')
M.lang = 'CN'
assert.strictEqual(M.L('scdoscan.io Shard0 EVM public node'), 'scdoscan.io Shard0 EVM 公開節點')
assert.strictEqual(M.L(' · source: '), ' · 資料來源：')
const menuSrc = fs.readFileSync(path.join(__dirname, '../src/js/menu.js'), 'utf8')
const menuEn = menuSrc.slice(menuSrc.indexOf('  EN: {'), menuSrc.indexOf('  CN: {'))
const menuCn = menuSrc.slice(menuSrc.indexOf('  CN: {'))
// 3.0.10: one Send item under Wallet. Transfer and Remittance opened the same form.
assert.ok(menuEn.includes("wallet: 'Wallet (balance, send, receive)'") && menuEn.includes("remitItem: 'Send…'"))
assert.ok(!menuEn.includes("send: 'Transfer…'") && !menuEn.includes("remitItem: 'Remittance…'"))
// the only Chinese in the English menu is the deliberate AI小貓 name, as in the English UI
assert.ok(!CJK.test(menuEn.replace(/\/\/.*$/gm, '').split('AI小貓').join('')), 'menu EN has Chinese')
assert.ok(menuCn.includes("wallet: '錢包（餘額・匯款・收款）'") && menuCn.includes("remitItem: '匯款…'"))
assert.ok(!menuCn.includes("send: '轉帳…'"))
const payFn = ui.slice(ui.indexOf('function payModal'), ui.indexOf('function payShowLedger'))
assert.ok(!payFn.includes('I18N112.CN'), 'pay form must follow the UI language')

console.log('remit-route: ok')
// 3.0.2: the newest notes are first and the English ones have no Chinese
assert.strictEqual(EN.relNotes[0].v, '3.0.10')
assert.ok(!/[\u4e00-\u9fff]/.test(EN.relNotes[0].items.join(' ')), 'EN 3.0.10 notes contain Chinese')
assert.ok(!/[\u4e00-\u9fff]/.test(EN.relNotes[1].items.join(' ')), 'EN 3.0.2 notes contain Chinese')
