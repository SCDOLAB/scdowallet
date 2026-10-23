// Home Agent card: 開始記帳 starts or stops on the bookkeeping-page path,
// and Shard0–Shard4 stay visible when idle and while bookkeeping.
'use strict'
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const root = path.join(__dirname, '..')
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const mine = require('../src/js/mineHome')
const Join = require('../src/js/agentJoin')

const box = { window: {} }
vm.runInNewContext(read('src/js/i18n112.js'), box)
const I = box.window.I18N112
function makeT (pack) {
  return (k, p) => {
    let s = pack[k]
    if (s == null) s = k
    if (p && typeof s === 'string') s = s.replace(/\{(\w+)\}/g, (m, n) => p[n] != null ? p[n] : m)
    return s
  }
}
const CN = makeT(I.CN)
const EN = makeT(I.EN)
const esc = (s) => String(s == null ? '' : s)

const poolGpu = {
  running: true, mode: 'gpu', chain: 'classic', shard: 1, backend: 'zminer-gpu',
  procs: ['zminer-gpu'], phase: 'starting', code: 'POOL_CONNECTING'
}
assert.deepStrictEqual(mine.activeBookShards({ classicGpu: poolGpu }), [1])
assert.strictEqual(mine.homeLine({ miners: { classicGpu: poolGpu } }, CN), '顯示卡經記帳池記帳中（Shard1）')
assert.strictEqual(mine.homeLine({ miners: { classicGpu: poolGpu } }, EN), 'Graphics card bookkeeping through the pool (Shard1)')

const cpu = { running: true, mode: 'cpu', chain: 'classic', shard: 3, procs: ['zminer'] }
assert.deepStrictEqual(mine.activeBookShards({ classicCpu: cpu }), [3])
assert.strictEqual(mine.homeLine({ miners: { classicCpu: cpu } }, CN), '經記帳池記帳中（Shard3）')
assert.strictEqual(mine.homeLine({ miners: { classicCpu: cpu } }, EN), 'Bookkeeping through the pool (Shard3)')

const both = mine.homeLine({
  miners: {
    classicGpu: Object.assign({}, poolGpu, { shards: [
      { running: true, mode: 'gpu', shard: 1, backend: 'zminer-gpu', procs: ['zminer-gpu'], phase: 'mining' },
      { running: true, mode: 'gpu', shard: 4, backend: 'zminer-gpu', procs: ['zminer-gpu'], phase: 'mining' }
    ] }),
    classicCpu: cpu
  }
}, CN)
assert.ok(both.includes('Shard1'))
assert.ok(both.includes('Shard3'))
assert.ok(both.includes('Shard4'))
assert.ok(both.startsWith('顯示卡經記帳池記帳中'))

const s0 = { running: true, mode: 'mine', chain: 'shard0', shard: 0, procs: ['rigel'] }
assert.deepStrictEqual(mine.activeBookShards({ shard0: s0 }), [0])
assert.strictEqual(mine.homeLine({ miners: { shard0: s0 } }, CN), I.CN.homeLineShard0)
assert.ok(mine.homeLine({ miners: { shard0: s0, classicCpu: cpu } }, CN).includes('Shard0 EVM'))
assert.ok(mine.homeLine({ miners: { shard0: s0, classicCpu: cpu } }, CN).includes('Shard3'))

assert.strictEqual(mine.homeLine({
  miners: { classicGpu: { running: true, mode: 'gpu', shard: 1, backend: 'classic-node', code: 'CLASSIC_SYNCING', phase: 'syncing', procs: [] } }
}, CN), I.CN.homeLineIdle)

assert.strictEqual(mine.homeLine({
  phase: 'starting',
  press: { gpu: 'starting' },
  chains: { gpu: [2], cpu: [] },
  miners: {}
}, CN), '正在啟動記帳（Shard2）')
assert.strictEqual(mine.homeLine({
  phase: 'starting',
  press: { gpu: 'starting' },
  chains: { gpu: [2], cpu: [] },
  miners: {}
}, EN), 'Bookkeeping is starting (Shard2)')

assert.deepStrictEqual(mine.planHomeBookClick([
  { device: 'gpu', phase: 'mining', alive: true, chains: [1] },
  { device: 'cpu', phase: 'stopped', alive: false, chains: [] }
]), { op: 'stop', devices: ['gpu'] })
assert.deepStrictEqual(mine.planHomeBookClick([
  { device: 'gpu', phase: 'stopped', alive: false, chains: [1, 2] },
  { device: 'cpu', phase: 'stopped', alive: false, chains: [3] }
]), { op: 'start', devices: ['gpu', 'cpu'] })
assert.deepStrictEqual(mine.planHomeBookClick([
  { device: 'gpu', phase: 'stopped', alive: false, chains: [] },
  { device: 'cpu', phase: 'stopped', alive: false, chains: [] }
]), { op: 'need-chain', devices: [] })
assert.deepStrictEqual(mine.planHomeBookClick([
  { device: 'gpu', phase: 'starting', alive: false, chains: [1] }
]), { op: 'busy', devices: [] })

