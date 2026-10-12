// 3.1.0: GPU selection does not default to Shard0 EVM, and auto-resume off never starts miners.
'use strict'
const assert = require('assert')
const session = require('../src/js/mineSession.js')
const resume = require('../src/main/mineResume.js')
const mine = require('../src/js/mineHome.js')

const classic = '2S02' + 'ab'.repeat(18) + 'cd'

// Existing 3.0.x profile: Classic GPU only, even if the Shard0 "was running" flag was left on.
const migrated = session.migrateSelection({
  minerRunClassicGpu: 'gpu',
  minerRunShard0: '1',
  minerRunClassicCpu: '1',
  minerMode: 'classic-gpu',
  minerClassicGpu: classic
})
assert.deepStrictEqual(migrated.gpu, [2])
assert.ok(migrated.gpu.indexOf(0) < 0)
assert.deepStrictEqual(migrated.cpu, [])

// CPU-only old intent stays on that Classic shard.
assert.deepStrictEqual(session.migrateSelection({
  minerMode: 'classic-cpu',
  minerRunShard0: '1',
  minerClassicCpu: '3S03' + 'aa'.repeat(18) + 'bb'
}).cpu, [3])

// 3.1.3: a new profile with a graphics card ticks Shard0 EVM only (not "select all").
const fresh = session.freshSelection({ gpu: { available: true } }, { gpu: { shard: 1 } })
assert.deepStrictEqual(fresh, { cpu: [], gpu: [0] })
assert.notDeepStrictEqual(fresh.gpu, [0, 1, 2, 3, 4])
const noGpu = session.freshSelection({ gpu: { available: false }, cpu: { available: true } }, {})
assert.deepStrictEqual(noGpu, { cpu: [1], gpu: [] })

// Explicit opt-in still includes Shard0 EVM. The default pick does not.
const opted = mine.defaultChainPick({ classic: 'gpu', shard0: true }, { gpu: { available: true } }, { gpu: { shard: 2 } }, {})
assert.deepStrictEqual(opted.gpu, [0, 2])
const plain = mine.defaultChainPick({}, { gpu: { available: true } }, {}, {})
assert.deepStrictEqual(plain, { cpu: [], gpu: [0] })
const jobs = mine.jobsForDevice({
  device: 'gpu',
  chains: [1],
  addresses: { 1: '1S01' + 'ab'.repeat(18) },
  caps: { gpu: { available: true } },
  nvidia: true,
  preflight: { gpus: [{ status: 'ready' }] },
  reward: '0x' + 'ab'.repeat(20),
  pools: { 1: { online: true } },
  nodes: { 1: { synced: false, pct: 40 } }
})
assert.ok(jobs.jobs.some(j => j.chain === 'classic' && j.gpuMiner === 'zminer-gpu' && j.action === 'pool'))
assert.ok(!jobs.jobs.some(j => j.chain === 'shard0'))

// Launch with auto-resume off never starts, even when every running flag is still on.
assert.deepStrictEqual(session.launchPlan({
  autoResume: false,
  running: { cpu: true, classicGpu: true, shard0: true }
}).start, [])
assert.deepStrictEqual(session.launchPlan({
  autoResume: undefined,
  running: { cpu: true, shard0: true }
}).start, [])
assert.deepStrictEqual(resume.launchTargets({
  autoResume: true,
  keepMining: false,
  runningCpu: true,
  runningShard0: true,
  resume: { cpu: true, classicGpu: false, shard0: true }
}), [])

// Auto-resume on uses the snapshot, not a stuck flag outside that snapshot.
assert.deepStrictEqual(session.launchPlan({
  autoResume: true,
  resume: { cpu: false, classicGpu: true, shard0: false },
  running: { cpu: true, classicGpu: true, shard0: true }
}).start, ['classicGpu'])
assert.deepStrictEqual(resume.launchTargets({
  autoResume: true,
  keepMining: true,
  runningCpu: true,
  runningShard0: true,
  resume: { cpu: false, classicGpu: true, shard0: false }
}), ['classicGpu'])

// Stop and quit clear running flags. Selection is not stored in those flags.
const stopped = resume.afterStop({
  autoResume: true,
  keepMining: true,
  runningCpu: true,
  runningClassicGpu: true,
  runningShard0: true,
  selection: { cpu: [1], gpu: [2] }
}, 'all')
assert.strictEqual(stopped.runningCpu, false)
assert.strictEqual(stopped.runningClassicGpu, false)
assert.strictEqual(stopped.runningShard0, false)
assert.strictEqual(stopped.autoResume, false)
assert.deepStrictEqual(stopped.resume, { cpu: false, classicGpu: false, shard0: false })
assert.deepStrictEqual(stopped.selection, { cpu: [1], gpu: [2] })
assert.deepStrictEqual(resume.launchTargets(stopped), [])

