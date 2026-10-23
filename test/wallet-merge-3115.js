// 3.1.15: 收款 and 匯款 share one page, one shard row, and one nav entry.
'use strict'
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const Module = require('module')
const siteNav = require('../src/js/siteNavMap')
const cat = require('../src/js/aiCat')

const root = path.join(__dirname, '..')
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8')
const ui = read('src/js/app112.js')
const css = read('src/css/shell310.css')

const walletKids = siteNav.GROUPS.find(g => g.id === 'wallets').children
assert.strictEqual(walletKids.filter(c => c.id === 'wallet').length, 1)
assert.ok(!walletKids.some(c => c.id === 'receive' || c.id === 'remit'))
assert.ok(!siteNav.flat().some(it => it.id === 'receive' || it.id === 'remit'))
assert.strictEqual(siteNav.byId('wallet').action, 'wallet')
assert.strictEqual(siteNav.byId('receive').action, 'recv')
assert.strictEqual(siteNav.byId('remit').action, 'remit')
assert.strictEqual(siteNav.match('收款').id, 'wallet')
assert.strictEqual(siteNav.match('匯款').id, 'wallet')
assert.strictEqual(siteNav.match('Receive').id, 'wallet')
assert.strictEqual(siteNav.match('Send').id, 'wallet')
assert.strictEqual(cat.reply('收款', { accounts: [] }).actions[0].id, 'wallet')
assert.strictEqual(cat.planOpen('匯款', {}).actions[0].form, 'remit')

const box = { window: {} }
vm.runInNewContext(read('src/js/i18n112.js'), box)
const I = box.window.I18N112
for (const L of ['CN', 'EN']) {
  for (const k of ['navWallet', 'walletShardMoved', 'walletShardMismatch', 'walletGateShard']) {
    assert.ok(I[L][k] && I[L][k].includes('{') === (k !== 'navWallet' && k !== 'walletGateShard'), L + ' ' + k)
  }
}
assert.strictEqual(I.CN.navWallet, '收款與匯款')
assert.strictEqual(I.EN.navWallet, 'Receive & Send')
assert.ok(I.CN.walletShardMoved.includes('付款帳戶'))
assert.ok(I.CN.walletShardMismatch.includes('請改付款分片'))

const page = ui.slice(ui.indexOf('function pageRecv'), ui.indexOf('function paintRecvQr'))
assert.ok(page.includes('class="page shell-wallet"') && page.includes('class="wallet-grid"'))
assert.ok(page.includes('id="walletRecv"') && page.includes('id="walletSend"') && page.includes('id="remitHost"'))
assert.ok(page.includes('data-act="recvShard"') && page.includes('id="qrBox"') && page.includes("selectHtml('recvPick'"))
assert.ok(page.includes("shellFold('recvChains'"))
assert.ok(!page.includes('class="page shell-recv"'))
assert.ok(ui.includes('function pageRemit () { return pageRecv() }'))
assert.ok(ui.includes("['connect', 'navConnect']") && ui.includes("['settings', 'navSettings']"))
assert.ok(ui.includes('data-act="nav" data-v="${esc(id)}"') || ui.includes('data-v="connect"'))
assert.ok(!read('index.html').includes('id="sideNav"'))
assert.ok(css.includes('.side-nav { display: none'))
assert.ok(ui.includes("wallet: pageRecv, recv: pageRecv, remit: pageRecv"))
const setTab = ui.slice(ui.indexOf('function setTab'), ui.indexOf('function headerChain'))
assert.ok(setTab.includes("v === 'remit' || v === 'recv' || v === 'wallet'") && setTab.includes("st.tab = 'wallet'"))
assert.ok(setTab.includes("st.walletFocus = 'send'") && setTab.includes("st.walletFocus = 'recv'"))

const pay = ui.slice(ui.indexOf('function payModal'), ui.indexOf('function payShowLedger'))
assert.ok(pay.includes('id="payPoison"') && pay.includes('id="payFullAck"') && pay.includes("TC('abPoison')") && pay.includes("TC('abFirst')"))
assert.ok(pay.includes("TC('errCross'"))
assert.ok(pay.includes('id="wizPayer"') && pay.includes('accountMenuHtml') && pay.includes('id="payChain"'))
assert.ok(pay.includes("TC('walletShardMismatch'") && pay.includes("TC('walletShardMoved'") && pay.includes("TC('walletGateShard')"))
assert.ok(pay.includes('function shardEntries') && pay.includes('function applyShard'))
assert.ok(pay.includes('data-act="nav" data-v="recv"'))
assert.ok(pay.includes('id="payInvoiceBtn"') || page.includes('id="payInvoiceBtn"'))

assert.ok(css.includes('.wallet-grid') && css.includes('.page.shell-wallet') && css.includes('@media (max-width: 1080px)'))
assert.ok(css.includes('.shell-col:has(.shell-recv)') && css.includes('.page.shell-wallet { max-width: none;'))

const realLoad = Module._load
Module._load = function (req, parent, ...rest) {
  if (req === 'electron') {
    return { Menu: { buildFromTemplate: (t) => t, setApplicationMenu () {} }, app: { getVersion: () => '3.1.15' }, shell: {} }
  }
  return realLoad.call(this, req, parent, ...rest)
}
const menu = require('../src/js/menu.js')
Module._load = realLoad
const cn = menu.buildTemplate(null, 'CN')
const hidden = cn[0].submenu.find(s => s.label === '匯款…')
assert.ok(hidden && hidden.visible === false && hidden.accelerator === 'CmdOrCtrl+T')
const walletMenu = cn.find(m => m.label === '錢包').submenu
assert.strictEqual(walletMenu[0].label, '收款與匯款')
assert.strictEqual(walletMenu[0].accelerator, 'CmdOrCtrl+2')
assert.ok(!walletMenu.some(s => s.accelerator === 'CmdOrCtrl+T'))

console.log('wallet-merge-3115: ok')
