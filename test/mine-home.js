// 3.0.10: Home mining card wording, start/stop choice, and listed-only-if-running.
'use strict'
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const root = path.join(__dirname, '..')
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8')
const mine = require('../src/js/mineHome.js')
const island = require('../src/js/statusIsland.js')

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
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

const ADDR = '0x' + 'ab'.repeat(20)
const CLASSIC = '1S01' + 'a'.repeat(36)

function stopped () {
  return mine.formatMineHome({ miners: {}, temps: [], earnLog: null, now: 0, phase: 'stopped' }, CN)
}

// ---- empty / unavailable is a dash, never a sample number ----
{
  const m = stopped()
  assert.strictEqual(m.statusText, '挖礦狀態：已停止')
  assert.strictEqual(m.statusTone, 'off')
  assert.strictEqual(m.speedText, '挖礦速度 —')
  assert.strictEqual(m.tempText, '顯卡溫度 —')
  assert.strictEqual(m.todayText, '今天挖到 —')
  assert.strictEqual(m.lastText, '最近一次收益：—')
  assert.strictEqual(m.chainsText, '正在挖的鏈：—')
  assert.strictEqual(m.buttonText, '開始挖礦')
  assert.strictEqual(m.buttonDisabled, false)
  assert.strictEqual(m.buttonKind, 'start')
  const html = mine.cardHtml({ miners: {}, temps: [{ tempC: 55 }], earnLog: null, now: 0, phase: 'stopped' }, CN, esc)
  assert.ok(html.includes('挖礦狀態：已停止'))
  assert.ok(html.includes('顯卡溫度'))
  assert.ok(!html.includes('55'), 'a temperature reading is not shown when no graphics-card miner is running')
  assert.ok(!html.includes('76'))
  assert.ok(!/Shard1 EVM/.test(html))
  assert.ok(!html.includes('主鏈'))
  assert.strictEqual((html.match(/data-act="homeMine"/g) || []).length, 1)
}

// ---- live miner, temperature bands, today's coins, last payout, chain names ----
{
  const t0 = new Date(2026, 9, 9, 14, 5, 30).getTime()
  const now = t0 + 3 * 60000 + 20000
  const earlier = t0 - 24 * 3600 * 1000
  const miners = {
    shard0: { running: true, mode: 'mine', chain: 'shard0', code: 'MINING', hashrate: 1200.4, procs: ['rigel'] },
    classicCpu: { running: true, mode: 'cpu', chain: 'classic', code: 'CLASSIC_MINING', shard: 3, hashrate: 40, procs: ['zminer'] },
    classicGpu: { running: true, mode: 'gpu', chain: 'classic', code: 'CLASSIC_GPU', shard: 1, hashrate: 80, procs: ['classic-node'] }
  }
  const log = { certain: true, items: [
    { t: earlier, amount: 2, address: CLASSIC, confirmed: true },
    { t: t0, amount: 2, address: ADDR, confirmed: true },
    { t: t0, amount: 2, address: CLASSIC, confirmed: true }
  ] }
  const m = mine.formatMineHome({ miners, temps: [{ tempC: 55 }, { tempC: 40 }], earnLog: log, now, phase: 'mining' }, CN)
  assert.strictEqual(m.statusText, '挖礦狀態：正在挖礦')
  assert.strictEqual(m.statusTone, 'on')
  assert.strictEqual(m.speedText, '挖礦速度 每秒 1,320 次')
  assert.strictEqual(m.tempText, '顯卡溫度 55°C（正常）')
  assert.strictEqual(m.tempBand, 'ok')
  assert.strictEqual(m.todayText, '今天挖到 4 SCDO')
  assert.strictEqual(m.lastClock, '14:05')
  assert.strictEqual(m.lastMinutes, 3)
  assert.strictEqual(m.lastText, '最近一次收益：14:05（3 分鐘前）')
  assert.deepStrictEqual(m.chains, ['Shard0 EVM', 'Shard1 Classic', 'Shard3 Classic'])
  assert.strictEqual(m.chainsText, '正在挖的鏈：Shard0 EVM、Shard1 Classic、Shard3 Classic')
  assert.ok(!/Shard1 EVM|主鏈/.test(m.chainsText + m.statusText))
  assert.strictEqual(m.buttonText, '停止挖礦')
  assert.strictEqual(m.buttonKind, 'stop')
  assert.strictEqual(mine.earnOf(log, now).todayScdo, 4)
  assert.strictEqual(mine.earnOf({ items: [{ t: t0, shard: 1, height: 21 }] }, now), null)
  const html = mine.cardHtml({ miners, temps: [{ tempC: 55 }], earnLog: log, now, phase: 'mining' }, CN, esc)
  assert.ok(html.includes('挖礦狀態：正在挖礦'))
  assert.ok(html.includes('temp-ok'))
  assert.ok(html.includes('每秒 1,320 次'))
  assert.ok(html.includes('55°C（正常）'))
  assert.ok(html.includes('4 SCDO'))
  assert.ok(html.includes('14:05（3 分鐘前）'))
  assert.ok(html.includes('Shard0 EVM、Shard1 Classic、Shard3 Classic'))
  assert.ok(html.includes('class="btn big dan"'))
  assert.ok(!html.includes('disabled'))
}

