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
assert.strictEqual(chain0.line, '鏈上轉帳 · Shard0 · 手續費約 …')

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
assert.ok(ui.includes('id="btnRemit"'))
assert.ok(ui.includes('id="btnRemitSign"'))
assert.ok(ui.includes("const TABS = ['old', 'new', 'mine']"))
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

console.log('remit-route: ok')
