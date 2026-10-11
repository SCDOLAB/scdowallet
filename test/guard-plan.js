// 3.1.2 miner guard: thread plan, backoff, log rotation, tray colours, and the pause rules.
'use strict'
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const root = path.join(__dirname, '..')
const plan = require('../src/miner/guardPlan')
const guardWin = require('../src/miner/guardWin')

const MB = 1024 * 1024
assert.strictEqual(plan.LOG_LIMIT, 50 * MB)
assert.strictEqual(plan.LOG_KEEP, 3)
assert.deepStrictEqual(plan.BACKOFF_MIN, [1, 2, 5, 10])
assert.strictEqual(plan.backoffMs(0), 60 * 1000)
assert.strictEqual(plan.backoffMs(1), 2 * 60 * 1000)
assert.strictEqual(plan.backoffMs(2), 5 * 60 * 1000)
assert.strictEqual(plan.backoffMs(3), 10 * 60 * 1000)
assert.strictEqual(plan.backoffMs(4), 10 * 60 * 1000)

const groups = []
for (let i = 0; i < 8; i++) groups.push({ efficiencyClass: 0, logical: [16 + i] })
for (let i = 0; i < 8; i++) groups.push({ efficiencyClass: 1, logical: [i * 2, i * 2 + 1] })
const cores = plan.classifyCores(groups)
assert.strictEqual(cores.hybrid, true)
assert.strictEqual(cores.physicalPCores, 8)
assert.strictEqual(cores.pClass, 1)
assert.deepStrictEqual(cores.pLogical, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])
const hybrid = plan.threadPlan({ physicalPCores: 8, logical: 24, hybrid: true, pLogical: cores.pLogical })
assert.strictEqual(hybrid.threads, 7)
assert.deepStrictEqual(hybrid.affinity, cores.pLogical)
assert.strictEqual(hybrid.priority, 'below-normal')

const amd = plan.threadPlan({ physicalPCores: 8, logical: 16, hybrid: false })
assert.strictEqual(amd.threads, 7)
assert.strictEqual(amd.affinity.length, 14)
assert.deepStrictEqual(amd.affinity, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])
assert.strictEqual(amd.priority, 'below-normal')
const tiny = plan.threadPlan({ physicalPCores: 2, logical: 2, hybrid: false })
assert.strictEqual(tiny.threads, 1)
assert.strictEqual(tiny.affinity, null)
assert.strictEqual(plan.threadPlan({ physicalPCores: 1, logical: 1, hybrid: false }).threads, 1)
assert.strictEqual(plan.threadPlan({ physicalPCores: 0, logical: 0 }).threads, 1)
const same = plan.classifyCores([{ efficiencyClass: 0, logical: [0, 1] }, { efficiencyClass: 0, logical: [2, 3] }])
assert.strictEqual(same.hybrid, false)
assert.strictEqual(same.physicalPCores, 2)

assert.strictEqual(plan.shouldRotate(50 * MB - 1), false)
assert.strictEqual(plan.shouldRotate(50 * MB), true)

function memfs (seed) {
  const files = Object.assign({}, seed)
  return {
    files,
    statSync (f) {
      if (!Object.prototype.hasOwnProperty.call(files, f)) { const e = new Error('missing'); e.code = 'ENOENT'; throw e }
      return { size: files[f].size }
    },
    existsSync (f) { return Object.prototype.hasOwnProperty.call(files, f) },
    unlinkSync (f) { delete files[f] },
    renameSync (a, b) {
      if (!Object.prototype.hasOwnProperty.call(files, a)) throw new Error('missing ' + a)
      files[b] = files[a]
      delete files[a]
    }
  }
}
const log = '/tmp/zpow.log'
let fsMem = memfs({ [log]: { size: 50 * MB - 1, body: 'small' } })
assert.strictEqual(plan.rotateFile(log, fsMem), false)
assert.strictEqual(fsMem.files[log].body, 'small')
fsMem.files[log] = { size: 50 * MB, body: 'A' }
assert.strictEqual(plan.rotateFile(log, fsMem), true)
assert.strictEqual(fsMem.files[log + '.1'].body, 'A')
assert.ok(!fsMem.files[log])
fsMem.files[log] = { size: 50 * MB, body: 'B' }
plan.rotateFile(log, fsMem)
fsMem.files[log] = { size: 50 * MB, body: 'C' }
plan.rotateFile(log, fsMem)
fsMem.files[log] = { size: 50 * MB, body: 'D' }
plan.rotateFile(log, fsMem)
assert.strictEqual(fsMem.files[log + '.1'].body, 'D')
assert.strictEqual(fsMem.files[log + '.2'].body, 'C')
assert.strictEqual(fsMem.files[log + '.3'].body, 'B')
assert.ok(!Object.values(fsMem.files).some(f => f.body === 'A'))

