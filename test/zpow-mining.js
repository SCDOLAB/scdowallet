// Classic mining: shard → pool, address checks, status lines, node config, conflicts.
'use strict'
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { parseClassicAddress, parseShard0Address, parseMiningAddress, normalizeMiningInput } = require('../src/miner/zpow/address')
const { poolForShard, minerStatsUrl, defaultCpuThreads, poolsFromEnv, DEFAULT_POOLS } = require('../src/miner/zpow/pools')
const { parseStatusLine, blockRatePerHour, parsePoolMiner } = require('../src/miner/zpow/status')
const { decideStart } = require('../src/miner/zpow/conflict')
const { writeNodeConfig, SHARD_PORTS, PEER_HOSTS } = require('../src/miner/zpow/nodeConfig')
const { renderArgs, ZMINER_ARGS, CLASSIC_NODE_ARGS } = require('../src/miner/zpow/launch')
const { lookupSha, assertSha256, sha256File } = require('../src/miner/zpow/bins')

const REAL = '1S01dfdbe4d921d507032cb83ee04bb7efc4fd9a51'
assert.strictEqual(REAL.length, 42)

// --- addresses ---
assert.deepStrictEqual(parseClassicAddress(REAL), { kind: 'classic', shard: 1, address: REAL })
assert.strictEqual(parseClassicAddress('0x' + 'ab'.repeat(20)), null)
assert.strictEqual(parseShard0Address(REAL), null)
const s0 = '0x' + 'ab'.repeat(20)
assert.strictEqual(parseShard0Address(s0).kind, 'shard0')
assert.strictEqual(parseShard0Address('0x' + '00'.repeat(20)), null)
assert.strictEqual(parseMiningAddress(REAL, 'shard0'), null)
assert.strictEqual(parseMiningAddress(s0, 'classic'), null)

function classic (shard, tail) {
  const prefix = shard + 'S0' + shard
  return prefix + tail
}
const hex37 = 'a'.repeat(37)
for (const shard of [1, 2, 3, 4]) {
  const addr = classic(shard, hex37) + '1'
  const got = parseClassicAddress(addr)
  assert.ok(got, 'shard ' + shard)
  assert.strictEqual(got.shard, shard)
  assert.strictEqual(got.address.slice(0, 4), shard + 'S0' + shard)
}
assert.strictEqual(parseClassicAddress('1S01' + 'b'.repeat(37) + '3'), null)
assert.strictEqual(parseClassicAddress('1S02' + 'b'.repeat(36) + '1'), null)
assert.strictEqual(parseClassicAddress('9S09' + 'b'.repeat(37) + '1'), null)

// full-width digits / letters and ideographic space → half-width NFKC
const full = '１Ｓ０１' + 'ａ'.repeat(37) + '２'
assert.strictEqual(normalizeMiningInput(' \u3000' + full + ' '), '1S01' + 'a'.repeat(37) + '2')
const fw = parseClassicAddress(full)
assert.ok(fw)
assert.strictEqual(fw.shard, 1)
assert.strictEqual(fw.address, '1S01' + 'a'.repeat(37) + '2')

// --- pools ---
for (const shard of [1, 2, 3, 4]) {
  const p = poolForShard(shard)
  assert.strictEqual(p.host, '82.223.19.88')
  assert.strictEqual(p.port, DEFAULT_POOLS[shard].port)
  assert.strictEqual(p.statsPort, DEFAULT_POOLS[shard].statsPort)
  assert.strictEqual(p.stratum, '82.223.19.88:' + p.port)
  assert.strictEqual(minerStatsUrl(p, REAL), 'http://82.223.19.88:' + p.statsPort + '/api/miner/' + encodeURIComponent(REAL))
}
assert.strictEqual(poolForShard(1).port, 3341)
assert.strictEqual(poolForShard(1).statsPort, 8341)
assert.strictEqual(poolForShard(4).port, 3344)
assert.strictEqual(poolForShard(4).statsPort, 8344)
assert.strictEqual(poolForShard(1).live, true)
assert.strictEqual(poolForShard(3).live, false)
const over = poolForShard(2, { 2: { host: '10.0.0.8', port: 14002, statsPort: 18002 } })
assert.strictEqual(over.stratum, '10.0.0.8:14002')
assert.throws(() => poolForShard(0), /shard/)
assert.throws(() => poolForShard(9), /shard/)
assert.deepStrictEqual(poolsFromEnv({}), null)
assert.throws(() => poolsFromEnv({ SCDO_ZPOW_POOLS: '{' }), /JSON/)
assert.strictEqual(defaultCpuThreads(8), 4)
assert.strictEqual(defaultCpuThreads(1), 1)
assert.strictEqual(defaultCpuThreads(0), 1)
assert.strictEqual(defaultCpuThreads(7), 3)

