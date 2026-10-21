// SCDO amounts are never rounded: the mining-card earnings line and the incoming notification cut to 8 decimals.
'use strict'
const assert = require('assert')
const mine = require('../src/js/mineHome.js')
const { trimAmt } = require('../src/main/incomingNotifier')

assert.strictEqual(mine.scdoCount(2), '2')
assert.strictEqual(mine.scdoCount(1234567.5), '1,234,567.5')
assert.strictEqual(mine.scdoCount(0.123456789), '0.12345678', 'cut, not rounded up to 0.12345679')
assert.strictEqual(mine.scdoCount(1.999999999), '1.99999999', 'never snapped up to 2')
assert.strictEqual(mine.scdoCount(4.000000004), '4', 'digits past 8 decimals are cut')
assert.strictEqual(mine.scdoCount(1e-7), '0.0000001')
assert.strictEqual(mine.scdoCount(1e21), '1,000,000,000,000,000,000,000')
assert.strictEqual(mine.scdoCount(-0.5), '-0.5')

assert.strictEqual(trimAmt(0.123456789), '0.12345678')
assert.strictEqual(trimAmt(9.999999999), '9.99999999')
assert.strictEqual(trimAmt(100), '100')
assert.strictEqual(trimAmt(0), '0')
assert.strictEqual(trimAmt(2.5e-8), '0.00000002')
assert.strictEqual(trimAmt('abc'), '0')
console.log('amount-never-round: ok')