function band (c) {
  const miners = { classicGpu: { running: true, mode: 'gpu', chain: 'classic', shard: 2, hashrate: 10 } }
  return mine.formatMineHome({ miners, temps: [{ tempC: c }], earnLog: { items: [] }, now: 0, phase: 'mining' }, CN)
}
assert.strictEqual(band(74).tempBand, 'ok')
assert.strictEqual(band(74).tempText, '顯卡溫度 74°C（正常）')
assert.strictEqual(band(75).tempBand, 'warm')
assert.strictEqual(band(75).tempText, '顯卡溫度 75°C（偏熱）')
assert.strictEqual(band(84).tempBand, 'warm')
assert.strictEqual(band(85).tempBand, 'hot')
assert.strictEqual(band(85).tempText, '顯卡溫度 85°C（過熱已暫停）')
assert.strictEqual(mine.tempBand(74), island.tempBand(74))
assert.strictEqual(mine.tempBand(75), island.tempBand(75))
assert.strictEqual(mine.tempBand(85), island.tempBand(85))

// A confirmed empty reward list is 0 SCDO. A miner height log, or no list, is a dash.
{
  const miners = { classicCpu: { running: true, mode: 'cpu', chain: 'classic', shard: 2, hashrate: 0, procs: ['zminer'] } }
  const known = mine.formatMineHome({ miners, temps: [{ tempC: 90 }], earnLog: { certain: true, items: [] }, now: Date.now(), phase: 'mining' }, CN)
  assert.strictEqual(known.todayText, '今天挖到 0 SCDO')
  assert.strictEqual(known.lastText, '最近一次收益：—')
  const guessed = mine.formatMineHome({ miners, earnLog: { items: [{ t: Date.now(), shard: 1, height: 9 }] }, now: Date.now(), phase: 'mining' }, CN)
  assert.strictEqual(guessed.todayText, '今天挖到 —')
  assert.strictEqual(guessed.lastText, '最近一次收益：—')
  assert.strictEqual(known.speedText, '挖礦速度 —')
  assert.strictEqual(known.tempText, '顯卡溫度 —', 'processor mining does not invent a graphics-card temperature')
  assert.strictEqual(known.chainsText, '正在挖的鏈：—', 'a process with no speed is not listed')
  assert.ok(!known.chains.includes('Shard2 Classic'))
  assert.ok(!known.chainsText.includes('EVM'))
}

// Shard0 in node mode, and a classic miner parked on the 0x chain, are not "mining those chains".
{
  const miners = {
    shard0: { running: true, mode: 'node', chain: 'shard0', hashrate: 999 },
    classicGpu: { running: true, mode: 'gpu', chain: 'classic', shard: 0, hashrate: 10, procs: ['classic-node'] }
  }
  const m = mine.formatMineHome({ miners, temps: [{ tempC: 55 }], earnLog: null, phase: 'mining' }, CN)
  assert.strictEqual(m.chainsText, '正在挖的鏈：—')
  assert.strictEqual(m.speedText, '挖礦速度 每秒 10 次')
  assert.strictEqual(m.tempText, '顯卡溫度 55°C（正常）')
  assert.ok(!m.chains.join(' ').includes('Shard1 EVM'))
}

