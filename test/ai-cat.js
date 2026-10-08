// AI小貓: rules stay on this PC, Traditional Chinese, and never spend.
'use strict'
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const cat = require('../src/js/aiCat')

const ADDR = '0x' + 'ab'.repeat(20)
const CLASSIC = '1S01dfdbe4d921d507032cb83ee04bb7efc4fd9a51'
const KEY = '0x' + 'cd'.repeat(32)
const accounts = [
  { label: '小明', file: 'ming.json', shard: 1, address: CLASSIC, evm: '' },
  { label: '收款', file: 'recv.json', shard: 0, address: '', evm: ADDR }
]
const base = {
  gpu: { available: true, nvidia: true },
  cpu: { available: true },
  accounts: accounts,
  preferShard: 1,
  shard0Address: ADDR,
  selectedFile: 'recv.json'
}

const mine = cat.planMine(base)
assert.strictEqual(mine.actions[0].type, 'startJobs')
assert.deepStrictEqual(mine.actions[0].jobs.map(j => j.shard), [1, 1])
assert.deepStrictEqual(mine.actions[0].jobs.map(j => j.backend), ['gpu', 'cpu'])
assert.ok(mine.say.includes('Shard1'))
assert.ok(!mine.actions.some(a => a.chain === 'shard0' || (a.jobs || []).some(j => j.chain === 'shard0')))

const bothShards = cat.planMine(Object.assign({}, base, {
  accounts: accounts.concat([{ label: '乙', file: 'b.json', shard: 2, address: '2S02' + 'ab'.repeat(19), evm: '' }])
}))
const classicJobs = bothShards.actions[0].jobs.filter(j => j.chain === 'classic')
assert.strictEqual(classicJobs[0].backend, 'gpu')
assert.strictEqual(classicJobs[0].shard, 1)
assert.strictEqual(classicJobs[1].backend, 'cpu')
assert.strictEqual(classicJobs[1].shard, 1)
assert.ok(bothShards.say.includes('處理器挖 Shard1'))

const livePool = cat.planMine(Object.assign({}, base, {
  accounts: accounts.concat([{ label: '乙', file: 'b.json', shard: 2, address: '2S02' + 'ab'.repeat(19), evm: '' }]),
  pools: { 1: { live: true }, 2: { live: true } }
}))
assert.strictEqual(livePool.actions[0].jobs.filter(j => j.backend === 'cpu')[0].shard, 2)

const gpuPeers = cat.planMine(Object.assign({}, base, {
  preferShard: 2,
  accounts: accounts.concat([{ label: '乙', file: 'b.json', shard: 2, address: '2S02' + 'ab'.repeat(19), evm: '' }]),
  pools: { 1: { live: false }, 2: { live: false } },
  classicGpu: { running: true, shard: 1, peers: 8, localBlock: 10, networkBlock: 20 }
}))
assert.strictEqual(gpuPeers.actions[0].jobs.filter(j => j.backend === 'cpu')[0].shard, 1)

const with0 = cat.planMine(Object.assign({}, base, { includeShard0: true }))
assert.ok(with0.actions[0].jobs.some(j => j.chain === 'shard0' && j.address === ADDR))

const hot = cat.planMine(Object.assign({}, base, { tempC: 86 }))
assert.deepStrictEqual(hot.actions.map(a => a.type), ['stopGpu'])
assert.ok(hot.say.includes('86'))
assert.ok(hot.say.includes('85'))
assert.ok(!hot.say.includes('挖礦中'))
assert.strictEqual(cat.planMine(Object.assign({}, base, { tempC: 84 })).actions[0].type, 'startJobs')
assert.strictEqual(cat.heatGuard({ tempC: 90, classicGpu: { running: true, mode: 'gpu' } }).actions[0].type, 'stopGpu')
assert.strictEqual(cat.heatGuard({ tempC: 90, classicGpu: { running: false } }), null)
assert.strictEqual(cat.heatGuard({ tempC: 70, classicGpu: { running: true, mode: 'gpu' } }), null)