// --- status lines ---
const st = parseStatusLine('{"type":"status","hashrate":12.5,"accepted":3,"rejected":1,"connected":true,"blocks":0}')
assert.strictEqual(st.kind, 'status')
assert.strictEqual(st.hashrate, 12.5)
assert.strictEqual(st.accepted, 3)
assert.strictEqual(st.rejected, 1)
assert.strictEqual(st.connected, true)
assert.strictEqual(st.blocks, 0)
assert.strictEqual(parseStatusLine('2026-10-07 12:00:00 hashrate 10 H/s'), null)
assert.strictEqual(parseStatusLine('not json {'), null)
const gpu = parseStatusLine('GPU miner called number of blocks=100, number of block threads = 256')
assert.deepStrictEqual(gpu, { kind: 'gpu-active', grid: 100, blockThreads: 256 })
assert.deepStrictEqual(parseStatusLine('found a new mined block, height:9262263, hash:0xabc, time:1'), { kind: 'block-found', height: 9262263 })
assert.strictEqual(parseStatusLine('saved mined block successfully').kind, 'block-saved')
assert.strictEqual(parseStatusLine('got download start event, stop miner').kind, 'gpu-paused')
assert.strictEqual(parseStatusLine('Miner started').kind, 'gpu-resumed')
assert.strictEqual(parseStatusLine('login failed: wrong shard').kind, 'login-failed')
assert.strictEqual(blockRatePerHour(2, 0, 3600000), 2)
assert.strictEqual(blockRatePerHour(0, 0, 3600000), 0)
assert.strictEqual(blockRatePerHour(1, null, 10), null)
const poolBody = parsePoolMiner({ address: REAL, hashrate_hs: 40, balance_scdo: '1.5', paid_scdo: '3', shares: 9, blocks: 1 })
assert.strictEqual(poolBody.pending, '1.5')
assert.strictEqual(poolBody.paid, '3')
assert.strictEqual(poolBody.hashrate, 40)

// --- any combination of backends is allowed (no refusal, no confirm dialog) ---
const combos = [
  [{ running: false }, { chain: 'classic', mode: 'cpu' }],
  [{ running: true, chain: 'shard0', mode: 'mine' }, { chain: 'classic', mode: 'gpu' }],
  [{ running: true, chain: 'classic', mode: 'gpu' }, { chain: 'shard0', mode: 'mine' }],
  [{ running: true, chain: 'shard0', mode: 'mine' }, { chain: 'classic', mode: 'cpu' }],
  [{ running: true, chain: 'classic', mode: 'cpu' }, { chain: 'shard0', mode: 'node' }],
  [{ running: true, chain: 'classic', mode: 'cpu' }, { chain: 'classic', mode: 'gpu' }],
  [{ running: true, chain: 'classic', mode: 'gpu' }, { chain: 'classic', mode: 'cpu' }],
  [{ running: true, chain: 'shard0', mode: 'node' }, { chain: 'classic', mode: 'gpu' }],
  [{ running: true, chain: 'shard0', mode: 'mine' }, { chain: 'classic', mode: 'gpu' }]
]
for (const args of combos) {
  const gate = decideStart.apply(null, args)
  assert.strictEqual(gate.ok, true, JSON.stringify(args))
  assert.strictEqual(gate.code, undefined)
  assert.strictEqual(gate.error, undefined)
}
const i18n = fs.readFileSync(path.join(__dirname, '../src/js/i18n112.js'), 'utf8')
assert.ok(i18n.includes('mineTogether:'))
assert.ok(!i18n.includes('gpuClashNote'))
assert.ok(!i18n.includes('st_GPU_CONFLICT'))
assert.ok(!i18n.includes('st_CPU_BUDGET'))
assert.ok(!i18n.includes('不能同時'))
assert.ok(!i18n.includes('cannot run together'))
const ui = fs.readFileSync(path.join(__dirname, '../src/js/app112.js'), 'utf8')
assert.ok(ui.includes("T('mineTogether')"))
assert.ok(!ui.includes('GPU_CONFLICT'))
assert.ok(!ui.includes('CPU_BUDGET'))
assert.ok(!ui.includes('gpuClashNote'))
const mainSrc = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8')
assert.ok(!mainSrc.includes('decideStart'))
assert.ok(!mainSrc.includes('zpowCpu'))
assert.ok(mainSrc.includes('zpowGpu'))
assert.ok(!mainSrc.includes('ZMINER_ARGS'))
assert.ok(i18n.includes('82.223.19.88:3341'))
assert.ok(!i18n.includes('CPU pool'))
assert.ok(!i18n.includes('CPU 礦池'))
assert.ok(!i18n.includes('CPU-only'))
assert.ok(!i18n.includes('CPU only'))
assert.ok(!i18n.includes('classicCpu'))
assert.ok(!i18n.includes('zminer'))
assert.ok(!ui.includes('data-v="cpu"'))
assert.ok(!ui.includes("backend: 'cpu'"))
assert.ok(ui.includes("backend: 'gpu'"))

