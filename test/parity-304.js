// 3.0.4 parity fixes (desktop rows of the 2026-10-09 three-wallet audit): one number format, 合計 row,
// self-send with a tick box on all five chains, indexer history for all five chains, official contacts.
'use strict'
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const root = path.join(__dirname, '..')
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8')
const A = require('../src/js/amount.js')

// ---- 1. number format: up to 8 decimals, cut, separators, BigInt/string maths ----
const eq = (a, b) => assert.strictEqual(a, b)
eq(A.fmtUnits(1002801057290000n, 8), '10,028,010.5729')
eq(A.fmtUnits('1004792881280000000000000', 18), '1,004,792.88128')
eq(A.fmtUnits('123456789123456789', 18), '0.12345678') // cut, not 0.12345679
eq(A.fmtUnits(99999999n, 8), '0.99999999')
eq(A.fmtUnits(0n, 8), '0')
eq(A.fmtUnits(100000000000n, 8), '1,000')
eq(A.fmtUnits(21000n, 8), '0.00021')
eq(A.fmtDec('0.29'), '0.29')
eq(A.fmtDec(0.29), '0.29')
eq(A.fmtDec('4.402812349'), '4.40281234')
eq(A.fmtDec('99999999.999999999'), '99,999,999.99999999')
eq(A.fmtDec('1e-7'), '0.0000001')
eq(String(A.toUnits('0.29', 8)), '29000000') // float maths would give 28999999
eq(String(A.toUnits('0.57', 8)), '57000000')
eq(String(A.toUnits('1,000.5', 8)), '100050000000')
eq(A.toUnits('abc', 8), null)
// above 2^53 units (about 90 million SCDO at 8 decimals) the integer path stays exact
eq(A.fmtUnits(9007199254740993n, 8), '90,071,992.54740993')

const app = read('src/js/app112.js')
assert.ok(/function fmtNum \(x\) \{ return AMT\.fmtDec\(x\) \}/.test(app), 'fmtNum is string based')
assert.ok(/function fmtWei \(wei\) \{ return AMT\.fmtUnits\(wei, 18\) \}/.test(app))
assert.ok(!/\/ 1e8/.test(app), 'no float division by 1e8 in the window')
assert.ok(!/minimumFractionDigits: 4/.test(app), 'v8 fixed 4 decimals are gone')
assert.ok(/function oldTotal \(list\) \{ let t = 0n;/.test(app), 'Shard1–4 totals in BigInt')
assert.ok(/known\.reduce\(\(x, y\) => x \+ y, 0n\)/.test(app), 'overall total in BigInt')
const ws = read('src/main/walletService.js')
assert.ok(!/Number\(info\.Balance\) \/ 1e8/.test(ws), 'Shard1–4 balance is integer units')
const W = require('../src/main/walletService.js')._test
eq(W.rawUnits(1002801057290000), '1002801057290000')
eq(W.rawUnits('123'), '123')
eq(W.rawUnits('1.5'), null)
const idx = read('index.html')
assert.ok(idx.indexOf('src/js/amount.js') > 0 && idx.indexOf('src/js/amount.js') < idx.indexOf('src/js/app112.js'))

// ---- 2. confirm window: 合計 (amount + fee) ----
global.window = {}
require('../src/js/i18n112.js')
const I = global.window.I18N112
eq(I.CN.cf_total, '合計（金額＋手續費）')
eq(I.EN.cf_total, 'Total (amount + fee)')
assert.ok(I.CN.cf_totalMax && I.EN.cf_totalMax)
assert.ok(/\[T\('cf_total'\), AMT\.fmtUnits\(units \+ feeU, 8\) \+ ' SCDO'\]/.test(app), 'Shard1–4 confirm has the total row')
assert.ok(/\[T\('cf_totalMax'\), fmtWei\(w \+ f\) \+ ' SCDO'\]/.test(app), 'Shard0 confirm has the total row')
assert.ok(/feeRow\(rev\.fee, route\.amount\)/.test(app) && /feeRow\(st\.payReview\.fee, route\.amount\)/.test(app))

// ---- 3. self-send: allowed with the warning + tick box on all five chains; cross-shard and 0 stay blocked ----
eq(I.CN.cf_warnSelf, '收款地址是你自己，這筆只會扣手續費')
eq(I.CN.warnSelf, '收款地址是你自己，這筆只會扣手續費。')
assert.ok(!/[\u4e00-\u9fff]/.test(I.EN.cf_warnSelf + I.EN.warnSelf + I.EN.ackSelf))
assert.ok(/p\.selfOk !== true\) throw new Error\('SELF'\)/.test(ws), 'main process still refuses a self-send without the tick')
assert.ok(/throw new Error\('CROSS_SHARD'\)/.test(ws), 'cross-shard still blocked in the main process')
assert.ok(/if \(units <= 0n\) throw new Error\('BAD_AMOUNT'\)/.test(ws) && /Number\(amount\) <= 0\) throw new Error\('BAD_AMOUNT'\)/.test(ws), 'zero amount still blocked')
assert.ok(/id="paySelfAck"/.test(app) && /selfOk: self/.test(app), 'Shard1–4 form asks for the tick and passes it')
assert.ok(/TC\('errCross', \{ n: payer\.shard \}\)/.test(app), 'cross-shard still blocked in the window')
assert.ok(/units == null \|\| units <= 0n\) \{ if \(err\) err\.textContent = TC\('errAmount'\)/.test(app), 'zero amount blocked in the window')
assert.ok(/warn: selfWarn\(payer, route\.to\)/.test(app) && /warn: self \? T\('cf_warnSelf'\)/.test(app), 'the confirm window repeats the warning')
assert.ok(/SELF: 'warnSelf'/.test(app), 'Shard0 EVM keeps its warning + tick box')

