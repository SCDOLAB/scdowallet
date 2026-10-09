// 3.0.9: Home mining card wording, and the start/stop click state machine.
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
    shard0: { running: true, mode: 'mine', chain: 'shard0', code: 'MINING', hashrate: 1200.4 },
    classicCpu: { running: true, mode: 'cpu', chain: 'classic', code: 'CLASSIC_MINING', shard: 3, hashrate: 40 },
    classicGpu: { running: true, mode: 'gpu', chain: 'classic', code: 'CLASSIC_GPU', shard: 1, hashrate: 80 }
  }
  const log = { items: [{ t: earlier, shard: 1, height: 10 }, { t: t0, shard: 0, height: 20 }, { t: t0, shard: 1, height: 21 }] }
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
  const same = island.summarizeEarnings(log, now, 2)
  assert.strictEqual(mine.earnOf(log, now).todayScdo, same.todayScdo)
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

// A known empty earnings log is 0 SCDO, not a dash. No log at all is a dash.
{
  const miners = { classicCpu: { running: true, mode: 'cpu', chain: 'classic', shard: 2, hashrate: 0 } }
  const known = mine.formatMineHome({ miners, temps: [{ tempC: 90 }], earnLog: { items: [] }, now: Date.now(), phase: 'mining' }, CN)
  assert.strictEqual(known.todayText, '今天挖到 0 SCDO')
  assert.strictEqual(known.lastText, '最近一次收益：—')
  assert.strictEqual(known.speedText, '挖礦速度 —')
  assert.strictEqual(known.tempText, '顯卡溫度 —', 'processor mining does not invent a graphics-card temperature')
  assert.strictEqual(known.chainsText, '正在挖的鏈：Shard2 Classic')
  assert.ok(!known.chainsText.includes('EVM'))
}

// Shard0 in node mode, and a classic miner parked on the 0x chain, are not "mining those chains".
{
  const miners = {
    shard0: { running: true, mode: 'node', chain: 'shard0', hashrate: 999 },
    classicGpu: { running: true, mode: 'gpu', chain: 'classic', shard: 0, hashrate: 10 }
  }
  const m = mine.formatMineHome({ miners, temps: [{ tempC: 55 }], earnLog: null, phase: 'mining' }, CN)
  assert.strictEqual(m.chainsText, '正在挖的鏈：—')
  assert.strictEqual(m.speedText, '挖礦速度 每秒 10 次')
  assert.strictEqual(m.tempText, '顯卡溫度 55°C（正常）')
  assert.ok(!m.chains.join(' ').includes('Shard1 EVM'))
}

// English stays English and uses the same bands.
{
  const miners = { shard0: { running: true, mode: 'mine', chain: 'shard0', hashrate: 10 } }
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
    nvidia: true
  })
  assert.deepStrictEqual(jobs, [
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

// The card is on Home, above the five chain cards, and the page function does not grow a second button.
const dash = read('src/js/dashboard.js')
const homeFn = dash.slice(dash.indexOf('function homeHtml'), dash.indexOf('const api'))
assert.ok(homeFn.indexOf('homeMineHost') < homeFn.indexOf('id="chainCards"'))
assert.ok(homeFn.indexOf('id="earnCard"') < homeFn.indexOf('id="chainCards"'))
const ui = read('src/js/app112.js')
const page = ui.slice(ui.indexOf('function pageHome'), ui.indexOf('function backHome'))
assert.ok(page.includes('mineHomeCardHtml()'))
assert.ok(!page.includes('id="homeMineBtn"'))
assert.ok(!ui.includes('id="actStart"') && !ui.includes('id="homeGoMine"'))
const rows = ui.slice(ui.indexOf('  const CAT_ROWS = ['), ui.indexOf('  const catPhrase'))
assert.strictEqual((rows.match(/\['mine'/g) || []).length, 1)
const menu = read('src/js/menu.js')
assert.ok(menu.includes("label: L.mining"))
assert.ok(menu.includes("act('mineHome')"))
assert.ok(menu.includes("act('mine')"))
assert.ok(!read('src/js/mineHome.js').includes('主鏈'))
assert.ok(!read('src/js/mineHome.js').includes('Shard1 EVM'))

console.log('mine-home: ok')