// --- argv templates (pluggable miner) ---
assert.deepStrictEqual(renderArgs(ZMINER_ARGS, { pool: 'h:1', user: REAL, worker: 'wallet', threads: 3 }),
  ['-pool', 'h:1', '-user', REAL, '-worker', 'wallet', '-threads', '3'])
assert.deepStrictEqual(renderArgs(CLASSIC_NODE_ARGS, { config: 'C:\\w\\node1.json', threads: 1, threadblocks: 100, blockthreads: 100 }).slice(0, 4),
  ['start', '-c', 'C:\\w\\node1.json', '-m'])
assert.throws(() => renderArgs(['{missing}'], {}), /missing/)

// --- node config: fresh key, coinbase, never a key outside the data dir ---
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scdo-node-'))
const decoy = path.join(os.tmpdir(), 'scdo-decoy-' + process.pid + '.key')
const decoyKey = '0x' + '11'.repeat(32)
fs.writeFileSync(decoy, decoyKey)
assert.throws(() => writeNodeConfig({ dir, shard: 1, coinbase: REAL, keyFile: decoy }), /outside/)
const written = writeNodeConfig({ dir, shard: 4, coinbase: '4S04' + 'c'.repeat(37) + '2' })
const cfg = JSON.parse(fs.readFileSync(written.file, 'utf8'))
assert.strictEqual(cfg.basic.coinbase, '4S04' + 'c'.repeat(37) + '2')
assert.strictEqual(cfg.basic.algorithm, 'zpow')
assert.strictEqual(cfg.basic.privateKey, undefined)
assert.notStrictEqual(cfg.p2p.privateKey, decoyKey)
assert.ok(/^0x[0-9a-f]{64}$/.test(cfg.p2p.privateKey))
assert.strictEqual(cfg.p2p.address, '0.0.0.0:' + SHARD_PORTS[4].p2p)
assert.strictEqual(cfg.basic.address, '0.0.0.0:' + SHARD_PORTS[4].rpc)
assert.strictEqual(cfg.httpServer.address, '127.0.0.1:' + SHARD_PORTS[4].http)
assert.ok(path.isAbsolute(cfg.basic.dataDir))
assert.ok(cfg.basic.dataDir.startsWith(dir))
for (const host of PEER_HOSTS) assert.ok(cfg.p2p.staticNodes.includes(host + ':8058'), host)
const again = writeNodeConfig({ dir, shard: 4, coinbase: '4S04' + 'd'.repeat(37) + '1' })
assert.strictEqual(JSON.parse(fs.readFileSync(again.file, 'utf8')).p2p.privateKey, cfg.p2p.privateKey)
assert.strictEqual(JSON.parse(fs.readFileSync(again.file, 'utf8')).basic.coinbase, '4S04' + 'd'.repeat(37) + '1')
fs.rmSync(dir, { recursive: true, force: true })
fs.unlinkSync(decoy)

async function shaChecks () {
  const sumDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scdo-sha-'))
  const bin = path.join(sumDir, 'zminer.exe')
  fs.writeFileSync(bin, 'zminer-bytes')
  const hash = crypto.createHash('sha256').update('zminer-bytes').digest('hex')
  assert.strictEqual(await sha256File(bin), hash)
  assert.strictEqual(lookupSha(hash + '  zminer.exe\n', 'zminer.exe'), hash)
  fs.writeFileSync(path.join(sumDir, 'SHA256SUMS'), hash + '  zminer.exe\n')
  const ok = await assertSha256(bin, { required: true, sumsFile: path.join(sumDir, 'SHA256SUMS') })
  assert.strictEqual(ok.sha256, hash)
  await assert.rejects(assertSha256(bin, { required: true, expected: 'ab'.repeat(32) }), err => err.code === 'SHA256_MISMATCH')
  await assert.rejects(assertSha256(bin, { required: true }), err => err.code === 'SHA256_MISSING')
  const unchecked = await assertSha256(bin, { required: false })
  assert.strictEqual(unchecked.unchecked, true)
  fs.rmSync(sumDir, { recursive: true, force: true })
}

shaChecks().then(() => console.log('zpow-mining: ok')).catch(err => { console.error(err); process.exit(1) })
