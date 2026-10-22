// RC6: a send appears in history at once as pending, turns done, and leaves when the source lists it.
'use strict'
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const PT = require('../src/js/pendingTx')
const mem = () => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v) } } }
const store = mem()
const S0 = '0x' + 'ab'.repeat(20)
const C1 = '1S01' + 'cd'.repeat(18) + 'a1'
const H0 = '0x' + '1'.repeat(64)
const H1 = '2'.repeat(64)
const now = 1e12
let l = PT.add(PT.load(store), { hash: H0, from: S0, to: '0x' + 'ee'.repeat(20), amount: '1.5', shard: 0 }, now)
l = PT.add(l, { hash: H1, from: C1, to: '1S01' + 'ff'.repeat(18) + 'a1', amount: '2', shard: 1 }, now)
PT.save(store, l)
let rows = PT.merge([], PT.load(store), S0)
assert.strictEqual(rows.length, 1); assert.strictEqual(rows[0].status, 'pending'); assert.strictEqual(rows[0].amount, '1.5'); assert.strictEqual(rows[0].dir, 'out')
assert.strictEqual(PT.merge([{ hash: 'x', status: 'done' }], PT.load(store), C1.toUpperCase()).length, 2)
PT.save(store, PT.setStatus(PT.load(store), H0.toUpperCase(), 'done'))
assert.strictEqual(PT.merge([], PT.load(store), S0)[0].status, 'done')
// source lists the hash (case / 0x differences ignored): no duplicate, then pruned
assert.strictEqual(PT.merge([{ hash: H0.slice(2).toUpperCase() }], PT.load(store), S0).length, 1)
PT.save(store, PT.prune(PT.load(store), { [S0]: [{ hash: H0 }], [C1.toLowerCase()]: [] }, now + 1000))
assert.deepStrictEqual(PT.load(store).map(p => p.hash), [H1])
assert.strictEqual(PT.prune(PT.load(store), {}, now + 25 * 3600 * 1000).length, 0)
const app = fs.readFileSync(path.join(__dirname, '../src/js/app112.js'), 'utf8')
assert.ok(/addPending\(\{ hash: res\.hash, from: payer\.evm/.test(app), 'Shard0 send records pending')
assert.ok(/addPending\(\{ hash: res\.hash, from: \(parseClassicAddress/.test(app), 'Classic send records pending')
assert.ok(/pendingStatus\(h, 'done'\)/.test(app))
assert.ok(fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8').includes('src/js/pendingTx.js'))
const i18n = fs.readFileSync(path.join(__dirname, '../src/js/i18n112.js'), 'utf8')
assert.ok(!/payAmountPh: '[^']*(元|dollar)/.test(i18n), 'amount hint has no fiat wording')
console.log('pending-tx: ok')