const cpuOnly = cat.planMine({ gpu: { available: false, nvidia: false }, cpu: { available: true }, accounts: accounts })
assert.deepStrictEqual(cpuOnly.actions[0].jobs.map(j => j.backend), ['cpu'])

const none = cat.planMine({ gpu: { available: true }, cpu: { available: true }, accounts: [] })
assert.deepStrictEqual(none.actions, [])
assert.ok(none.say.includes('Classic'))

const stalled = cat.planHeal({
  classicGpu: { running: true, mode: 'gpu', shard: 1, wallet: CLASSIC, localBlock: 10, networkBlock: 100, heightAgeMs: cat.STALL_MS }
})
assert.strictEqual(stalled.actions[0].type, 'restartJobs')
assert.strictEqual(stalled.actions[0].jobs[0].chain, 'classic')
assert.ok(stalled.say.includes('同步停住'))
assert.deepStrictEqual(cat.planHeal({
  classicGpu: { running: true, mode: 'gpu', shard: 1, wallet: CLASSIC, localBlock: 10, networkBlock: 12, heightAgeMs: cat.STALL_MS }
}).actions, [])

const peers = cat.planHeal({
  shard0: { running: true, code: 'NO_PEERS', peers: 0, mode: 'mine', wallet: ADDR, peerAgeMs: 60000 }
})
assert.strictEqual(peers.actions[0].jobs[0].chain, 'shard0')
assert.ok(peers.say.includes('同伴'))

const mem = cat.planHeal({
  mem: { free: 200 * 1024 * 1024 },
  classicGpu: { running: true, mode: 'gpu', shard: 3, wallet: CLASSIC, localBlock: 5, networkBlock: 5, heightAgeMs: 1000 }
})
assert.strictEqual(mem.actions[0].type, 'restartJobs')
assert.ok(mem.say.includes('MB'))
assert.deepStrictEqual(cat.planHeal({ mem: { free: 8 * 1024 * 1024 * 1024 } }).actions, [])

const hotHeal = cat.planHeal({ tempC: 90, classicGpu: { running: true, mode: 'gpu', shard: 1, wallet: CLASSIC } })
assert.deepStrictEqual(hotHeal.actions.map(a => a.type), ['stopGpu'])

const bal = cat.reply('餘額多少', { balances: [{ label: '小明', text: '1.5 SCDO' }, { label: '收款', text: '3 SCDO' }] })
assert.ok(bal.say.includes('小明：1.5 SCDO'))
assert.ok(bal.say.includes('收款：3 SCDO'))
assert.deepStrictEqual(bal.actions, [])
assert.ok(cat.reply('有多少', {}).say.includes('沒有可顯示的餘額'))

const moved = cat.reply('匯 100 給 小明', base)
assert.strictEqual(moved.actions.length, 1)
assert.strictEqual(moved.actions[0].type, 'prefill')
assert.strictEqual(moved.actions[0].chain, 'classic')
assert.strictEqual(moved.actions[0].file, 'recv.json')
assert.strictEqual(moved.actions[0].to, CLASSIC)
assert.strictEqual(moved.actions[0].amount, '100')
assert.ok(moved.say.includes('不會簽名'))
assert.ok(moved.say.includes('不會把錢送出'))
assert.ok(!JSON.stringify(moved).includes('password'))

const evm = cat.reply('轉 2.5 SCDO 給 收款', base)
assert.strictEqual(evm.actions[0].chain, 'shard0')
assert.strictEqual(evm.actions[0].to, ADDR)
assert.strictEqual(evm.actions[0].amount, '2.5')

const tight = cat.reply('匯100給' + ADDR, base)
assert.strictEqual(tight.actions[0].to, ADDR)
assert.strictEqual(tight.actions[0].amount, '100')