// English stays English and uses the same bands.
{
  const miners = { shard0: { running: true, mode: 'mine', chain: 'shard0', hashrate: 10, procs: ['rigel'] } }
  const m = mine.formatMineHome({ miners, temps: [{ tempC: 85 }], earnLog: { items: [] }, now: 0, phase: 'mining' }, EN)
  assert.strictEqual(m.statusText, 'Mining status: mining now')
  assert.strictEqual(m.tempText, 'Graphics card temperature 85°C (too hot, paused)')
  assert.strictEqual(m.chainsText, 'Chains being mined: Shard0 EVM')
  assert.ok(!/[\u4e00-\u9fff]/.test([m.statusText, m.speedText, m.tempText, m.todayText, m.lastText, m.chainsText, m.buttonText].join(' ')))
}

// In progress: the button changes and ignores the look of the miners.
{
  const start = mine.formatMineHome({ miners: {}, phase: 'starting' }, CN)
  assert.strictEqual(start.statusText, '挖礦狀態：正在啟動')
  assert.strictEqual(start.buttonText, '正在啟動…')
  assert.strictEqual(start.buttonDisabled, true)
  const stop = mine.formatMineHome({ miners: { shard0: { running: true, mode: 'mine', chain: 'shard0' } }, phase: 'stopping' }, CN)
  assert.strictEqual(stop.statusText, '挖礦狀態：正在停止')
  assert.strictEqual(stop.buttonText, '正在停止…')
  assert.strictEqual(stop.buttonDisabled, true)
  const html = mine.cardHtml({ phase: 'starting' }, CN, esc)
  assert.ok(html.includes('disabled'))
  assert.ok(html.includes('正在啟動…'))
}

// ---- start/stop state machine ----
const step = mine.reduceMinePhase
assert.strictEqual(step('stopped', 'click'), 'starting')
assert.strictEqual(step('starting', 'click'), 'starting')
assert.strictEqual(step('starting', 'ok'), 'mining')
assert.strictEqual(step('starting', 'fail'), 'stopped')
assert.strictEqual(step('mining', 'click'), 'stopping')
assert.strictEqual(step('stopping', 'click'), 'stopping')
assert.strictEqual(step('stopping', 'ok'), 'stopped')
assert.strictEqual(step('stopping', 'cancel'), 'mining')
assert.strictEqual(step('stopping', 'fail'), 'mining')
assert.strictEqual(step('stopped', 'ok'), 'stopped')
assert.strictEqual(step('stopped', 'boot'), 'stopped')
assert.strictEqual(step('stopped', 'resume'), 'stopped')
assert.strictEqual(step('mining', 'boot'), 'mining')
assert.strictEqual(step('', 'click'), 'starting')
assert.notStrictEqual(step('stopped', 'click'), 'mining')

