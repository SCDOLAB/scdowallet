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
const { writeNodeConfig, planClassicDataDir, nodeProcessEnv, SHARD_PORTS, PEER_HOSTS } = require('../src/miner/zpow/nodeConfig')
const { renderArgs, ZMINER_ARGS, CLASSIC_NODE_ARGS } = require('../src/miner/zpow/launch')
const { lookupSha, assertSha256, sha256File, findCudart } = require('../src/miner/zpow/bins')
const { expectedHash, rejectMismatch, stageZminer, findArtifactExe } = require('../scripts/stage-zminer')
const { ZpowManager, formatExitMessage } = require('../src/miner/zpow/manager')

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
assert.ok(mainSrc.includes('zpowCpu') && mainSrc.includes('zpowGpu'))
assert.ok(mainSrc.includes("opts.backend === 'gpu' ? 'gpu' : 'cpu'"))
assert.ok(!mainSrc.includes('started as the GPU node'))
assert.ok(i18n.includes('82.223.19.88:3341'))
assert.ok(i18n.includes('3342–3344'))
assert.ok(i18n.includes('CPU pool'))
assert.ok(i18n.includes('CPU 礦池'))
assert.ok(i18n.includes('classicCpu'))
assert.ok(!i18n.includes('CPU-only'))
assert.ok(!i18n.includes('CPU only'))
assert.ok(ui.includes('data-v="${id}"'))
assert.ok(ui.includes("['cpu', T('classicCpu'), false]"))
assert.ok(ui.includes("backend: 'cpu'"))
assert.ok(ui.includes("localStorage.getItem('minerRunClassicCpu') === '1'"))
assert.ok(!ui.includes("minerRunClassicCpu') === '1' && !classicGpu"))
assert.ok(ui.includes('data-act="cardMine"') && ui.includes('data-act="cardRemit"'))
assert.ok(ui.includes("cardFeatureOps(a, 'new')") && ui.includes("cardFeatureOps(a, 'old')"))
assert.ok(ui.includes("T('tabMine')") && ui.includes("T('tabRemit')"))
const openMine = ui.slice(ui.indexOf('function openMineFor'), ui.indexOf('function openRemitFor'))
assert.ok(openMine.includes("setTab('mine')"))
assert.ok(openMine.includes("localStorage.setItem('minerReward', a.evm)"))
assert.ok(openMine.includes("localStorage.setItem('minerClassic', classic.address)"))
assert.ok(!openMine.includes('confirm'))
assert.ok(!openMine.includes('mineBackend'))
assert.ok(ui.includes('function remitAccount'))

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
assert.ok(!path.isAbsolute(cfg.basic.dataDir), 'dataDir must be relative; go-scdo joins it onto ~/.scdo')
assert.ok(!/^[A-Za-z]:/.test(cfg.basic.dataDir))
const joined = path.normalize(path.join(os.homedir(), '.scdo', cfg.basic.dataDir))
assert.strictEqual(joined, path.join(dir, 'data'))
for (const host of PEER_HOSTS) assert.ok(cfg.p2p.staticNodes.includes(host + ':8058'), host)
const again = writeNodeConfig({ dir, shard: 4, coinbase: '4S04' + 'd'.repeat(37) + '1' })
assert.strictEqual(JSON.parse(fs.readFileSync(again.file, 'utf8')).p2p.privateKey, cfg.p2p.privateKey)
assert.strictEqual(JSON.parse(fs.readFileSync(again.file, 'utf8')).basic.coinbase, '4S04' + 'd'.repeat(37) + '1')
fs.rmSync(dir, { recursive: true, force: true })
fs.unlinkSync(decoy)

// Windows: absolute dataDir was prefixed, producing C:\Users\Admin\.scdo\C:\Users\...\data
const winHome = 'C:\\Users\\Admin'
const winTarget = 'C:\\Users\\Admin\\AppData\\Roaming\\ScdoWalletBeta\\miner\\classic\\shard1\\data'
const winPlan = planClassicDataDir(winHome, winTarget, 'win32')
assert.strictEqual(winPlan.envHome, null)
assert.ok(!path.win32.isAbsolute(winPlan.dataDir))
assert.ok(!/^[A-Za-z]:/.test(winPlan.dataDir))
const winJoined = path.win32.normalize(path.win32.join(winHome, '.scdo', winPlan.dataDir))
assert.strictEqual(winJoined, winTarget)
assert.ok(!winJoined.includes('.scdo\\C:'))
const otherDrive = planClassicDataDir(winHome, 'D:\\wallet\\classic\\shard1\\data', 'win32')
assert.strictEqual(otherDrive.dataDir, 'data')
assert.ok(otherDrive.envHome)
const otherJoined = path.win32.normalize(path.win32.join(otherDrive.envHome, '.scdo', otherDrive.dataDir))
assert.strictEqual(otherJoined, otherDrive.resolved)
assert.ok(otherJoined.startsWith('D:\\'))
assert.ok(!otherJoined.includes('.scdo\\D:'))
const winEnv = nodeProcessEnv({ PATH: 'C:\\Windows' }, otherDrive.envHome, 'win32')
assert.strictEqual(winEnv.USERPROFILE, otherDrive.envHome)
assert.strictEqual(winEnv.HOME, otherDrive.envHome)
assert.strictEqual(winEnv.HOMEDRIVE, 'D:')
assert.ok(winEnv.HOMEPATH.startsWith('\\'))
assert.strictEqual(path.win32.normalize(winEnv.HOMEDRIVE + winEnv.HOMEPATH), otherDrive.envHome)
const exitMsg = formatExitMessage(0, [
  '12:00:01 [zpow] open C:\\Users\\Admin\\.scdo\\C:\\Users\\Admin\\AppData\\shard1\\data\\db: The system cannot find the path specified.'
])
assert.notStrictEqual(exitMsg, 'exit 0')
assert.ok(!/^exit /.test(exitMsg))
assert.ok(exitMsg.includes('cannot find the path'))
assert.ok(exitMsg.includes('node exited (0)'))

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