const missing = cat.reply('匯 100 給 不存在', base)
assert.strictEqual(missing.actions.length, 1)
assert.strictEqual(missing.actions[0].type, 'prefill')
assert.strictEqual(missing.actions[0].to, '不存在')
assert.strictEqual(missing.actions[0].amount, '100')
assert.strictEqual(missing.actions[0].file, 'recv.json')
assert.ok(missing.say.includes('匯款表單'))
assert.ok(missing.say.includes('不會簽名'))
assert.ok(missing.say.includes('不會把錢送出'))

const fiat = cat.reply('匯 20 美金 給 媽媽', base)
assert.strictEqual(fiat.actions[0].type, 'prefill')
assert.strictEqual(fiat.actions[0].to, '媽媽')
assert.strictEqual(fiat.actions[0].amount, '20美金')
assert.strictEqual(fiat.actions[0].chain, 'remit')

const dup = cat.reply('匯 1 給 小', { accounts: [{ label: '小明', file: 'a', shard: 1, address: CLASSIC }, { label: '小華', file: 'b', shard: 2, address: '2S02' + 'ab'.repeat(19) }] })
assert.deepStrictEqual(dup.actions, [])
assert.ok(dup.say.includes('不只一個'))

const backup = cat.reply('我要備份種子', {})
assert.strictEqual(backup.actions[0].type, 'openBackup')
assert.ok(backup.say.includes('不會顯示種子'))
assert.ok(!backup.say.includes(KEY))

const leaked = cat.reply('我的私鑰是 ' + KEY, {})
assert.deepStrictEqual(leaked.actions, [])
assert.ok(!leaked.say.includes(KEY))
assert.ok(!leaked.say.includes('cdcd'))
assert.ok(cat.looksLikeSecret('legal winner thank year wave sausage worth useful legal winner thank yellow'))
const words = cat.reply('legal winner thank year wave sausage worth useful legal winner thank yellow', {})
assert.ok(!words.say.includes('legal winner'))

for (const plan of [mine, with0, hot, stalled, peers, moved, backup, cat.reply('開始挖礦', base), cat.reply('', {})]) {
  for (const action of plan.actions) assert.ok(!['send', 'sign', 'spend', 'review', 'login'].includes(action.type))
}

const src = fs.readFileSync(path.join(__dirname, '../src/js/aiCat.js'), 'utf8')
const simp = '检测内启动账户余额备确认转账汇给显温过经节软网预这还没个关闭打开请点击设门后对时间问题应该为与从现长发'
for (const ch of simp) assert.ok(!src.includes(ch), 'simplified ' + ch)
assert.ok(!/fetch\s*\(|XMLHttpRequest|https?:|WebSocket|openai|anthropic/i.test(src))
assert.ok(!src.includes('s0:send'))
assert.ok(!src.includes('old:send'))
assert.ok(!src.includes('remit:login'))
assert.ok(src.includes('不會簽名'))
assert.ok(src.includes('AI小貓'))

const ui = fs.readFileSync(path.join(__dirname, '../src/js/app112.js'), 'utf8')
const run = ui.slice(ui.indexOf('function runCatAction'), ui.indexOf('function applyCatPlan'))
assert.ok(run.includes('function runCatAction'))
assert.ok(!run.includes('s0:send'))
assert.ok(!run.includes('old:send'))
assert.ok(!run.includes('remit:login'))
assert.ok(!run.includes('s0:review'))
assert.ok(ui.includes('id="aiCatBtn"') || ui.includes("id=\"aiCatBtn\""))
assert.ok(ui.includes('function payModal (f, prefill)') || ui.includes('function payModal(f, prefill)'))
assert.ok(run.includes('payModal('))
assert.ok(ui.includes('data-act="catEnabled"'))
assert.ok(fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8').includes('aiCat.js'))
assert.ok(fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8').includes("'app:mem'"))
assert.ok(fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8').includes("ipcMain.handle('app:mem'"))

console.log('ai-cat: ok')