// Jobs follow the saved backend and addresses. No address means no job.
assert.deepStrictEqual(mine.jobsForHome({}), [])
assert.deepStrictEqual(mine.jobsForHome({ backend: 'cpu', nvidia: true, caps: { cpu: { available: true }, gpu: { available: true } } }), [])
{
  const jobs = mine.jobsForHome({
    backend: 'cpu',
    caps: { cpu: { available: true }, gpu: { available: true } },
    classic: { address: CLASSIC, shard: 2 },
    reward: ADDR,
    nvidia: true,
    preflight: { gpus: [{ status: 'ready', vendor: 'NVIDIA' }] }
  })
  assert.deepStrictEqual(jobs, [
    { chain: 'classic', backend: 'cpu', gpuMiner: 'classic-node', shard: 2, address: CLASSIC }
  ])
  const withShard0 = mine.jobsForHome({
    saved: { classic: 'cpu', shard0: true },
    caps: { cpu: { available: true }, gpu: { available: true } },
    classic: { address: CLASSIC, shard: 2 },
    reward: ADDR,
    nvidia: true,
    preflight: { gpus: [{ status: 'ready', vendor: 'NVIDIA' }] }
  })
  assert.deepStrictEqual(withShard0, [
    { chain: 'classic', backend: 'cpu', gpuMiner: 'classic-node', shard: 2, address: CLASSIC },
    { chain: 'shard0', backend: 'gpu', mode: 'mine', address: ADDR }
  ])
}
{
  const jobs = mine.jobsForHome({
    backend: 'external',
    caps: { external: { available: true }, cpu: { available: true } },
    classic: { address: CLASSIC, shard: 4 },
    reward: ADDR,
    nvidia: false
  })
  assert.strictEqual(jobs.length, 1)
  assert.strictEqual(jobs[0].gpuMiner, 'external')
  assert.strictEqual(jobs[0].backend, 'gpu')
  assert.strictEqual(jobs[0].shard, 4)
}
assert.deepStrictEqual(mine.jobsForHome({
  backend: 'gpu',
  caps: { gpu: { available: false }, cpu: { available: true } },
  classic: { address: CLASSIC, shard: 1 },
  reward: 'not-an-address',
  nvidia: true
}), [])
{
  const hot = mine.jobsForHome({
    backend: 'cpu',
    caps: { cpu: { available: true } },
    classic: { address: CLASSIC, shard: 1 },
    reward: ADDR,
    nvidia: true,
    hot: true
  })
  assert.deepStrictEqual(hot.map(j => j.chain), ['classic'])
  assert.ok(hot.every(j => j.backend === 'cpu'))
}
assert.deepStrictEqual(mine.jobsForHome({
  backend: 'cpu',
  classic: { address: CLASSIC, shard: 0 },
  reward: ADDR,
  nvidia: true
}).filter(j => j.chain === 'classic'), [])

// Stop keeps the graphics-card choice. The next start does not fall back to the processor,
// and Shard0 EVM is started only when it was enabled and the check passed.
{
  const saved = { classic: 'gpu', shard0: false }
  const kept = mine.choiceAfterStop(saved)
  assert.deepStrictEqual(kept, { classic: 'gpu', cpu: false, shard0: false })
  const ready = { gpus: [{ status: 'ready', vendor: 'NVIDIA' }] }
  const jobs = mine.jobsForHome({
    saved: kept,
    backend: 'cpu',
    caps: { cpu: { available: true }, gpu: { available: true } },
    classic: { address: CLASSIC, shard: 2 },
    reward: ADDR,
    nvidia: true,
    preflight: ready
  })
  assert.deepStrictEqual(jobs, [
    { chain: 'classic', backend: 'gpu', gpuMiner: 'classic-node', shard: 2, address: CLASSIC }
  ])
  const again = mine.jobsForHome({
    saved: mine.choiceAfterStop(kept),
    backend: 'cpu',
    caps: { cpu: { available: true }, gpu: { available: true } },
    classic: { address: CLASSIC, shard: 2 },
    reward: ADDR,
    nvidia: true,
    preflight: ready
  })
  assert.strictEqual(again[0].backend, 'gpu')
  assert.ok(!again.some(j => j.backend === 'cpu'))
  assert.ok(!again.some(j => j.chain === 'shard0'))
}
{
  const blocked = mine.jobsForHome({
    saved: { classic: 'gpu', shard0: true },
    backend: 'cpu',
    caps: { gpu: { available: true }, cpu: { available: true } },
    classic: { address: CLASSIC, shard: 1 },
    reward: ADDR,
    nvidia: true,
    preflight: { gpus: [{ status: 'notReady', vendor: 'NVIDIA' }] }
  })
  assert.strictEqual(blocked.length, 1)
  assert.strictEqual(blocked[0].backend, 'gpu')
  assert.ok(!blocked.some(j => j.chain === 'shard0'))
  assert.strictEqual(mine.shard0PreflightOk({ gpus: [{ status: 'notReady' }] }), false)
  assert.strictEqual(mine.shard0PreflightOk({ gpus: [{ status: 'ready' }] }), true)
  const busy = mine.jobsForHome({
    saved: { classic: 'external', shard0: true },
    caps: { external: { available: true } },
    classic: { address: CLASSIC, shard: 4 },
    reward: ADDR,
    nvidia: true,
    preflight: { gpus: [{ status: 'ready' }] },
    gpuBusy: true
  })
  assert.strictEqual(busy.length, 1)
  assert.strictEqual(busy[0].gpuMiner, 'external')
  assert.ok(!busy.some(j => j.chain === 'shard0'))
}
{
  const hot = mine.jobsForHome({
    saved: { classic: 'gpu', shard0: true },
    caps: { gpu: { available: true }, cpu: { available: true } },
    classic: { address: CLASSIC, shard: 1 },
    reward: ADDR,
    nvidia: true,
    preflight: { gpus: [{ status: 'ready' }] },
    hot: true
  })
  assert.deepStrictEqual(hot, [])
  assert.deepStrictEqual(mine.choiceAfterStop({ classic: 'gpu', shard0: true }), { classic: 'gpu', cpu: false, shard0: true })
}

