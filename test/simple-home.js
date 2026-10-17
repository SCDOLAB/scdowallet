// Simple home: big total, today's line, one mining button, one status line, collapsed details.
'use strict'
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const root = path.join(__dirname, '..')
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8')
const mine = require('../src/js/mineHome.js')
const box = { window: {} }
vm.runInNewContext(read('src/js/i18n112.js'), box)
const I = box.window.I18N112
const CJK = /[\u4e00-\u9fff]/
function T (dict) {
  return function (k, p) {
    let s = dict[k]
    if (s == null) s = k
    if (p) s = String(s).replace(/\{(\w+)\}/g, (m, n) => p[n] != null ? p[n] : m)
    return s
  }
}
const CN = T(I.CN)
const EN = T(I.EN)
const KEYS = ['homeTodayLine', 'homeCreateWallet', 'homeDetail', 'homeStatMining', 'homeStatIdle', 'homeStatStarting', 'homeStatStopping', 'homeStatGpuOk', 'homeStatGpuWarm', 'homeStatGpuHot', 'homeStatNoGpu', 'homeStatGpuUnknown']
for (const k of KEYS) {
  assert.ok(I.CN[k] && I.EN[k], k)
  assert.ok(!CJK.test(I.EN[k]), 'EN ' + k)
}
assert.strictEqual(I.CN.homeTodayLine, '今天賺了 {s} SCDO')
assert.strictEqual(I.CN.homeCreateWallet, '建立錢包')
assert.strictEqual(I.CN.homeDetail, '詳細')
assert.strictEqual(I.CN.homeMineStart, '開始挖礦')
assert.strictEqual(I.CN.homeMineStop, '停止挖礦')
assert.strictEqual(I.EN.homeCreateWallet, 'Create a wallet')
assert.strictEqual(I.EN.homeDetail, 'Details')
assert.strictEqual(I.EN.homeMineStart, 'Start mining')
assert.strictEqual(I.EN.homeMineStop, 'Stop mining')

assert.strictEqual(mine.homeStatusLine({ phase: 'mining', temps: [{ tempC: 60 }], hasGpu: true }, CN), '正在挖礦 · 顯卡正常')
assert.strictEqual(mine.homeStatusLine({ phase: 'mining', temps: [{ tempC: 80 }], hasGpu: true }, CN), '正在挖礦 · 顯卡偏熱')
assert.strictEqual(mine.homeStatusLine({ phase: 'mining', temps: [{ tempC: 90 }], hasGpu: true }, CN), '正在挖礦 · 顯卡過熱')
assert.strictEqual(mine.homeStatusLine({ phase: 'stopped', hasGpu: false, temps: [] }, CN), '尚未挖礦 · 沒有使用顯卡')
assert.strictEqual(mine.homeStatusLine({ phase: 'starting', hasGpu: true, temps: [] }, CN), '正在啟動 · 顯卡溫度未知')
assert.strictEqual(mine.homeStatusLine({ phase: 'stopping', temps: [{ tempC: 70 }] }, CN), '正在停止 · 顯卡正常')
assert.strictEqual(mine.homeStatusLine({ phase: 'mining', temps: [{ tempC: 60 }], hasGpu: true }, EN), 'Mining · graphics card normal')
assert.ok(!CJK.test(mine.homeStatusLine({ phase: 'mining', temps: [{ tempC: 90 }], hasGpu: true }, EN)))

const ui = read('src/js/app112.js')
const btn = ui.slice(ui.indexOf('function homeMainButton'), ui.indexOf('function homeDetailBody'))
assert.ok(btn.includes("T('homeCreateWallet')") && btn.includes('data-act="create"') && btn.includes('id="homeCreateWallet"'))
assert.ok(btn.includes("T('homeMineStart')") && btn.includes("T('homeMineStop')") && btn.includes('data-act="homeMine"') && btn.includes('id="homeMineBtn"'))
assert.ok(!btn.includes('data-act="nav"'))
const detail = ui.slice(ui.indexOf('function homeDetailBody'), ui.indexOf('function shardOpenMap'))
assert.ok(detail.includes("T('d_earnTotal')") && detail.includes('tempKeyHtml') && detail.includes('cardHtml') && detail.includes('data-shard='))
assert.ok(!/<details\b[^>]*\sopen/.test(detail))
const apply = ui.slice(ui.indexOf('function applyShardOpen'), ui.indexOf('function pageHome'))
assert.ok(apply.includes('0: true'))
const page = ui.slice(ui.indexOf('function pageHome'), ui.indexOf('function renderFooter'))
assert.ok(page.includes('id="homeTotal"') && page.includes('id="homeToday"') && page.includes('id="homeMainAct"') && page.includes('id="homeMineState"') && page.includes('id="homeDetail"'))
assert.ok(page.indexOf('id="homeTotal"') < page.indexOf('id="homeToday"') && page.indexOf('id="homeMainAct"') < page.indexOf('id="homeDetail"'))
assert.ok(!/<details\b[^>]*\sopen/.test(page))
assert.ok(!page.includes('shell-actions') && !page.includes('homeBuyHtml()'))
assert.ok(read('src/js/dashboard.js').includes('return [0, 1, 2, 3, 4].map'))
assert.ok(ui.includes('heatGuard') && ui.includes("invoke('miner:stop', 'heat')"))
assert.ok(ui.includes('id="aiCatBtn"') || ui.includes('aiCatRoot'))
assert.strictEqual(JSON.parse(read('package.json')).version, '3.1.5')
