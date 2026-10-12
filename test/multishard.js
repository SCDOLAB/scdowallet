// 3.1.5: one CPU switch mines Shard1–4 Classic at once. Each shard gets its own
// zminer child (pool .88:3341–3344) and its own shard account; a restart touches
// only the shard being started; the guard's thread total is re-split across shards.
'use strict'
const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { CpuFleet } = require('../src/miner/zpow/manager')
const session = require('../src/js/mineSession.js')
const { sleeper: winSleeper } = require('./win-miner-stubs')

function classic (shard, tail) { return shard + 'S0' + shard + tail }
const ADDR = (n) => classic(n, 'ab'.repeat(18) + 'c1')

function writeStub (dir) {
  const exe = path.join(dir, process.platform === 'win32' ? 'zminer.exe' : 'zminer')
  if (process.platform === 'win32') fs.writeFileSync(exe, winSleeper)
  else {
    fs.writeFileSync(exe, '#!/bin/sh\nexec sleep 60\n')
    fs.chmodSync(exe, 0o755)
  }
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(exe)).digest('hex')
  return { exe, sha256 }
}

async function main () {
  const root = path.join(__dirname, '..')

  // Default selection: CPU mining is all four Classic shards, on new and migrated profiles.
  assert.deepStrictEqual(session.freshSelection({ gpu: { available: false }, cpu: { available: true } }, {}).cpu, [1, 2, 3, 4])
  assert.deepStrictEqual(session.migrateSelection({ minerMode: 'classic-cpu', minerClassicCpu: ADDR(2) }).cpu, [1, 2, 3, 4])

  // A non-Classic address is rejected before any child spawns.
  const badDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scdo-ms-badexe-'))
  const badData = fs.mkdtempSync(path.join(os.tmpdir(), 'scdo-ms-baddata-'))
  const badStub = writeStub(badDir)
  const badFleet = new CpuFleet({
    platform: process.platform, root, dataRoot: badData,
    env: { SCDO_ZMINER_EXE: badStub.exe, SCDO_ZMINER_SHA256: badStub.sha256 }
  })
  await assert.rejects(async () => badFleet.start('0x' + 'ab'.repeat(20), { backend: 'cpu' }), err => err.code === 'BAD_ADDRESS')
  assert.strictEqual(badFleet.childPids().length, 0)
  await badFleet.stop()

  const exeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scdo-ms-exe-'))
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scdo-ms-data-'))
  const stub = writeStub(exeDir)
  const fleet = new CpuFleet({
    platform: process.platform, root, dataRoot,
    env: { SCDO_ZMINER_EXE: stub.exe, SCDO_ZMINER_SHA256: stub.sha256 }
  })

  // Four starts in parallel: one child per shard, each pointed at its own pool port and account.
  await Promise.all([1, 2, 3, 4].map(n => fleet.start(ADDR(n), { backend: 'cpu', shard: n, threads: 2 })))
  assert.strictEqual(fleet.wantRunning, true)
  assert.strictEqual(fleet.childPids().length, 4)
  for (const n of [1, 2, 3, 4]) {
    const kid = fleet.kids.get(n)
    assert.ok(kid && fleet.childUp(kid), 'shard ' + n + ' up')
    assert.strictEqual(kid.o.logTag, 'zpow s' + n)
    assert.ok(kid.launchSpec.args.includes('82.223.19.88:334' + n), 'shard ' + n + ' pool')
    assert.ok(kid.launchSpec.args.includes(ADDR(n)), 'shard ' + n + ' account')
    const ti = kid.launchSpec.args.indexOf('-threads')
    assert.ok(ti >= 0 && kid.launchSpec.args[ti + 1] === '2', 'shard ' + n + ' threads')
  }

  // Aggregate views: one cpu entry for the guard and the renderer.
  assert.strictEqual(fleet.launchThreads, 8)
  const agg = fleet.status()
  assert.strictEqual(agg.chain, 'classic')
  assert.strictEqual(agg.mode, 'cpu')
  assert.strictEqual(agg.backend, 'zminer')
  assert.strictEqual(agg.running, true)
  assert.strictEqual(agg.shards.length, 4)
  assert.strictEqual(agg.threads, 8)
  assert.deepStrictEqual(agg.shards.map(s => s.shard).sort(), [1, 2, 3, 4])
  const obs = fleet.liveObservation()
  assert.strictEqual(obs.running, true)

  // Restarting one shard leaves the other three processes untouched.
  const victim = fleet.kids.get(2)
  const victimPid = victim.proc.pid
  const otherPids = [1, 3, 4].map(n => fleet.kids.get(n).proc.pid)
  victim.proc.kill('SIGKILL')
  await new Promise(resolve => victim.proc.once('exit', resolve))
  await fleet.start(ADDR(2), { backend: 'cpu', shard: 2, threads: 2 })
  for (let i = 0; i < 20 && fleet.childPids().length < 4; i++) await new Promise(resolve => setTimeout(resolve, 100))
  assert.strictEqual(fleet.childPids().length, 4)
  const kid2 = fleet.kids.get(2)
  for (let i = 0; i < 20 && !(kid2.proc && kid2.proc.pid); i++) await new Promise(resolve => setTimeout(resolve, 100))
  for (let i = 0; i < 3; i++) assert.strictEqual(fleet.kids.get([1, 3, 4][i]).proc.pid, otherPids[i], 'shard ' + [1, 3, 4][i] + ' untouched')
  assert.ok(kid2.proc && kid2.proc.pid !== victimPid, 'shard 2 respawned')

  // The guard re-splits a thread total across the running shards: 6 -> 2/2/1/1.
  assert.strictEqual(fleet.setArg('-threads', 6), true)
  await new Promise(resolve => setTimeout(resolve, 200))
  assert.deepStrictEqual([1, 2, 3, 4].map(n => {
    const args = fleet.kids.get(n).launchSpec.args
    return Number(args[args.indexOf('-threads') + 1])
  }), [2, 2, 1, 1])

  // Stop brings every child down and the fleet reports IDLE.
  await fleet.stop()
  assert.strictEqual(fleet.wantRunning, false)
  assert.strictEqual(fleet.childPids().length, 0)
  const idle = fleet.status()
  assert.strictEqual(idle.running, false)
  assert.strictEqual(idle.code, 'IDLE')

  fs.rmSync(exeDir, { recursive: true, force: true })
  fs.rmSync(dataRoot, { recursive: true, force: true })
  fs.rmSync(badDir, { recursive: true, force: true })
  fs.rmSync(badData, { recursive: true, force: true })
  console.log('multishard: ok')
}

main().catch(e => { console.error(e); process.exit(1) })
