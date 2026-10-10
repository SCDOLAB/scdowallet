// 3.0.11: auto-resume off never starts miners, and stop/quit clear running flags.
'use strict'
const assert = require('assert')
const session = require('../src/js/mineSession.js')
const resume = require('../src/main/mineResume.js')

assert.deepStrictEqual(session.launchPlan({
  autoResume: false,
  running: { cpu: true, classicGpu: true, shard0: true }
}).start, [])
assert.deepStrictEqual(session.launchPlan({
  autoResume: undefined,
  running: { classicGpu: true, shard0: true }
}).start, [])
assert.deepStrictEqual(resume.launchTargets({
  autoResume: true,
  keepMining: false,
  runningClassicGpu: true,
  resume: { cpu: false, classicGpu: true, shard0: false }
}), [])

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
  resume: { cpu: true, classicGpu: false, shard0: false }
}), ['cpu'])

const stopped = resume.afterStop({
  autoResume: true,
  keepMining: true,
  runningCpu: true,
  runningClassicGpu: true,
  runningShard0: true,
  selection: { classic: 'gpu' }
}, 'all')
assert.strictEqual(stopped.runningCpu, false)
assert.strictEqual(stopped.runningClassicGpu, false)
assert.strictEqual(stopped.runningShard0, false)
assert.strictEqual(stopped.autoResume, false)
assert.deepStrictEqual(stopped.resume, { cpu: false, classicGpu: false, shard0: false })
assert.strictEqual(stopped.selection.classic, 'gpu')
assert.deepStrictEqual(resume.launchTargets(stopped), [])

const quitOff = resume.afterQuit({
  autoResume: false,
  keepMining: false,
  runningClassicGpu: true,
  runningShard0: true
})
assert.strictEqual(quitOff.runningClassicGpu, false)
assert.strictEqual(quitOff.runningShard0, false)
assert.deepStrictEqual(quitOff.resume, { cpu: false, classicGpu: false, shard0: false })
assert.deepStrictEqual(resume.launchTargets(quitOff), [])

const quitOn = resume.afterQuit({
  autoResume: true,
  keepMining: true,
  runningCpu: false,
  runningClassicGpu: true,
  runningShard0: false
})
assert.strictEqual(quitOn.runningClassicGpu, false)
assert.deepStrictEqual(quitOn.resume, { cpu: false, classicGpu: true, shard0: false })
assert.deepStrictEqual(resume.launchTargets(quitOn), ['classicGpu'])

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