// Listed only when the process is alive and a speed has been read.
{
  const wanted = mine.formatMineHome({
    miners: {
      shard0: { running: true, mode: 'mine', chain: 'shard0', code: 'MINING', hashrate: 500 },
      classicGpu: { running: true, mode: 'gpu', chain: 'classic', code: 'CLASSIC_GPU', shard: 2, hashrate: 80 }
    },
    phase: 'mining'
  }, CN)
  assert.deepStrictEqual(wanted.chains, [])
  assert.strictEqual(wanted.chainsText, '正在挖的鏈：—')
  assert.strictEqual(wanted.statusText, '挖礦狀態：等待同步，同步完成後自動開始')
  assert.strictEqual(wanted.statusTone, 'wait')
  assert.strictEqual(wanted.speedText, '挖礦速度 —')
  assert.strictEqual(wanted.buttonText, '停止挖礦')
  assert.strictEqual(wanted.buttonKind, 'stop')
  const alive = {
    running: true, mode: 'gpu', chain: 'classic', code: 'CLASSIC_GPU', shard: 1,
    procs: ['classic-node'], hashrate: null, poolStats: { hashrate: 80 }
  }
  const resumed = mine.formatMineHome({ miners: { classicGpu: alive }, phase: 'stopped' }, CN)
  assert.deepStrictEqual(resumed.chains, ['Shard1 Classic'])
  assert.strictEqual(resumed.speedText, '挖礦速度 每秒 80 次')
  assert.strictEqual(resumed.statusText, '挖礦狀態：正在挖礦')
  const syncing = mine.formatMineHome({
    miners: {
      shard0: {
        running: true, mode: 'mine', chain: 'shard0', code: 'SYNCING', procs: ['geth'],
        hashrate: null, localBlock: 960000, networkBlock: 1000000
      }
    }
  }, CN)
  assert.deepStrictEqual(syncing.chains, [])
  assert.strictEqual(syncing.statusText, '挖礦狀態：等待同步（Shard0 EVM 同步進度 96%），同步完成後自動開始')
  assert.strictEqual(syncing.statusTone, 'wait')
  assert.strictEqual(syncing.buttonText, '停止挖礦')
  assert.strictEqual(syncing.noteText, '')
  assert.ok(!/Shard0 EVM/.test(syncing.chains.join(' ')))
  const html = mine.cardHtml({
    miners: {
      shard0: { running: true, mode: 'mine', chain: 'shard0', code: 'SYNCING', localBlock: 960000, networkBlock: 1000000 }
    }
  }, CN, esc)
  assert.ok(html.includes('class="mh-status wait"'))
  assert.ok(html.includes('同步進度 96%'))
  assert.ok(html.includes('同步完成後自動開始'))
  assert.ok(html.includes('停止挖礦'))
  assert.ok(!html.includes('挖礦狀態：已停止'))
  assert.ok(!html.includes('正在挖的鏈：Shard0 EVM'))
  const busy = mine.formatMineHome({ miners: {}, gpuBusy: true }, CN)
  assert.strictEqual(busy.noteText, '顯卡正被其他程式使用')
  assert.deepStrictEqual(busy.chains, [])
  assert.strictEqual(busy.statusText, '挖礦狀態：已停止')
  assert.strictEqual(busy.buttonText, '開始挖礦')
  const busyEn = mine.formatMineHome({ miners: {}, gpuBusy: true }, EN)
  assert.strictEqual(busyEn.noteText, 'The graphics card is being used by another program.')
  assert.ok(!/[\u4e00-\u9fff]/.test(busyEn.noteText))
  const noPct = mine.formatMineHome({
    miners: { shard0: { running: true, mode: 'mine', chain: 'shard0', code: 'SYNCING' } }
  }, CN)
  assert.strictEqual(noPct.statusText, '挖礦狀態：等待同步（Shard0 EVM），同步完成後自動開始')
  assert.strictEqual(noPct.buttonText, '停止挖礦')
  assert.ok(!noPct.statusText.includes('96'))
}