function card (book, t) {
  return Join.agentCardHtml(t, esc, {
    status: 'online',
    scdoAddress: '1S01abc',
    shard: 1,
    canSwitchShard: true,
    x402Reserve: '',
    book: book,
    entries: []
  })
}
const running = card({
  phase: 'mining',
  note: CN('agentBookNow', { list: 'Shard1' }) + ' ' + CN('shellShard0Stopped'),
  shards: [
    { n: 0, state: 'off' },
    { n: 1, state: 'running' },
    { n: 2, state: 'idle' },
    { n: 3, state: 'idle' },
    { n: 4, state: 'idle' }
  ]
}, CN)
assert.ok(running.includes('記帳分片'))
assert.ok(running.includes('正在記帳：Shard1'))
assert.ok(running.includes('Shard0 EVM 顯卡記帳已停止，只記 Shard1–Shard4'))
assert.ok(running.includes('data-state="off"') && running.includes('>Shard0 EVM<'))
assert.ok(running.includes('data-state="running"') && running.includes('>Shard1<'))
assert.ok(running.includes('Shard2') && running.includes('Shard3') && running.includes('Shard4'))
assert.ok(running.includes('id="agentBookBtn" data-act="isleStart"'))
assert.ok(running.includes('停止記帳'))
assert.ok(running.includes('class="shell-act stop"'))
assert.ok(!running.includes('>開始記帳<'))
assert.ok(!/data-state="running"[^>]*data-act="agentBookShard"/.test(running))

const idle = card({
  phase: 'stopped',
  note: CN('agentBookNext', { list: 'Shard2' }) + ' ' + CN('shellShard0Stopped'),
  shards: [
    { n: 0, state: 'off' },
    { n: 1, state: 'idle' },
    { n: 2, state: 'selected' },
    { n: 3, state: 'idle' },
    { n: 4, state: 'idle' }
  ]
}, CN)
assert.ok(idle.includes('已選記帳：Shard2'))
assert.ok(idle.includes('data-state="selected"') && idle.includes('data-act="agentBookShard" data-v="2"'))
assert.ok(idle.includes('data-act="agentBookShard" data-v="1"'))
assert.ok(!idle.includes('data-act="agentBookShard" data-v="0"'))
assert.ok(idle.includes('>開始記帳<'))
assert.ok(idle.includes('data-act="agentShard" data-v="1"'))

const idleEn = card({
  phase: 'stopped',
  note: EN('agentBookNone') + ' ' + EN('shellShard0Stopped'),
  shards: [0, 1, 2, 3, 4].map(n => ({ n: n, state: n === 0 ? 'off' : 'idle' }))
}, EN)
assert.ok(idleEn.includes('Bookkeeping shards'))
assert.ok(idleEn.includes('No shard selected. Choose Shard1–Shard4 first.'))
assert.ok(idleEn.includes('Shard0 EVM graphics-card bookkeeping has stopped; Shard1–Shard4 only'))
assert.ok(idleEn.includes('>Start bookkeeping<'))
assert.ok(idleEn.includes('>Shard0 EVM<'))

const starting = card({ phase: 'starting', note: '', shards: [{ n: 1, state: 'selected' }] }, CN)
assert.ok(starting.includes('正在啟動…'))
assert.ok(starting.includes('disabled'))
assert.ok(!starting.includes('>開始記帳<'))

const app = read('src/js/app112.js')
assert.ok(app.includes('book: agentBookModel()'))
assert.ok(app.includes("case 'agentBookShard'"))
assert.ok(app.includes('toggleBookShard(n)'))
assert.ok(app.includes('refreshAgentBook()'))
assert.strictEqual(I.CN.agentStopBook, '停止記帳')
assert.strictEqual(I.EN.agentStopBook, 'Stop bookkeeping')
assert.strictEqual(I.CN.agentBookShards, '記帳分片')
assert.strictEqual(I.EN.agentBookShards, 'Bookkeeping shards')
assert.ok(!/GPU|CPU/.test(I.CN.agentBookShards + I.CN.agentBookNow + I.CN.agentBookNext + I.CN.agentBookNone + I.CN.homeLineWithShards))
assert.ok(!/Shard0(?! EVM)/.test(I.CN.agentBookNone + I.EN.agentBookNone))

console.log('home-agent-book: ok')