const ZMINER_EXE_SHA256 = 'f00ab73a384251a4b505bb41406975509299403057f60c6d807ff00b249a65fb'
const ZMINER_LINUX_SHA256 = '121bf07195076d9fbf7234196169b6bc15b8dcc1002a462b05b482ddb6f187d8'

async function publishedZminer () {
  const root = path.join(__dirname, '..')
  const sums = fs.readFileSync(path.join(root, 'miner-zpow', 'SHA256SUMS'), 'utf8')
  assert.strictEqual(lookupSha(sums, 'zminer.exe'), ZMINER_EXE_SHA256)
  assert.strictEqual(lookupSha(sums, 'zminer-linux-amd64'), ZMINER_LINUX_SHA256)
  assert.strictEqual(expectedHash(), ZMINER_EXE_SHA256)
  const wrong = path.join(os.tmpdir(), 'zminer-wrong-' + process.pid + '.exe')
  fs.writeFileSync(wrong, 'not-the-miner')
  await assert.rejects(async () => rejectMismatch(wrong, ZMINER_EXE_SHA256), err => err.code === 'SHA256_MISMATCH')
  fs.unlinkSync(wrong)
  const cudaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scdo-cuda-'))
  fs.writeFileSync(path.join(cudaDir, 'node.exe'), 'node')
  fs.writeFileSync(path.join(cudaDir, 'goGpuDet.dll'), 'same-bytes')
  assert.strictEqual(findCudart(path.join(cudaDir, 'node.exe'), 'win32', {}), null)
  fs.writeFileSync(path.join(cudaDir, 'libcudart.dll'), 'cudart')
  assert.ok(String(findCudart(path.join(cudaDir, 'node.exe'), 'win32', {})).endsWith('libcudart.dll'))
  fs.rmSync(cudaDir, { recursive: true, force: true })
  const pkg = require('../package.json')
  assert.strictEqual(pkg.version, '3.0.0')
  assert.strictEqual(pkg.productName, 'SCDO Wallet')
  assert.ok(!/beta/i.test(pkg.version))
  assert.strictEqual(pkg.build.appId, 'io.scdoscan.scdowallet')
  assert.strictEqual(pkg.build.nsis.guid, '57073243-c123-5d9f-8aae-05e2817b09df')
  assert.strictEqual(pkg.build.nsis.perMachine, false)
  assert.strictEqual(pkg.build.win.executableName, 'ScdoWalletBeta')
  assert.ok(!pkg.executableName)
  assert.strictEqual(pkg.build.beforePack, 'scripts/before-pack-win.js')
  assert.ok(pkg.scripts['dist:win'].startsWith('node scripts/stage-zminer.js'))
  const nsh = fs.readFileSync(path.join(root, 'build', 'installer.nsh'), 'utf8')
  assert.ok(nsh.includes('scdoReadPerMachineUninstall'))
  assert.ok(nsh.includes('UNINSTALL_REGISTRY_KEY'))
  assert.ok(nsh.includes('SetRegView 64'))
  assert.ok(nsh.includes('SetRegView 32'))
  assert.ok(nsh.includes('hasPerMachineInstallation'))
  const art = fs.mkdtempSync(path.join(os.tmpdir(), 'scdo-art-'))
  fs.mkdirSync(path.join(art, 'dist'))
  fs.writeFileSync(path.join(art, 'dist', 'zminer.exe'), 'nested')
  assert.ok(String(findArtifactExe(art)).endsWith(path.join('dist', 'zminer.exe')))
  fs.writeFileSync(path.join(art, 'zminer.exe'), 'root')
  assert.strictEqual(findArtifactExe(art), path.join(art, 'zminer.exe'))
  fs.rmSync(art, { recursive: true, force: true })
  const yml = fs.readFileSync(path.join(root, '.github', 'workflows', 'zminer.yml'), 'utf8')
  assert.ok(yml.includes('path: miner-zpow/artifact/*'))
  const upload = yml.slice(yml.indexOf('upload-artifact'))
  assert.ok(!upload.includes('miner-zpow/dist/'))
  const staged = await stageZminer()
  assert.strictEqual(staged.sha256, ZMINER_EXE_SHA256)
  assert.strictEqual(await sha256File(staged.file), ZMINER_EXE_SHA256)
  fs.unlinkSync(staged.file)
  fs.unlinkSync(path.join(path.dirname(staged.file), 'SHA256SUMS'))
  const distExe = path.join(root, 'miner-zpow', 'dist', 'zminer.exe')
  const distLinux = path.join(root, 'miner-zpow', 'dist', 'zminer-linux-amd64')
  if (fs.existsSync(distExe)) assert.strictEqual(await sha256File(distExe), ZMINER_EXE_SHA256)
  if (fs.existsSync(distLinux)) assert.strictEqual(await sha256File(distLinux), ZMINER_LINUX_SHA256)
  const mgr = new ZpowManager({ platform: 'linux', root, dataRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'scdo-zpow-caps-')) })
  const caps = mgr.capabilities({})
  assert.strictEqual(caps.pools[1].stratum, '82.223.19.88:3341')
  assert.strictEqual(caps.pools[1].statsPort, 8341)
  assert.strictEqual(caps.pools[2].port, 3342)
  assert.strictEqual(caps.pools[3].port, 3343)
  assert.strictEqual(caps.pools[4].port, 3344)
  assert.strictEqual(caps.pools[2].live, false)
  if (!fs.existsSync(distLinux)) return
  assert.strictEqual(caps.cpu.available, true)
  assert.ok(String(caps.cpu.path).endsWith('zminer-linux-amd64'))
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scdo-zminer-'))
  const live = new ZpowManager({
    platform: 'linux',
    root,
    dataRoot,
    env: { SCDO_ZPOW_POOLS: JSON.stringify({ 1: { host: '127.0.0.1', port: 9, statsPort: 9 } }) }
  })
  const started = await live.start(REAL, { backend: 'cpu', shard: 1, threads: 1 })
  assert.strictEqual(started.mode, 'cpu')
  assert.strictEqual(started.backend, 'zminer')
  assert.strictEqual(started.pool.stratum, '127.0.0.1:9')
  assert.ok(started.running)
  const gpu = new ZpowManager({ platform: 'linux', root, dataRoot: dataRoot + '-gpu' })
  await assert.rejects(gpu.start(REAL, { backend: 'gpu', shard: 1 }), err => err.code === 'NO_CLASSIC_NODE' || err.code === 'NO_CUDART')
  await live.stop()
  fs.rmSync(dataRoot, { recursive: true, force: true })

  const crashDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scdo-node-crash-'))
  const nodeBin = path.join(crashDir, 'node')
  fs.writeFileSync(nodeBin, '#!/bin/sh\necho "db open failed under .scdo prefix" >&2\nexit 0\n')
  fs.chmodSync(nodeBin, 0o755)
  fs.writeFileSync(path.join(crashDir, 'libcudart.so.12'), '')
  const crashRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scdo-crash-root-'))
  const crashing = new ZpowManager({
    platform: 'linux',
    root,
    dataRoot: crashRoot,
    restartBaseMs: 400,
    env: { SCDO_CLASSIC_NODE: nodeBin }
  })
  await crashing.start(REAL, { backend: 'gpu', shard: 1 })
  const seen = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('node exit message was not reported')), 3000)
    const check = () => {
      const st = crashing.status()
      if (st.message && st.message.includes('db open failed under .scdo prefix')) {
        clearTimeout(timer)
        resolve(st)
      }
    }
    crashing.on('status', check)
    check()
  })
  assert.notStrictEqual(seen.message, 'exit 0')
  assert.ok(seen.message.includes('node exited (0)'))
  assert.ok(seen.message.includes('restarting'))
  assert.strictEqual(seen.running, true)
  const cfgPath = path.join(crashRoot, 'classic', 'shard1', 'node1.json')
  const nodeCfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
  assert.ok(!path.isAbsolute(nodeCfg.basic.dataDir))
  assert.strictEqual(path.normalize(path.join(os.homedir(), '.scdo', nodeCfg.basic.dataDir)), path.join(crashRoot, 'classic', 'shard1', 'data'))
  await crashing.stop()
  await new Promise(r => setTimeout(r, 700))
  assert.strictEqual(crashing.wantRunning, false)
  assert.strictEqual(crashing.restartTimer, null)
  fs.rmSync(crashDir, { recursive: true, force: true })
  fs.rmSync(crashRoot, { recursive: true, force: true })
}

shaChecks().then(publishedZminer).then(() => console.log('zpow-mining: ok')).catch(err => { console.error(err); process.exit(1) })