// Three states, and the status always matches the button.
{
  const idle = mine.formatMineHome({ miners: {}, phase: 'stopped' }, CN)
  assert.strictEqual(idle.statusText, '挖礦狀態：已停止')
  assert.strictEqual(idle.statusTone, 'off')
  assert.strictEqual(idle.buttonText, '開始挖礦')
  assert.strictEqual(idle.buttonKind, 'start')
  const paused = mine.formatMineHome({
    miners: {
      classicGpu: {
        running: true, mode: 'gpu', chain: 'classic', shard: 1, code: 'CLASSIC_PAUSED', phase: 'syncing', paused: true,
        procs: ['classic-node'], localBlock: 45, networkBlock: 100
      }
    }
  }, CN)
  assert.strictEqual(paused.statusText, '挖礦狀態：等待同步（Shard1 Classic 同步進度 45%），同步完成後自動開始')
  assert.strictEqual(paused.statusTone, 'wait')
  assert.strictEqual(paused.buttonText, '停止挖礦')
  assert.strictEqual(paused.buttonKind, 'stop')
  assert.deepStrictEqual(paused.chains, [])
  assert.strictEqual(paused.todayText, '今天挖到 —')
  assert.strictEqual(paused.lastText, '最近一次收益：—')
  const pausedEn = mine.formatMineHome({
    miners: {
      classicGpu: {
        running: true, mode: 'gpu', chain: 'classic', shard: 1, code: 'CLASSIC_PAUSED', procs: ['classic-node'],
        localBlock: 45, networkBlock: 100
      }
    }
  }, EN)
  assert.strictEqual(pausedEn.statusText, 'Mining status: waiting for sync (Shard1 Classic sync progress 45%). It starts on its own when sync finishes.')
  assert.strictEqual(pausedEn.buttonText, 'Stop mining')
  assert.ok(!/[\u4e00-\u9fff]/.test(pausedEn.statusText + pausedEn.buttonText))
  const live = mine.formatMineHome({
    miners: { classicGpu: { running: true, mode: 'gpu', chain: 'classic', shard: 1, code: 'CLASSIC_GPU', hashrate: 80, procs: ['classic-node'] } },
    phase: 'mining'
  }, CN)
  assert.strictEqual(live.statusText, '挖礦狀態：正在挖礦')
  assert.strictEqual(live.buttonText, '停止挖礦')
  assert.strictEqual(live.buttonKind, 'stop')
  for (const row of [idle, paused, live]) {
    if (row.buttonText === '開始挖礦') assert.strictEqual(row.statusText, '挖礦狀態：已停止')
    if (row.statusText === '挖礦狀態：已停止') assert.strictEqual(row.buttonText, '開始挖礦')
    if (row.buttonText === '停止挖礦') assert.ok(row.statusText === '挖礦狀態：正在挖礦' || row.statusText.startsWith('挖礦狀態：等待同步'))
  }
  const addr = CLASSIC.toLowerCase()
  const now = new Date(2026, 9, 9, 12, 0, 0).getTime()
  const one = {}
  one[addr] = [{ t: now - 60000, dir: 'reward', status: 'done', asset: 'SCDO', amount: '2', from: '0S' + '0'.repeat(40), to: addr }]
  const certain = mine.confirmedEarnLog(one, now)
  assert.strictEqual(mine.earnOf(certain, now).todayScdo, 2)
  assert.strictEqual(mine.formatMineHome({ miners: {}, earnLog: certain, now }, CN).todayText, '今天挖到 2 SCDO')
  const full = []
  for (let i = 0; i < mine.TX_PAGE; i++) full.push({ t: now - i * 1000, dir: 'in', status: 'done', asset: 'SCDO', amount: '1' })
  const packed = {}
  packed[addr] = full
  assert.strictEqual(mine.confirmedEarnLog(packed, now), null)
  const missing = {}
  missing[addr] = null
  assert.strictEqual(mine.confirmedEarnLog(missing, now), null)
  const unpriced = {}
  unpriced[addr] = [{ t: now, dir: 'reward', status: 'done', asset: 'SCDO', amount: '' }]
  assert.strictEqual(mine.confirmedEarnLog(unpriced, now), null)
}