assert.deepStrictEqual(plan.trayView({ phase: 'mining', shareAgeMs: 5 * 60 * 1000 }), { colour: 'green', reason: '' })
assert.deepStrictEqual(plan.trayView({ phase: 'running', shareAgeMs: 11 * 60 * 1000 }), { colour: 'yellow', reason: '' })
assert.deepStrictEqual(plan.trayView({ phase: 'mining', shareAgeMs: null }), { colour: 'yellow', reason: '' })
assert.deepStrictEqual(plan.trayView({ phase: 'stopped' }), { colour: 'red', reason: '' })
assert.deepStrictEqual(plan.trayView({ phase: 'restarting' }), { colour: 'red', reason: '' })
for (const reason of ['電池', '全螢幕', '記憶體']) {
  assert.deepStrictEqual(plan.trayView({ phase: 'paused', reason }), { colour: 'grey', reason })
}

function alive (over) {
  return Object.assign({
    platform: 'win32', active: true, userRunning: true,
    inputAgeMs: 100000, cpuPct: 10, fullscreen: false,
    onBattery: false, batteryPct: 90, ramFreePct: 40, commitPct: 40,
    gpuTempC: 40, childAlive: true, shares: 0, hashrate: 1000,
    workingSet: null, handles: null
  }, over || {})
}
function quiet () {
  return plan.freshGuard({ baseThreads: 8, threads: 8, lastMemCheck: 1e15, lastProgressAt: 0 })
}

let st = quiet()
let r = plan.stepGuard(st, alive({ inputAgeMs: 1000, cpuPct: 90 }), 0)
assert.strictEqual(r.state.halved, false)
assert.strictEqual(r.state.threads, 8)
r = plan.stepGuard(r.state, alive({ inputAgeMs: 1000, cpuPct: 90 }), 9999)
assert.strictEqual(r.state.halved, false)
r = plan.stepGuard(r.state, alive({ inputAgeMs: 1000, cpuPct: 90 }), 10000)
assert.strictEqual(r.state.halved, true)
assert.strictEqual(r.state.threads, 4)
assert.strictEqual(r.state.lastAction, '執行緒減半')
assert.ok(r.actions.some(a => a.type === 'set-threads' && a.threads === 4))
r = plan.stepGuard(r.state, alive({ inputAgeMs: 120000, cpuPct: 90 }), 20000)
assert.strictEqual(r.state.halved, false)
assert.strictEqual(r.state.threads, 8)
assert.strictEqual(r.state.lastAction, '恢復執行緒')
r = plan.stepGuard(quiet(), alive({ inputAgeMs: 1000, cpuPct: 85 }), 0)
r = plan.stepGuard(r.state, alive({ inputAgeMs: 1000, cpuPct: 85 }), 20000)
assert.strictEqual(r.state.halved, false)
assert.strictEqual(r.state.threads, 8)

r = plan.stepGuard(quiet(), alive({ fullscreen: true }), 1000)
assert.strictEqual(r.state.paused, true)
assert.strictEqual(r.state.reason, '全螢幕')
assert.strictEqual(r.state.lastAction, '因全螢幕暫停')
assert.ok(r.actions.some(a => a.type === 'pause' && a.reason === '全螢幕'))
assert.ok(!r.actions.some(a => a.type === 'tray-note'))

r = plan.stepGuard(quiet(), alive({ onBattery: true, batteryPct: 80 }), 1000)
assert.strictEqual(r.state.reason, '電池')
assert.strictEqual(r.state.lastAction, '因電池暫停')
const opted = plan.freshGuard({ baseThreads: 8, threads: 8, lastMemCheck: 1e15, mineOnBattery: true })
r = plan.stepGuard(opted, alive({ onBattery: true, batteryPct: 80 }), 1000)
assert.strictEqual(r.state.paused, false)
const off = plan.freshGuard({ enabled: false, baseThreads: 8, threads: 8, lastMemCheck: 1e15, mineOnBattery: true })
r = plan.stepGuard(off, alive({ onBattery: true, batteryPct: 29, fullscreen: true }), 1000)
assert.strictEqual(r.state.reason, '電池')
r = plan.stepGuard(plan.freshGuard({ enabled: false, baseThreads: 8, threads: 8, lastMemCheck: 1e15 }), alive({ fullscreen: true, batteryPct: 90 }), 1000)
assert.strictEqual(r.state.paused, false)