const quitOff = resume.afterQuit({
  autoResume: false,
  keepMining: false,
  runningCpu: true,
  runningClassicGpu: true,
  runningShard0: true
})
assert.strictEqual(quitOff.runningCpu, false)
assert.strictEqual(quitOff.runningClassicGpu, false)
assert.strictEqual(quitOff.runningShard0, false)
assert.deepStrictEqual(quitOff.resume, { cpu: false, classicGpu: false, shard0: false })
assert.deepStrictEqual(resume.launchTargets(quitOff), [])

const quitOn = resume.afterQuit({
  autoResume: true,
  keepMining: true,
  runningCpu: true,
  runningClassicGpu: false,
  runningShard0: true
})
assert.strictEqual(quitOn.runningCpu, false)
assert.strictEqual(quitOn.runningShard0, false)
assert.deepStrictEqual(quitOn.resume, { cpu: true, classicGpu: false, shard0: true })
assert.deepStrictEqual(resume.launchTargets(quitOn), ['cpu', 'shard0'])

const flags = session.clearedFlags({
  minerRunClassicCpu: '1',
  minerRunClassicGpu: 'gpu',
  minerRunShard0: '1',
  minerPickClassicGpu: 'gpu'
})
assert.strictEqual(flags.minerRunClassicCpu, '')
assert.strictEqual(flags.minerRunClassicGpu, '')
assert.strictEqual(flags.minerRunShard0, '')
assert.strictEqual(flags.minerPickClassicGpu, 'gpu')

// A killed session leaves runningClassicGpu set. With no process, startup forgets it and does not resume.
const stale = resume.afterStartup({
  autoResume: true,
  keepMining: true,
  runningClassicGpu: true,
  resume: { cpu: false, classicGpu: true, shard0: false }
}, false)
assert.strictEqual(stale.runningClassicGpu, false)
assert.strictEqual(stale.runningCpu, false)
assert.strictEqual(stale.runningShard0, false)
assert.strictEqual(stale.autoResume, false)
assert.deepStrictEqual(stale.resume, { cpu: false, classicGpu: false, shard0: false })
assert.deepStrictEqual(resume.launchTargets(stale), [])

// A clean quit already cleared running*. Startup keeps the armed resume snapshot.
const clean = resume.afterStartup({
  autoResume: true,
  keepMining: true,
  runningCpu: false,
  runningClassicGpu: false,
  runningShard0: false,
  resume: { cpu: false, classicGpu: true, shard0: false }
}, false)
assert.strictEqual(clean.runningClassicGpu, false)
assert.deepStrictEqual(clean.resume, { cpu: false, classicGpu: true, shard0: false })
assert.deepStrictEqual(resume.launchTargets(clean), ['classicGpu'])

// A live process is left alone, including its running flag.
const live = resume.afterStartup({
  autoResume: true,
  keepMining: true,
  runningClassicGpu: true,
  resume: { cpu: false, classicGpu: true, shard0: false }
}, true)
assert.strictEqual(live.runningClassicGpu, true)
assert.deepStrictEqual(live.resume, { cpu: false, classicGpu: true, shard0: false })

const fs = require('fs')
const path = require('path')
const mainSrc = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8')
const uiSrc = fs.readFileSync(path.join(__dirname, '../src/js/app112.js'), 'utf8')
const stopH = mainSrc.slice(mainSrc.indexOf("ipcMain.handle('miner:stop'"), mainSrc.indexOf("ipcMain.handle('miner:status'"))
const classicStop = stopH.slice(0, stopH.indexOf("{}, 'shard0'"))
assert.ok(classicStop.indexOf('afterStop') >= 0 && classicStop.indexOf('afterStop') < classicStop.indexOf('await stopClassic'))
assert.ok(mainSrc.includes('settleStaleRunFlags()'))
assert.ok(mainSrc.includes('mineResume.afterStartup'))
assert.ok(mainSrc.includes("localStorage.removeItem('minerRunClassicGpu')"))
const stopDev = uiSrc.slice(uiSrc.indexOf('async function stopDevice'), uiSrc.indexOf('async function startDevice'))
assert.ok(stopDev.indexOf('clearMineRunningFlags') < stopDev.indexOf("invoke('miner:stop'"))
const stopAll = uiSrc.slice(uiSrc.indexOf('async function stopAllNow'), uiSrc.indexOf('async function stopAll ()'))
assert.ok(stopAll.indexOf('clearMineRunningFlags') < stopAll.indexOf("invoke('miner:stop'"))
const boot = uiSrc.slice(uiSrc.indexOf('async function boot'), uiSrc.length)
const planArg = boot.slice(boot.indexOf('launchPlan'), boot.indexOf('if (!rc'))
assert.ok(planArg.includes('classicGpu: false'))
assert.ok(!planArg.includes('minerRunClassicGpu'))

console.log('mine-session: ok')