// The card is on Home, above the five chain cards, and the page function does not grow a second button.
const dash = read('src/js/dashboard.js')
const homeFn = dash.slice(dash.indexOf('function homeHtml'), dash.indexOf('const api'))
assert.ok(homeFn.indexOf('homeMineHost') < homeFn.indexOf('id="chainCards"'))
assert.ok(homeFn.indexOf('id="earnCard"') < homeFn.indexOf('id="chainCards"'))
const ui = read('src/js/app112.js')
const page = ui.slice(ui.indexOf('function pageHome'), ui.indexOf('function backHome'))
assert.ok(page.includes('mineHomeStripHtml()'))
const inputFn = ui.slice(ui.indexOf('function mineHomeInput'), ui.indexOf('function mineHomeCardHtml'))
assert.ok(inputFn.includes('confirmedEarnLog(rewardRowsByAddress()'))
assert.ok(!inputFn.includes('noteEarn()'))
assert.ok(!page.includes('id="homeMineBtn"'))
assert.ok(!ui.includes('id="actStart"') && !ui.includes('id="homeGoMine"'))
const rows = ui.slice(ui.indexOf('  const CAT_ROWS = ['), ui.indexOf('  const catPhrase'))
assert.strictEqual((rows.match(/\['mine'/g) || []).length, 0)
const menu = read('src/js/menu.js')
assert.ok(menu.includes("label: L.mining"))
assert.ok(menu.includes("act('mineHome')"))
assert.ok(!menu.includes("act('mine')"))
assert.ok(!ui.includes('id="btnMine"'))
assert.deepStrictEqual(mine.nodeSyncOf({ local: 52, network: 100 }), { synced: false, pct: 52 })
assert.deepStrictEqual(mine.nodeSyncOf({ local: 100, network: 108 }), { synced: true, pct: 93 })
assert.deepStrictEqual(mine.nodeSyncOf({}), { synced: false, pct: null })
assert.strictEqual(mine.chooseMinePath({
  shard: 1, explicitSolo: true, nodeSynced: false, syncPct: 52, poolOnline: true, zh: true
}).label, '本機顯卡挖（本機節點同步 52%）')
assert.strictEqual(mine.chooseMinePath({
  shard: 1, explicitSolo: true, nodeSynced: false, syncPct: 52, poolOnline: true, zh: true
}).action, 'pool')
assert.strictEqual(mine.chooseMinePath({
  shard: 1, explicitSolo: true, nodeSynced: true, syncPct: 100, poolOnline: true, zh: true
}).action, 'solo')
assert.strictEqual(mine.chooseMinePath({
  shard: 1, explicitSolo: false, nodeSynced: true, syncPct: 100, poolOnline: true, zh: true
}).label, '本機顯卡挖')
{
  const blocked = mine.chooseMinePath({ shard: 2, explicitSolo: true, nodeSynced: false, syncPct: 52, poolOnline: false, zh: true })
  assert.strictEqual(blocked.action, 'blocked')
  assert.ok(blocked.reason.includes('Shard2 礦池暫時連不上'))
  assert.ok(blocked.reason.includes('本機節點同步中 52%'))
  const en = mine.chooseMinePath({ shard: 2, explicitSolo: false, nodeSynced: false, syncPct: 52, poolOnline: false, zh: false })
  assert.ok(en.reason.includes('Shard2 pool cannot be reached right now'))
  assert.ok(en.reason.includes('Local node syncing 52%'))
}
{
  const addr = (n) => n + 'S0' + n + 'a'.repeat(37)
  const built = mine.jobsForDevice({
    device: 'gpu',
    chains: [1, 2, 3, 4],
    addresses: { 1: addr(1), 2: addr(2), 3: addr(3), 4: addr(4) },
    caps: { gpu: { available: true } },
    pools: { 1: { online: true }, 2: { online: true }, 3: { online: false }, 4: { online: true } },
    nodes: {
      1: { synced: false, pct: 52 },
      2: { synced: false, pct: 52 },
      3: { synced: false, pct: 52 },
      4: { synced: true, pct: 100 }
    },
    explicitSolo: true,
    zh: true
  })
  assert.strictEqual(built.jobs.length, 1)
  assert.strictEqual(built.jobs[0].shard, 1)
  assert.strictEqual(built.jobs[0].gpuMiner, 'pool')
  assert.strictEqual(built.jobs[0].address, addr(1))
  assert.strictEqual(built.jobs[0].mineLabel, '本機顯卡挖（本機節點同步 52%）')
  const by = {}
  for (const b of built.blocked) by[b.shard] = b
  assert.strictEqual(by[2].reasonKey, 'shellOneClassic')
  assert.ok(by[3].reason.includes('Shard3 礦池暫時連不上'))
  assert.ok(by[3].reason.includes('本機節點同步中 52%'))
  assert.strictEqual(by[4].reasonKey, 'shellOneClassic')
  const later = mine.jobsForDevice({
    device: 'gpu',
    chains: [1, 2],
    addresses: { 1: addr(1), 2: addr(2) },
    caps: { gpu: { available: true } },
    pools: { 1: { online: false }, 2: { online: true } },
    nodes: { 1: { synced: false, pct: 52 }, 2: { synced: false, pct: 10 } },
    explicitSolo: true,
    zh: true
  })
  assert.strictEqual(later.jobs.length, 1)
  assert.strictEqual(later.jobs[0].shard, 2)
  assert.strictEqual(later.jobs[0].gpuMiner, 'pool')
  assert.ok(later.blocked.some(b => b.shard === 1 && b.reason.includes('Shard1 礦池暫時連不上') && b.reason.includes('本機節點同步中 52%')))
  const shown = mine.minePageHtml({
    miners: {},
    chains: { cpu: [], gpu: [1, 2] },
    caps: { gpu: { available: true } },
    addresses: { 1: addr(1), 2: addr(2) },
    mineRows: {
      1: { action: 'pool', label: '本機顯卡挖（本機節點同步 52%）' },
      2: { reason: 'Shard2 礦池暫時連不上；本機節點同步中 52%' }
    }
  }, CN, esc)
  assert.ok(shown.includes('本機顯卡挖（本機節點同步 52%）'))
  assert.ok(shown.includes('Shard2 礦池暫時連不上；本機節點同步中 52%'))
}
assert.ok(!read('src/js/mineHome.js').includes('主鏈'))
assert.ok(!read('src/js/mineHome.js').includes('Shard1 EVM'))
const stopAt = ui.indexOf('async function stopAllNow')
const stopFn = ui.slice(stopAt, ui.indexOf('async function stopAll ()', stopAt))
assert.ok(stopFn.includes('rememberMineChoice()'))
assert.ok(!stopFn.includes("setItem('minerRunClassicGpu'"))
assert.ok(!stopFn.includes("setItem('minerRunClassicCpu'"))
assert.ok(!stopFn.includes('intentClear'))
assert.ok(ui.includes('minerRunShard0'))

console.log('mine-home: ok')