const t0 = 1000000
r = plan.stepGuard(plan.freshGuard({ baseThreads: 8, threads: 8 }), alive({ ramFreePct: 10, commitPct: 20 }), t0)
assert.strictEqual(r.state.memStage, 0)
r = plan.stepGuard(r.state, alive({ ramFreePct: 10 }), t0 + 60000)
assert.strictEqual(r.state.memStage, 1)
assert.strictEqual(r.state.threads, 4)
assert.ok(r.actions.some(a => a.type === 'set-threads' && a.threads === 4))
assert.ok(r.actions.some(a => a.type === 'restart-child' && a.cause === 'memory'))
r = plan.stepGuard(r.state, alive({ ramFreePct: 10 }), t0 + 120000)
assert.strictEqual(r.state.memStage, 2)
assert.ok(r.actions.some(a => a.type === 'restart-child'))
assert.ok(!r.actions.some(a => a.type === 'pause'))
assert.strictEqual(r.state.lastAction, '重新啟動挖礦程式')
r = plan.stepGuard(r.state, alive({ commitPct: 91, ramFreePct: 50 }), t0 + 180000)
assert.strictEqual(r.state.memStage, 3)
assert.strictEqual(r.state.paused, true)
assert.strictEqual(r.state.reason, '記憶體')
assert.ok(r.actions.some(a => a.type === 'pause' && a.reason === '記憶體'))
assert.ok(r.actions.some(a => a.type === 'tray-note' && a.reason === '記憶體'))
let calmed = plan.freshGuard({ baseThreads: 8, threads: 4, lastMemCheck: t0, memStage: 1 })
calmed.memStage = 1
calmed.threads = 4
r = plan.stepGuard(calmed, alive({ ramFreePct: 40, commitPct: 40 }), t0 + 60000)
assert.strictEqual(r.state.memStage, 0)
assert.strictEqual(r.state.threads, 8)
r = plan.stepGuard(plan.freshGuard({ baseThreads: 8, threads: 8, lastMemCheck: t0 }), alive({ ramFreePct: 15, commitPct: 90 }), t0 + 60000)
assert.strictEqual(r.state.memStage, 0)

r = plan.stepGuard(quiet(), alive({ workingSet: 1000, handles: 100, gpuTempC: 40 }), 0)
assert.strictEqual(r.state.baseline.ws, 1000)
r = plan.stepGuard(r.state, alive({ workingSet: 1500, handles: 100 }), 30 * 60 * 1000 - 1)
assert.ok(!r.actions.some(a => a.type === 'restart-child'))
r = plan.stepGuard(r.state, alive({ workingSet: 1500, handles: 100 }), 30 * 60 * 1000)
assert.ok(!r.actions.some(a => a.type === 'restart-child'))
r = plan.stepGuard(r.state, alive({ workingSet: 1501, handles: 100 }), 30 * 60 * 1000)
assert.ok(r.actions.some(a => a.type === 'restart-child' && a.cause === 'leak'))
assert.strictEqual(r.state.baseline, null)
r = plan.stepGuard(quiet(), alive({ workingSet: 1000, handles: 100 }), 0)
r = plan.stepGuard(r.state, alive({ workingSet: 1000, handles: 151 }), 30 * 60 * 1000)
assert.ok(r.actions.some(a => a.type === 'restart-child' && a.cause === 'leak'))

r = plan.stepGuard(quiet(), alive({ hashrate: 0, shares: 0 }), 5000)
assert.ok(!r.actions.some(a => a.type === 'restart-child'))
r = plan.stepGuard(r.state, alive({ hashrate: 0, shares: 0 }), 5000 + 15 * 60 * 1000)
assert.strictEqual(r.state.restartDue, 5000 + 15 * 60 * 1000 + 60 * 1000)
assert.ok(!r.actions.some(a => a.type === 'restart-child'))
r = plan.stepGuard(r.state, alive({ hashrate: 0, shares: 0 }), 5000 + 15 * 60 * 1000 + 60 * 1000)
assert.ok(r.actions.some(a => a.type === 'restart-child' && a.cause === 'backoff'))
assert.strictEqual(r.state.restarts.length, 1)
assert.strictEqual(r.state.restartIndex, 1)

const many = quiet()
many.restarts = [9000, 9000, 9000, 9000, 9000]
r = plan.stepGuard(many, alive({ childAlive: false }), 10000)
assert.strictEqual(r.state.reason, '重新啟動')
assert.strictEqual(r.state.lastAction, '重新啟動太多次，已暫停')
assert.ok(r.actions.some(a => a.type === 'pause'))
assert.ok(r.actions.some(a => a.type === 'tray-note'))
assert.ok(!r.actions.some(a => a.type === 'restart-child'))
assert.strictEqual(r.state.restarts.length, 5)

