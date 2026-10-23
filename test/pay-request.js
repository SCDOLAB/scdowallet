// Shard0 request links stay on scdo.com.au and never leave the wallet.
'use strict'
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const Pay = require('../src/js/payRequest')

const ADDR = '0x' + 'ab'.repeat(20)
const built = Pay.build({ address: ADDR, amount: '1.25', memo: 'lunch' })
assert.strictEqual(built.ok, true)
assert.strictEqual(built.chainId, 5680)
assert.ok(built.href.startsWith('https://scdo.com.au/wallet/#/pay?'))
const q = new URLSearchParams(built.href.split('#/pay?')[1])
assert.strictEqual(q.get('to'), ADDR)
assert.strictEqual(q.get('amount'), '1.25')
assert.strictEqual(q.get('token'), 'SCDO')
assert.strictEqual(q.get('memo'), 'lunch')
assert.strictEqual(built.eip681, 'ethereum:' + ADDR + '@5680?value=' + (125n * 10n ** 16n).toString())
assert.ok(!built.href.includes('scdoscan.io'))

assert.strictEqual(Pay.build({ address: ADDR, amount: '0' }).ok, false)
assert.strictEqual(Pay.build({ address: ADDR, amount: '1.123456789' }).ok, false)
assert.strictEqual(Pay.build({ address: '1Sabc', amount: '1' }).ok, false)
assert.strictEqual(Pay.build({ address: ADDR, amount: '1', memo: 'x'.repeat(101) }).ok, false)
assert.strictEqual(Pay.build({ address: ADDR, amount: '2' }).ok, true)

const ui = fs.readFileSync(path.join(__dirname, '../src/js/app112.js'), 'utf8')
assert.ok(ui.includes('data-act="walletMode"') && ui.includes('id="walletReq"') && ui.includes('SCDOPayRequest'))
assert.ok(ui.includes('rememberWalletAddr'))
const page = ui.slice(ui.indexOf('function pageRecv'), ui.indexOf('function paintRecvQr'))
assert.ok(page.includes('id="walletRecv"') && page.includes('id="walletSend"') && page.includes('data-act="recvShard"'))

console.log('pay-request: ok')
