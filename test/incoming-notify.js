'use strict'
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { IncomingNotifier, classify, WHEEL_PAYOUT } = require('../src/main/incomingNotifier')

assert.strictEqual(classify(WHEEL_PAYOUT), 'wheel')
assert.strictEqual(classify('0x48dc8ec5a153641e4a6e5f1fc4452f82452f6357'), 'interest')
assert.strictEqual(classify('0x675e8639a73ecfe13561dbabc25e56cb82088d24'), 'bookkeeping')
assert.strictEqual(classify('0x0889453fe946c75163b3bbdf2266f2566b2f4c03'), 'transfer')
assert.strictEqual(classify('0x1111111111111111111111111111111111111111'), 'transfer')

const notes = []
const sounds = []
const badges = []
const store = { data: {}, get (k, d) { return this.data[k] != null ? this.data[k] : d }, set (k, v) { this.data[k] = v } }
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'in-'))
let clock = 1_700_000_000_000
const rows = []
const n = new IncomingNotifier({
  store,
  stateFile: path.join(dir, 'seen.json'),
  lang: () => 'EN',
  now: () => clock,
  pollMs: 999999,
  listAccounts: () => [{ evm: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }],
  activity: async () => rows.slice(),
  notify: (x) => notes.push(x),
  playSound: () => sounds.push(1),
  setBadge: (b) => badges.push(b)
})

// seed seen empty; add a wheel win
rows.push({ dir: 'in', from: WHEEL_PAYOUT, amount: '3', hash: '0xaaa1', t: clock - 1000, asset: 'SCDO' })
n.tick().then(async () => {
  assert.strictEqual(notes.length, 1)
  assert.strictEqual(notes[0].title, 'Received +3 SCDO')
  assert.ok(notes[0].body.indexOf('Wheel win') >= 0)
  assert.strictEqual(sounds.length, 1)

  // bookkeeping batch: two rewards within 10 min → one notif with sum
  notes.length = 0; sounds.length = 0
  rows.push({ dir: 'in', from: '0x675e8639a73ecfe13561dbabc25e56cb82088d24', amount: '1.5', hash: '0xbbb1', t: clock - 500, asset: 'SCDO' })
  rows.push({ dir: 'reward', from: '0S0000000000000000000000000000000000000000', amount: '2.5', hash: '0xbbb2', t: clock - 400, asset: 'SCDO' })
  await n.tick()
  assert.strictEqual(notes.length, 0, 'batched, not yet flushed')
  clock += 10 * 60 * 1000 + 1
  await n.tick()
  assert.strictEqual(notes.length, 1)
  assert.strictEqual(notes[0].title, 'Received +4 SCDO')
  assert.ok(notes[0].body.indexOf('Bookkeeping') >= 0)

  // sound off
  n.set({ sound: false })
  notes.length = 0; sounds.length = 0
  rows.push({ dir: 'in', from: '0x1111111111111111111111111111111111111111', amount: '9', hash: '0xccc1', t: clock - 10, asset: 'SCDO' })
  await n.tick()
  assert.strictEqual(notes.length, 1)
  assert.strictEqual(notes[0].body, 'Transfer')
  assert.strictEqual(sounds.length, 0)

  // 華語
  const n2 = new IncomingNotifier({
    store, lang: () => 'CN', now: () => clock, listAccounts: () => [{ evm: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }],
    activity: async () => [{ dir: 'in', from: WHEEL_PAYOUT, amount: '1', hash: '0xddd1', t: clock - 1, asset: 'SCDO' }],
    notify: (x) => notes.push(x), playSound: () => {}, setBadge: () => {}
  })
  notes.length = 0
  await n2.tick()
  assert.strictEqual(notes[0].title, '到賬 +1 SCDO')
  assert.strictEqual(notes[0].body, '輪盤獎金')

  console.log('incoming-notify ok')
}).catch(e => { console.error(e); process.exit(1) })