r = plan.stepGuard(quiet(), alive({ gpuTempC: 85 }), 1000)
assert.strictEqual(r.state.intensity, 'normal')
assert.strictEqual(r.state.batch, 8192)
r = plan.stepGuard(quiet(), alive({ gpuTempC: 86 }), 1000)
assert.strictEqual(r.state.intensity, 'low')
assert.strictEqual(r.state.batch, 4096)
assert.strictEqual(r.state.threads, 4)
assert.strictEqual(r.state.lastAction, '溫度過高，已降低強度')
assert.ok(r.actions.some(a => a.type === 'set-intensity' && a.batch === 4096))
r = plan.stepGuard(quiet(), alive({ gpuTempC: 90 }), 1000)
assert.strictEqual(r.state.paused, false)
assert.strictEqual(r.state.intensity, 'low')
r = plan.stepGuard(quiet(), alive({ gpuTempC: 91 }), 1000)
assert.strictEqual(r.state.reason, '溫度')
assert.strictEqual(r.state.lastAction, '因溫度暫停')
r = plan.stepGuard(quiet(), alive({ gpuTempC: null }), 1000)
assert.strictEqual(r.state.intensity, 'normal')
assert.ok(!r.actions.some(a => a.type === 'pause' || a.type === 'set-intensity'))

const before = quiet()
const snap = JSON.parse(JSON.stringify(before))
r = plan.stepGuard(before, { platform: 'linux', fullscreen: true, batteryPct: 1, onBattery: true }, 5)
assert.deepStrictEqual(r.actions, [])
assert.deepStrictEqual(before, snap)
assert.deepStrictEqual(r.state, snap)
r = plan.stepGuard(quiet(), alive({ childAlive: false }), 1000)
assert.ok(!JSON.stringify(r.actions).includes('reboot'))
assert.ok(r.actions.every(a => a.type !== 'reboot'))

assert.strictEqual(guardWin.supported(), process.platform === 'win32')
guardWin.readSample().then(sample => {
  if (process.platform !== 'win32') {
    assert.strictEqual(sample.skipped, true)
    assert.strictEqual(sample.platform, process.platform)
  }
  for (const rel of ['src/miner/guardPlan.js', 'src/miner/guardWin.js', 'src/miner/pcGuard.js']) {
    const src = fs.readFileSync(path.join(root, rel), 'utf8')
    assert.ok(!/Restart-Computer/i.test(src), rel)
    assert.ok(!/\bshutdown\b/i.test(src), rel)
    assert.ok(!/\breboot\b/i.test(src), rel)
  }
  const ui = fs.readFileSync(path.join(root, 'src/js/app112.js'), 'utf8')
  const set = ui.slice(ui.indexOf('async function settingsModal'), ui.indexOf('async function fillAboutHash'))
  const resumeAt = set.indexOf('id="setResume"')
  const guardAt = set.indexOf('id="setGuard"')
  const advAt = set.indexOf("shellFold('setAdvanced'")
  assert.ok(resumeAt >= 0 && resumeAt < guardAt && guardAt < advAt)
  assert.ok(set.includes('data-act="guardSmooth"') && set.includes('data-act="mineOnBattery"'))
  const tray = fs.readFileSync(path.join(root, 'src/main/trayStatus.js'), 'utf8')
  assert.ok(tray.includes('alwaysOnTop: false'))
  assert.ok(tray.includes('openPanel'))
  assert.ok(!tray.includes('算力'))
  const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8')
  assert.ok(preload.includes("'mining:setGuard'"))
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8')
  assert.ok(main.includes('guardSmooth !== false'))
  assert.ok(main.includes('guardOwnsRestart'))
  const box = { window: {} }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'src/js/i18n112.js'), 'utf8'), box)
  const CN = box.window.I18N112.CN
  const EN = box.window.I18N112.EN
  assert.strictEqual(CN.guardSmooth, '保護電腦流暢（建議開啟）')
  assert.strictEqual(CN.guardSmoothHint, '溫馨提醒：挖礦時我們會讓出部分 CPU，讓電腦保持順暢。')
  assert.strictEqual(EN.guardSmooth, 'Keep the computer responsive (recommended)')
  assert.ok(!/CPU/.test(EN.guardSmoothHint))
  assert.strictEqual(CN.relNotes[0].v, '3.1.2')
  assert.strictEqual(EN.relNotes[0].v, '3.1.2')
  assert.ok(!/[\u4e00-\u9fff]/.test(EN.relNotes[0].items.join(' ')))
  assert.ok(!/收益|價格|年化|報酬|yield|return|price|幣安|binance|okx/i.test(EN.relNotes[0].items[0]))
  assert.strictEqual(require(path.join(root, 'package.json')).version, '3.1.2')
  console.log('guard-plan: ok')
}).catch(err => {
  console.error(err)
  process.exit(1)
})
