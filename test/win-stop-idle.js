// Windows: stop when no miner child is alive must return at once and must not
// call taskkill. A live child whose taskkill never returns still settles within 2s.
'use strict'
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const vm = require('vm')
const { ZpowManager, GpuFleet } = require('../src/miner/zpow/manager')
const launch = require('../src/miner/zpow/launch')
const mine = require('../src/js/mineHome.js')

function hangTaskkill () {
  const calls = []
  const execFile = (cmd, args, opts, cb) => {
    calls.push({ cmd: cmd, args: args.slice() })
  }
  return { execFile: execFile, calls: calls }
}

function deadPid () {
  for (let pid = 1 << 22; pid < (1 << 22) + 80; pid++) {
    try { process.kill(pid, 0) } catch (e) {
      if (e && e.code === 'ESRCH') return pid
    }
  }
  throw new Error('no dead pid')
}

function fakeProc (pid) {
  return {
    pid: pid,
    exitCode: null,
    signalCode: null,
    kill () {},
    once () {}
  }
}

function mgr (execFile) {
  return new ZpowManager({
    platform: 'win32',
    dataRoot: os.tmpdir(),
    root: os.tmpdir(),
    execFile: execFile
  })
}

async function elapsed (fn) {
  const t0 = Date.now()
  await fn()
  return Date.now() - t0
}

