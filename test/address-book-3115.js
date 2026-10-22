// 3.1.15: address book + recents, address-poisoning check, first-time full-address confirm.
'use strict'
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const AB = require('../src/js/addressBook.js')
const REAL = '0x036f1111111111111111111111111111111a7264'
const FAKE = '0x036f9999999999999999999999999999999a7264'
const OTHER = '0x1234567890123456789012345678901234567890'
const CR = '1S01aaaa' + '1'.repeat(29) + 'bbbb1'
const CF = '1S01aaaa' + '0'.repeat(29) + 'bbbb1'
assert.strictEqual(AB.lookalike(FAKE, [OTHER, REAL]), REAL)
assert.strictEqual(AB.lookalike(REAL.toUpperCase().replace('0X', '0x'), [REAL]), null)
assert.strictEqual(AB.lookalike(OTHER, [REAL]), null)
assert.strictEqual(AB.lookalike(CF, [CR]), CR)
let list = []
assert.strictEqual(AB.find(list, REAL), null)
list = AB.recordSend(list, REAL, 1); list = AB.recordSend(list, OTHER, 2)
assert.ok(AB.find(list, REAL.toUpperCase().replace('0X', '0x')))
assert.strictEqual(AB.chips(list)[0].address, OTHER)
list = AB.save(list, REAL, ' Alice ')
assert.strictEqual(AB.chips(list)[0].name, 'Alice')
for (let i = 0; i < 30; i++) list = AB.recordSend(list, '0x' + String(i).padStart(40, '0'), 10 + i)
assert.ok(list.filter(e => !e.name).length <= AB.RECENT_LIMIT)
assert.ok(AB.find(list, REAL), 'named entries kept')
global.window = {}
require('../src/js/i18n112.js')
const { CN, EN } = global.window.I18N112
assert.strictEqual(CN.abFirstCheck, '我已核對完整地址'); assert.strictEqual(EN.abFirstCheck, 'I checked the full address')
assert.strictEqual(CN.abSave, '存入通訊錄')
const ui = fs.readFileSync(path.join(__dirname, '../src/js/app112.js'), 'utf8')
const pay = ui.slice(ui.indexOf('function payModal'), ui.indexOf('function payShowLedger'))
const cp = pay.slice(pay.indexOf('async function confirmPay'), pay.indexOf('async function confirmPay') + 400)
assert.ok(cp.includes("s.needFullAck && !($('payFullAck')"), 'Send is refused until the full address is checked')
assert.ok(pay.includes('rememberRecipient(s.lastTo)') && pay.includes('id="payRecents"') && pay.includes('id="paySafety"'))
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8')
assert.ok(html.indexOf('addressBook.js') > 0 && html.indexOf('addressBook.js') < html.indexOf('app112.js'))
console.log('address-book-3115 ok')
