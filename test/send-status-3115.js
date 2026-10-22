// 3.1.15: send result step shows Submitted -> Pending -> Confirmed (Trust Wallet order); confirm button is "Send".
'use strict'
const assert = require('assert')
const fs = require('fs')
const path = require('path')
global.window = {}
require('../src/js/i18n112.js')
const { CN, EN } = global.window.I18N112
assert.strictEqual(EN.wizNext, 'Next'); assert.strictEqual(CN.wizNext, '下一步')
assert.strictEqual(EN.wizSend, 'Send'); assert.strictEqual(CN.wizSend, '確認發送')
assert.deepStrictEqual([EN.wizSubmitted, EN.wizPending, EN.wizConfirmed, EN.wizFailed], ['Submitted', 'Pending', 'Confirmed', 'Failed'])
assert.deepStrictEqual([CN.wizSubmitted, CN.wizPending, CN.wizConfirmed, CN.wizFailed], ['已提交', '處理中', '已確認', '失敗'])
assert.strictEqual(CN.wizFinish, '完成')
const ui = fs.readFileSync(path.join(__dirname, '../src/js/app112.js'), 'utf8')
const pay = ui.slice(ui.indexOf('function payModal'), ui.indexOf('function payShowLedger'))
const sent = pay.slice(pay.indexOf('async function showSent'), pay.indexOf('async function showSent') + 900)
// result step is painted before the receipt wait, then updated in place; Send stays locked
assert.ok(sent.indexOf("paintSent(kept, h, 'pending')") < sent.indexOf('s0:waitReceipt'))
assert.ok(sent.indexOf("TC('wizNoRepeat')") < sent.indexOf('s0:waitReceipt'))
assert.ok(sent.includes("paintTxState('done')") && sent.includes("paintTxState('fail')"))
assert.ok(pay.includes('id="payTxSteps"') && pay.includes('data-act="openTx"') && pay.includes('id="payHash"'))
console.log('send-status-3115 ok')