// ---- 4. history: api.scdoscan.io/api/address/{addr}/txs for all five chains ----
eq(W.ADDR_TXS('1S01abc'), 'https://api.scdoscan.io/api/address/1S01abc/txs?page=1&limit=25')
const me = '1s0139fba7fdc1487da84099a4a7a1192ffbeae3b1'
const row = (t) => W.indexerRow(t, me, 8)
const base = { hash: '0x' + '1'.repeat(64), value: '3965091779', valueFormatted: '39.65091779', token: null, block: 9277498, time: 1791452878, status: 'success' }
eq(row(Object.assign({}, base, { from: '1S01e99d4039ddd3c388afd251e1ec0a2404010651', to: '1S0139fba7fdc1487da84099a4a7a1192ffbeae3b1' })).dir, 'in')
eq(row(Object.assign({}, base, { from: '1S0139fba7fdc1487da84099a4a7a1192ffbeae3b1', to: '1S01e99d4039ddd3c388afd251e1ec0a2404010651' })).dir, 'out')
eq(row(Object.assign({}, base, { from: '1S0139fba7fdc1487da84099a4a7a1192ffbeae3b1', to: '1S0139fba7fdc1487da84099a4a7a1192ffbeae3b1' })).dir, 'self')
const rw = row(Object.assign({}, base, { from: '0S0000000000000000000000000000000000000000', to: '1S0139fba7fdc1487da84099a4a7a1192ffbeae3b1', value: '300000000' }))
eq(rw.dir, 'reward'); eq(rw.raw, '300000000'); eq(rw.decimals, 8); eq(rw.t, 1791452878000); eq(rw.status, 'done')
eq(A.fmtUnits(rw.raw, rw.decimals), '3')
const tok = W.indexerRow(Object.assign({}, base, { from: '0xaa', to: '0xbb', token: { symbol: 'tUSDT', decimals: 6 }, value: '1500000' }), '0xbb', 18)
eq(tok.asset, 'tUSDT'); eq(tok.decimals, 6); eq(A.fmtUnits(tok.raw, tok.decimals), '1.5')
assert.ok(/h\('old:activity', \(e, addr\) => oldActivity\(addr\)\)/.test(ws))
assert.ok(/remote = await addrTxs\(a, 18\)/.test(ws), 'Shard0 EVM reads the address endpoint first')
assert.ok(read('preload.js').includes("'old:activity'"))
assert.ok(/api\.invoke\('old:activity', addr\)/.test(app) && /st\.oldAct\[p\.address\.toLowerCase\(\)\]/.test(app), 'Home lists Shard1–4 history from the indexer')
eq(I.CN.d_txReward, '收到挖礦獎勵 · {chain}'); eq(I.CN.d_txSelf, '轉給自己 · {chain}')

// ---- 5. links: official channel, group, support email ----
const main = read('main.js')
assert.ok(main.includes("/^https:\\/\\/t\\.me\\/(SCDOLabor|SCDOCommunity)$/"))
assert.ok(main.includes("const MAIL_ALLOW = ['mailto:admin@apeccapital.org']"))
for (const u of ['https://t.me/SCDOLabor', 'https://t.me/SCDOCommunity', 'mailto:admin@apeccapital.org']) assert.ok(app.includes(`'${u}'`), u)
assert.ok(/case 'openLink': if \(CONTACT_URLS\.includes\(String\(v \|\| ''\)\)\) openExternal\(v\)/.test(app))
assert.ok(app.includes("${contactHtml('aboutContact')}") && app.includes("${contactHtml('catContact')}"), 'About and AI小貓 show the contacts')
const cat = require('../src/js/aiCat.js')
const say = cat.reply('怎麼聯絡客服？').say
assert.ok(say.includes('t.me/SCDOLabor') && say.includes('t.me/SCDOCommunity') && say.includes('admin@apeccapital.org'))
eq(I.CN.help_title, '說明與聯絡')

// ---- 6. wording stays ----
const cnText = JSON.stringify(I.CN)
assert.ok(!/賬/.test(cnText), 'no 賬')
assert.ok(cnText.includes('今天賺了') && cnText.includes('一共賺了'))
assert.ok(cnText.includes('轉帳') && cnText.includes('帳戶'))

// 3.0.2/3.0.3 bug found while testing: cfRows used TC (only defined inside payModal), so a Shard1–4 confirm window threw
// "TC is not defined" and never opened. cfRows is outside payModal and must only use T.
{ const a = app.indexOf('  function cfRows ('); const b = app.indexOf('\n  }', a); assert.ok(a > 0 && !/\bTC\(/.test(app.slice(a, b)), 'cfRows must not use TC') }

// the confirm window names the address that signs: 1S… for Shard1–4 (3.0.3 showed the 0x address there)
assert.ok(/\[T\('cf_from'\), signingAddress\(payer, route\)/.test(app))

console.log('parity-304: ok')