async function main () {
  const gone = deadPid()
  assert.strictEqual(launch.pidAlive(gone), false)
  assert.strictEqual(launch.pidAlive(process.pid), true)
  assert.strictEqual(launch.pidAlive(0), false)

  // Wanted, syncing, no child. The Windows retest sat on 「正在停止…」 here.
  const ghostKill = hangTaskkill()
  const ghost = mgr(ghostKill.execFile)
  ghost.wantRunning = true
  ghost.state.phase = 'syncing'
  ghost.state.code = 'CLASSIC_SYNCING'
  ghost.state.mode = 'gpu'
  ghost.state.backend = 'classic-node'
  ghost.proc = null
  ghost.livePid = 4242
  const ghostMs = await elapsed(() => ghost.stop())
  assert.ok(ghostMs < 200, 'no-child stop took ' + ghostMs + 'ms')
  assert.strictEqual(ghostKill.calls.length, 0)
  assert.strictEqual(ghost.wantRunning, false)
  assert.strictEqual(ghost.status().running, false)
  assert.deepStrictEqual(ghost.status().procs, [])
  assert.deepStrictEqual(ghost.childPids(), [])

  // Proc object still set, but the OS process is already gone. Do not taskkill.
  const deadKill = hangTaskkill()
  const dead = mgr(deadKill.execFile)
  dead.wantRunning = true
  dead.state.mode = 'gpu'
  dead.state.backend = 'classic-node'
  dead.state.phase = 'syncing'
  dead.state.code = 'CLASSIC_SYNCING'
  dead.proc = fakeProc(gone)
  dead.livePid = gone
  assert.strictEqual(dead.childAlive(), false)
  assert.deepStrictEqual(dead.status().procs, [])
  const deadMs = await elapsed(() => dead.stop())
  assert.ok(deadMs < 200, 'dead-pid stop took ' + deadMs + 'ms')
  assert.strictEqual(deadKill.calls.length, 0)
  assert.strictEqual(dead.wantRunning, false)
  const how = await launch.stopMiner(fakeProc(gone), { platform: 'win32', execFile: deadKill.execFile })
  assert.strictEqual(how, 'gone')
  assert.strictEqual(deadKill.calls.length, 0)

  // Live pid, taskkill callback never fires. Hard cap still resolves.
  const liveKill = hangTaskkill()
  const live = mgr(liveKill.execFile)
  live.wantRunning = true
  live.state.mode = 'gpu'
  live.state.backend = 'zminer-gpu'
  live.proc = fakeProc(process.pid)
  live.livePid = process.pid
  assert.strictEqual(live.childAlive(), true)
  assert.deepStrictEqual(live.status().procs, ['zminer-gpu'])
  const liveMs = await elapsed(() => live.stop())
  assert.ok(liveMs < 2500, 'live stop took ' + liveMs + 'ms')
  assert.ok(liveMs >= 500, 'live stop returned too soon: ' + liveMs + 'ms')
  assert.strictEqual(liveKill.calls.length, 1)
  assert.strictEqual(liveKill.calls[0].cmd, 'taskkill')
  assert.deepStrictEqual(liveKill.calls[0].args, ['/PID', String(process.pid), '/T', '/F'])
  assert.strictEqual(live.wantRunning, false)
  assert.strictEqual(live.status().running, false)

  // Four Classic shards, each "waiting" with no process. One stop, no taskkill.
  const fleetKill = hangTaskkill()
  const fleet = new GpuFleet({
    platform: 'win32',
    dataRoot: os.tmpdir(),
    root: os.tmpdir(),
    execFile: fleetKill.execFile
  })
  for (const shard of [1, 2, 3, 4]) {
    const kid = new ZpowManager(fleet.o)
    kid.wantRunning = true
    kid.state.phase = 'syncing'
    kid.state.code = 'CLASSIC_SYNCING'
    kid.state.mode = 'gpu'
    kid.state.backend = 'classic-node'
    kid.state.shard = shard
    kid.proc = fakeProc(gone)
    fleet.kids.set(shard, kid)
    assert.strictEqual(fleet.childUp(kid), false)
  }
  const up = new ZpowManager(fleet.o)
  up.proc = fakeProc(process.pid)
  assert.strictEqual(fleet.childUp(up), true)
  const fleetMs = await elapsed(() => fleet.stop())
  assert.ok(fleetMs < 200, 'fleet no-child stop took ' + fleetMs + 'ms')
  assert.strictEqual(fleetKill.calls.length, 0)
  assert.strictEqual(fleet.wantRunning, false)
  assert.strictEqual(fleet.status().running, false)
  assert.deepStrictEqual(fleet.childPids(), [])

  const ghostMiners = {
    classicGpu: {
      running: true, mode: 'gpu', chain: 'classic', phase: 'syncing', code: 'CLASSIC_SYNCING',
      backend: 'classic-node', procs: []
    }
  }
  assert.strictEqual(mine.deviceProcessAlive(ghostMiners, 'gpu'), false)
  const plan = mine.planDeviceClick({ phase: 'waiting', alive: false, chains: [1, 2, 3, 4] })
  assert.strictEqual(plan.op, 'idle-stop')
  assert.strictEqual(plan.next, 'stopped')
  assert.strictEqual(plan.deadlineMs, 0)

  const box = { window: {} }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/js/i18n112.js'), 'utf8'), box)
  const T = (k) => box.window.I18N112.CN[k] || k
  const esc = (s) => String(s == null ? '' : s)
  const page = mine.minePageHtml({ miners: ghostMiners, chains: { cpu: [], gpu: [1, 2, 3, 4] } }, T, esc)
  assert.ok(page.includes('已停止'))
  assert.ok(page.includes('開始記帳'))
  assert.ok(!page.includes('正在停止'))

  const ui = fs.readFileSync(path.join(__dirname, '../src/js/app112.js'), 'utf8')
  const mainSrc = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8')
  const arm = ui.slice(ui.indexOf('function armDeviceDeadline'), ui.indexOf('function releaseDevicePress'))
  assert.ok(arm.includes("cur === 'stopping'"))
  assert.ok(arm.includes('clearMineRunningFlags'))
  assert.ok(arm.includes("invoke('miner:stop'"))
  const before = mainSrc.slice(mainSrc.indexOf("app.on('before-quit'"), mainSrc.indexOf("app.on('will-quit'"))
  assert.ok(before.includes('requestQuit'))
  const quit = mainSrc.slice(mainSrc.indexOf('async function requestQuit'), mainSrc.indexOf('function gracefulQuit'))
  assert.ok(quit.indexOf('afterQuit') >= 0 && quit.indexOf('afterQuit') < quit.indexOf('clearPageRunFlags'))
  assert.ok(mainSrc.includes("localStorage.removeItem('minerRunClassicGpu')"))

  console.log('win-stop-idle: ok')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
