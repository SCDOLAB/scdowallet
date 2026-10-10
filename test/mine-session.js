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

// A new profile is Classic only. Shard0 EVM is not selected, and it is not "select all".
const fresh = session.freshSelection({ gpu: { available: true } }, { gpu: { shard: 1 } })
assert.deepStrictEqual(fresh, { cpu: [], gpu: [1] })
assert.ok(fresh.gpu.indexOf(0) < 0)
assert.notDeepStrictEqual(fresh.gpu, [0, 1, 2, 3, 4])
const noGpu = session.freshSelection({ gpu: { available: false }, cpu: { available: true } }, {})
assert.deepStrictEqual(noGpu, { cpu: [1], gpu: [] })

// Explicit opt-in still includes Shard0 EVM. The default pick does not.
const opted = mine.defaultChainPick({ classic: 'gpu', shard0: true }, { gpu: { available: true } }, { gpu: { shard: 2 } }, {})
assert.deepStrictEqual(opted.gpu, [0, 2])
const plain = mine.defaultChainPick({}, { gpu: { available: true } }, {}, {})
assert.deepStrictEqual(plain, { cpu: [], gpu: [1] })
const jobs = mine.jobsForDevice({
  device: 'gpu',
  chains: plain.gpu,
  addresses: { 1: '1S01' + 'ab'.repeat(18) },
  caps: { gpu: { available: true } },
  nvidia: true,
  preflight: { gpus: [{ status: 'ready' }] },
  reward: '0x' + 'ab'.repeat(20),
  pools: { 1: { online: true } },
  nodes: { 1: { synced: false, pct: 40 } }
})
assert.ok(jobs.jobs.some(j => j.chain === 'classic' && j.gpuMiner === 'classic-node' && j.action === 'sync'))
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

console.log('mine-session: ok')
