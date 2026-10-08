// Classic mining: shard → pool, address checks, status lines, node config, conflicts.
'use strict'
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { parseClassicAddress, parseShard0Address, parseMiningAddress, normalizeMiningInput, ownRewardAddress } = require('../src/miner/zpow/address')
const { poolForShard, minerStatsUrl, defaultCpuThreads, poolsFromEnv, DEFAULT_POOLS } = require('../src/miner/zpow/pools')
const { parseStatusLine, blockRatePerHour, parsePoolMiner, peerTargetOf, mergeSyncView, classicGpuPhase, ETA_WINDOW_MS } = require('../src/miner/zpow/status')
const { decideStart } = require('../src/miner/zpow/conflict')
const { writeNodeConfig, planClassicDataDir, nodeProcessEnv, SHARD_PORTS, PEER_HOSTS } = require('../src/miner/zpow/nodeConfig')
const { renderArgs, ZMINER_ARGS, CLASSIC_NODE_ARGS } = require('../src/miner/zpow/launch')
const { lookupSha, assertSha256, sha256File, findCudart } = require('../src/miner/zpow/bins')
const { expectedHash, rejectMismatch, stageZminer, findArtifactExe, missingMessage, canBuildHere, DEFAULT_ZMINER_URL } = require('../scripts/stage-zminer')
const { ZpowManager, formatExitMessage } = require('../src/miner/zpow/manager')
const { formatMinePill } = require('../src/js/minePill')
const { buildIsland, absorbBlocks, summarizeEarnings, syncOf, BLOCK_REWARD_SCDO } = require('../src/js/statusIsland')
const { parseGpuTemp } = require('../src/main/miningService')

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
// 挖礦 on a locked Shard0 card: only that card's own 0x, never another wallet.
const other = '0x42c4' + 'ab'.repeat(16) + 'c0e4'
assert.strictEqual(other.length, 42)
assert.strictEqual(ownRewardAddress(null), null)
assert.strictEqual(ownRewardAddress({ evm: null, pubkey: REAL }), null)
assert.strictEqual(ownRewardAddress({ evm: '', address: REAL }), null)
assert.notStrictEqual(ownRewardAddress({ evm: null, pubkey: REAL }), other)
assert.strictEqual(ownRewardAddress({ evm: s0, pubkey: REAL }), s0)
assert.strictEqual(ownRewardAddress({ evm: null, pubkey: other }), other)
assert.strictEqual(ownRewardAddress({ evm: null, address: '22'.repeat(20) }), '0x' + '22'.repeat(20))
assert.strictEqual(ownRewardAddress({ evm: '0x' + '00'.repeat(20), pubkey: other }), other)

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
assert.deepStrictEqual(parseStatusLine('got block message and save it. height=9262001, hash:0xabc, time=1'), { kind: 'chain-height', local: 9262001 })
assert.deepStrictEqual(parseStatusLine('got block message and save it. height:9262002, hash:0xabc, time: 1'), { kind: 'chain-height', local: 9262002 })
assert.deepStrictEqual(parseStatusLine('mining block height:9262003, reward:1, transaction number:0, debt number: 0'), { kind: 'chain-height', local: 9262003 })
assert.deepStrictEqual(
  parseStatusLine('Downloader.doSynchronise start task manager from height=100, target height=9263000 master=abc'),
  { kind: 'sync-target', local: 100, network: 9263000 }
)
assert.strictEqual(peerTargetOf({ StartNum: 1000, Amount: 4000, Downloaded: 100, Duration: '50.00' }), 4999)
assert.strictEqual(peerTargetOf({ Status: 'NotSyncing' }), null)
const syncing = mergeSyncView({
  local: 1100,
  peerTarget: 4999,
  publicTip: 5000,
  downloaded: 100,
  amount: 4000,
  durationSec: '50.00',
  samples: []
})
assert.strictEqual(syncing.localBlock, 1100)
assert.strictEqual(syncing.networkBlock, 5000)
assert.strictEqual(syncing.etaSec, 1950)
assert.strictEqual(mergeSyncView({
  local: 3022193,
  publicTip: 9276140,
  downloaded: 3990,
  amount: 4000,
  durationSec: 50,
  samples: []
}).etaSec, null)
assert.strictEqual(mergeSyncView({
  local: 3022193,
  publicTip: 9276140,
  samples: [{ t: 0, h: 3022190 }, { t: 60000, h: 3022192 }, { t: 120000, h: 3022193 }],
  now: 120000
}).etaSec, null)
const sampled = mergeSyncView({
  local: 1000,
  publicTip: 2000,
  downloaded: 100,
  amount: 4000,
  durationSec: 50,
  samples: [{ t: 0, h: 800 }, { t: 30000, h: 900 }, { t: 60000, h: 1000 }],
  now: 60000
})
assert.strictEqual(sampled.networkBlock, 2000)
assert.strictEqual(sampled.etaSec, 300)
assert.strictEqual(ETA_WINDOW_MS, 180000)
// Two samples, even across 60s, stay calculating and must not fall back to duration.
assert.strictEqual(mergeSyncView({
  local: 1000,
  publicTip: 2000,
  downloaded: 100,
  amount: 4000,
  durationSec: 50,
  samples: [{ t: 0, h: 800 }, { t: 60000, h: 1000 }],
  now: 60000
}).etaSec, null)
const rolled = mergeSyncView({
  local: 1100,
  publicTip: 2100,
  samples: [{ t: 0, h: 0 }, { t: 200000, h: 1000 }, { t: 290000, h: 1050 }, { t: 380000, h: 1100 }],
  now: 380000
})
assert.strictEqual(rolled.etaSec, 1800)
assert.strictEqual(mergeSyncView({
  local: 1000,
  publicTip: 5000,
  samples: [{ t: 0, h: 900 }, { t: 10000, h: 1000 }],
  now: 10000
}).etaSec, null)
// Stalled startup, then a steady ~19 blk/s. The flat prefix is not part of the rate.
const stallBase = 1000000
const stallSamples = []
for (let t = 0; t <= 90000; t += 15000) stallSamples.push({ t, h: stallBase })
for (let t = 105000; t <= 165000; t += 15000) {
  stallSamples.push({ t, h: stallBase + 19 * ((t - 90000) / 1000) })
}
const stalled = mergeSyncView({
  local: stallBase + 19 * 75,
  publicTip: stallBase + 6270000,
  samples: stallSamples,
  now: 165000
})
assert.ok(Math.abs(stalled.etaSec - (6268575 / 19)) < 1, 'stalled-start eta ' + stalled.etaSec)
assert.ok(stalled.etaSec > 80 * 3600 && stalled.etaSec < 110 * 3600)
// Still on the flat prefix, or only two progress points: keep calculating.
assert.strictEqual(mergeSyncView({
  local: stallBase,
  publicTip: stallBase + 6270000,
  samples: [{ t: 0, h: stallBase }, { t: 30000, h: stallBase }, { t: 60000, h: stallBase }],
  now: 60000
}).etaSec, null)
assert.strictEqual(mergeSyncView({
  local: stallBase + 1425,
  publicTip: stallBase + 6270000,
  samples: [
    { t: 0, h: stallBase },
    { t: 60000, h: stallBase },
    { t: 90000, h: stallBase + 285 },
    { t: 150000, h: stallBase + 1425 }
  ],
  now: 150000
}).etaSec, null)
// A couple of blocks against a multi-million gap is not a forecast.
assert.strictEqual(mergeSyncView({
  local: stallBase + 2,
  publicTip: stallBase + 6270000,
  samples: [
    { t: 0, h: stallBase },
    { t: 60000, h: stallBase + 1 },
    { t: 120000, h: stallBase + 2 }
  ],
  now: 120000
}).etaSec, null)
assert.strictEqual(mergeSyncView({ local: 2000, publicTip: 2000, samples: [] }).etaSec, 0)
assert.deepStrictEqual(classicGpuPhase({}), { code: 'CLASSIC_STARTING', phase: 'starting' })
assert.deepStrictEqual(classicGpuPhase({ gpuActive: true }), { code: 'CLASSIC_CHECKING', phase: 'starting' })
assert.deepStrictEqual(classicGpuPhase({ gpuActive: true, localBlock: 100, networkBlock: 6270100 }), { code: 'CLASSIC_SYNCING', phase: 'syncing' })
assert.deepStrictEqual(classicGpuPhase({ gpuActive: true, paused: true, localBlock: 100, networkBlock: 6270100 }), { code: 'CLASSIC_PAUSED', phase: 'syncing' })
assert.deepStrictEqual(classicGpuPhase({ gpuActive: true, localBlock: 6270000, networkBlock: 6270003 }), { code: 'CLASSIC_GPU', phase: 'mining' })
assert.strictEqual(classicGpuPhase({ gpuActive: true, localBlock: 100 }).code, 'CLASSIC_SYNCING')
const phaseMgr = new ZpowManager({ platform: 'linux', root: path.join(__dirname, '..'), dataRoot: os.tmpdir() })
phaseMgr.state.mode = 'gpu'
phaseMgr.state.backend = 'classic-node'
phaseMgr.state.code = 'CLASSIC_STARTING'
phaseMgr.applyLine('GPU miner called number of blocks=100, number of block threads = 256')
phaseMgr.state.nodeSeen = true
phaseMgr.refreshClassicGpu()
assert.strictEqual(phaseMgr.state.code, 'CLASSIC_CHECKING')
phaseMgr.state.localBlock = 100
phaseMgr.state.networkBlock = 6270100
phaseMgr.refreshClassicGpu()
assert.strictEqual(phaseMgr.state.code, 'CLASSIC_SYNCING')
assert.strictEqual(phaseMgr.holdEta(137 * 3600, 0), 137 * 3600)
assert.strictEqual(phaseMgr.holdEta(119 * 3600, 10000), 137 * 3600)
assert.strictEqual(phaseMgr.holdEta(168 * 3600, 30000), 168 * 3600)
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
assert.ok(i18n.includes('using the graphics card and the processor in any combination'))
assert.ok(i18n.includes('可以用顯示卡和處理器一起挖，任意組合都可以'))
assert.ok(i18n.includes('classicCpu'))
assert.ok(i18n.includes('正在啟動節點…'))
assert.ok(i18n.includes('正在檢查同步…'))
assert.ok(i18n.includes('st_CLASSIC_STARTING:'))
assert.ok(i18n.includes('st_CLASSIC_CHECKING:'))
assert.ok(i18n.includes('Checking sync…'))
assert.ok(i18n.includes('正在下載帳本。這台電腦 {l}，網路上最新 {n}，大約還要 {eta}。'))
assert.ok(i18n.includes('Downloading the ledger. This computer {l}, newest on the network {n}, about {eta} left.'))
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
assert.ok(openMine.includes('ownRewardAddress'))
assert.ok(openMine.includes("localStorage.setItem('minerReward', own)"))
assert.ok(openMine.includes("localStorage.removeItem('minerReward')"))
assert.ok(openMine.includes('own = a.evm'))
assert.ok(openMine.includes("localStorage.setItem('minerClassic', classic.address)"))
assert.ok(!openMine.includes('confirm'))
assert.ok(!openMine.includes('mineBackend'))
assert.ok(ui.includes('const cur = saved'))
assert.ok(!ui.includes('(running && m.wallet) || saved'))
assert.ok(fs.readFileSync(path.join(__dirname, '../src/miner/zpow/manager.js'), 'utf8').includes('download_getStatus'))
assert.ok(fs.readFileSync(path.join(__dirname, '../src/miner/zpow/manager.js'), 'utf8').includes('syncEtaSec'))
assert.ok(ui.includes('function remitAccount'))
assert.ok(!ui.includes('id="netSel"'))
assert.ok(!ui.includes('data-act="netMenu"'))
assert.ok(!ui.includes('data-act="pickNet"'))
assert.ok(ui.includes("[['old', 'tabOld'], ['new', 'tabNew'], ['mine', 'tabMine']]"))
assert.ok(!ui.includes("['remit', 'tabRemit']"))
assert.ok(!ui.includes("['home', 'tabHome']"))
assert.ok(!ui.includes('id="minePill"'))
assert.ok(ui.includes('id="statusIsland"'))
const hdrFn = ui.slice(ui.indexOf('function renderHeader'), ui.indexOf('function tabNetDot'))
assert.ok(hdrFn.includes("const island = $('statusIsland')"))
assert.ok(hdrFn.includes("const compact = $('islandCompact')"))
assert.ok(hdrFn.includes("!$('acctSwitch')"))
assert.ok(hdrFn.indexOf('SD.html(hdr') > hdrFn.indexOf('const island'))
assert.ok(ui.includes('id="islandCompact"'))
assert.ok(!ui.includes('data-act="island"'))
assert.ok(!ui.includes('id="islandPanel"'))
assert.ok(!ui.includes('id="islandMine"'))
assert.ok(!ui.includes('id="islandStop"'))
assert.ok(ui.includes('id="actStart"'))
assert.ok(ui.includes('id="actGoMine"'))
assert.ok(ui.includes('data-act="stopAll" id="actStop"'))
assert.ok(ui.includes('id="btnRemit"'))
assert.ok(ui.includes('data-act="openPay" id="btnRemit"'))
assert.ok(!ui.includes('id="btnSend"'))
assert.ok(!ui.includes('data-act="sendOld"'))
assert.ok(ui.includes('function cardHomeFold'))
assert.ok(ui.includes('welcomeTitle'))
assert.ok(ui.includes("savedTab === 'home'"))
assert.ok(ui.includes('function headerChain'))
assert.ok(ui.includes("if (st.tab === 'old') return 'old'"))
assert.ok(ui.includes("shardFilter(visible('old'))"))
assert.ok(ui.includes("headerChain() === 'old'"))
assert.ok(ui.includes('data-chain="old"'))
assert.ok(ui.includes('SCDOMinePill.formatMinePill'))
assert.ok(!ui.includes('SCDOMinePill.format('))
assert.ok(ui.includes('data-act="accChip" id="acctSwitch"'))
assert.ok(ui.includes('id="langToggle"'))
assert.ok(ui.includes("id = 'islandMoney'"))
assert.ok(ui.includes('class="brand"'))
assert.ok(!ui.includes('class="bv"'))
assert.ok(!ui.includes('id="langZh"'))
assert.ok(!ui.includes('id="langEn"'))
assert.ok(ui.includes("localStorage.setItem('minerRunClassicCpu', '')"))
assert.ok(ui.includes("localStorage.setItem('minerRunClassicGpu', '')"))
assert.ok(ui.includes('miner:intentClear'))
assert.ok(ui.includes('id="payPayer"'))
assert.ok(ui.includes('paySignAddr'))
assert.ok(ui.includes('id="paySelf"'))
assert.ok(!ui.includes('function pickPayer'))
const css = fs.readFileSync(path.join(__dirname, '../src/css/app112.css'), 'utf8')
assert.ok(css.includes('header.top > .island { flex: 1 1 auto'))
assert.ok(css.includes('flex-wrap: wrap'))
assert.ok(!css.includes('.island-money { display: none'))
assert.ok(css.includes('.isle-pop'))
assert.ok(css.includes('.isle-pop-detail'))
assert.ok(css.includes('.isle-legend'))
assert.ok(css.includes('white-space: normal'))
assert.ok(css.includes('prefers-reduced-motion'))
assert.ok(css.includes('html.isle-paused'))
assert.ok(css.includes('animation-play-state: paused'))
assert.ok(!css.includes('.island:hover .island-panel'))
assert.ok(!css.includes('.island.open .island-panel'))
assert.ok(css.includes('.act-stop { margin-left: auto'))
assert.ok(css.includes('.btn.danl'))
assert.ok(css.includes('@keyframes isle-spin'))
assert.ok(css.includes('@keyframes isle-shimmer'))
assert.ok(ui.includes('data-act="isleStart"') || ui.includes("data-act', 'isleStart'") || ui.includes("data-act', 'isleStart'") || ui.includes('isleStart'))
assert.ok(ui.includes("setAttribute('aria-describedby', 'islePop')"))
assert.ok(ui.includes('innerWidth'))
assert.ok(ui.includes('innerHeight'))
const popFn = ui.slice(ui.indexOf('function queueIslePop'), ui.indexOf('function queueIslePopHide'))
assert.ok(popFn.includes('300'))
assert.ok(ui.includes("addEventListener('mouseenter'"))
assert.ok(ui.includes("addEventListener('focus'"))
assert.ok(ui.includes('id = \'isleHelp\'') || ui.includes('id="isleHelp"') || ui.includes("btn.id = 'isleHelp'"))
assert.ok(ui.includes('function scheduleMinerDom'))
assert.ok(ui.includes('requestAnimationFrame(flushMinerDom)'))
assert.strictEqual(ui.split('renderMinerLive()').length - 1, 1)
const sched = ui.slice(ui.indexOf('function scheduleMinerDom'), ui.indexOf('function flushMinerDom'))
assert.ok(sched.includes('1000'))
assert.ok(sched.includes('requestAnimationFrame'))
const statusFn = ui.slice(ui.indexOf('function onMinerStatus'), ui.indexOf('function onMinerStatus') + 900)
assert.ok(statusFn.includes('scheduleMinerDom()'))
assert.ok(!statusFn.includes('renderMinerLive()'))
const liveFn = ui.slice(ui.indexOf('function renderMinerLive'), ui.indexOf('function scheduleMinerDom'))
assert.ok(liveFn.includes('textContent === s'))
assert.ok(liveFn.includes('scrollHeight'))
const balFn = ui.slice(ui.indexOf('function headerBalanceText'), ui.indexOf('function headerBalanceMark'))
assert.ok(balFn.includes('accLabel('))
assert.ok(!ui.includes('function shortAcc'))
assert.ok(!balFn.includes('slice(0, 8)'))
assert.ok(ui.includes('function headerBalanceName'))
assert.ok(ui.includes('balanceName: headerBalanceName()'))
assert.ok(ui.includes("av.className = 'isle-av'"))
assert.ok(css.includes('.isle-av'))
const avFn = ui.slice(ui.indexOf('function paintAvatar'), ui.indexOf('function applyChipFace'))
assert.ok(avFn.includes('av.title = name'))
assert.ok(avFn.includes("setAttribute('aria-label', name)"))
const actBar = ui.slice(ui.indexOf('function renderActBar'), ui.indexOf('function renderIsland'))
assert.ok(actBar.includes('id="actStart"'))
assert.ok(actBar.includes("T('actMining')"))
assert.ok(actBar.includes("T('actGoMine')"))
assert.ok(actBar.includes('id="btnRemit"'))
assert.ok(actBar.includes('class="btn danl act-stop"'))
assert.ok(!actBar.includes('paintChipRow'))
assert.ok(!actBar.includes('data-tip-'))
assert.ok(!actBar.includes('isle-chip'))
assert.ok(!actBar.includes('顯卡溫度'))
assert.ok(!actBar.includes('帳戶餘額'))
assert.ok(!actBar.includes('同步進度'))
const chipFn = ui.slice(ui.indexOf('function chipEl'), ui.indexOf('function paintAvatar'))
assert.ok(chipFn.includes("createElement('span')"))
assert.ok(chipFn.includes("setAttribute('data-key'"))
assert.ok(!chipFn.includes('button'))
const paint = ui.slice(ui.indexOf('function paintChipRow'), ui.indexOf('function ensureLine'))
assert.ok(paint.includes('data-key'))
assert.ok(paint.includes('appendChild(el)'))
assert.ok(paint.includes('syncChip(el, c)'))
assert.ok(!paint.includes("textContent = ''"))
assert.ok(css.includes('overflow-wrap: anywhere'))
assert.ok(css.includes('#cbNo:focus'))
assert.ok(!ui.includes('（HTTP'))
assert.ok(!ui.includes('poolHttpDetail'))
assert.ok(!i18n.includes('統計用的網頁是 HTTP'))
assert.ok(ui.includes('cpuCoresLine'))
assert.ok(ui.includes('id="mThreadsLab"'))
const stopAsk = ui.slice(ui.indexOf('function confirmStopAll'), ui.indexOf('function confirmBox'))
assert.ok(stopAsk.includes('id="stopAllDlg"'))
assert.ok(stopAsk.includes("T('stopAllTitle')"))
assert.ok(stopAsk.includes("T('cancel')"))
assert.ok(stopAsk.includes("T('stopAllYes')"))
assert.ok(stopAsk.indexOf('id="cbNo"') < stopAsk.indexOf('id="cbYes"'))
assert.ok(stopAsk.includes('no.focus()'))
const stopAllFn = ui.slice(ui.indexOf('async function stopAll'), ui.indexOf('async function minerStop'))
assert.ok(stopAllFn.includes('confirmStopAll()'))
assert.ok(!stopAllFn.includes('miner:confirmStop'))
const oneStop = ui.slice(ui.indexOf('async function minerStop'), ui.indexOf('function onMinerStatus'))
assert.ok(!oneStop.includes('confirm'))
assert.strictEqual((ui.match(/el\.id = 'islePop'/g) || []).length, 1)
const openPop = ui.slice(ui.indexOf('function openIslePop'), ui.indexOf('function closeIslePop'))
assert.ok(openPop.includes('dismissIsleLegend()'))
const clickH = ui.slice(ui.indexOf("document.addEventListener('click'"), ui.indexOf("document.addEventListener('change'"))
assert.strictEqual((clickH.match(/openIslePop\(/g) || []).length, 1)
assert.ok(clickH.includes('if (!inPop) closeIslePop(true)'))
assert.ok(clickH.includes('dismissIsleLegend()'))
const arm = ui.slice(ui.indexOf('function armChip'), ui.indexOf("document.addEventListener('mouseover'"))
assert.ok(arm.includes('stopPropagation()'))
assert.ok(arm.includes('openIslePop(el, true)'))
assert.ok(arm.includes('openIslePop(el, false)'))
const esc = ui.slice(ui.indexOf("if (ev.key === 'Escape')"), ui.indexOf("if (ev.key === 'Enter'"))
assert.ok(esc.includes("$('stopAllDlg')"))
assert.ok(esc.includes("$('cbNo')"))
assert.ok(esc.includes('closeIslePop(true)'))
assert.ok(esc.includes('dismissIsleLegend()'))
assert.ok(!esc.includes("classList.remove('open')"))
assert.ok(!ui.includes("classList.toggle('open')"))
assert.ok(ui.includes("addEventListener('visibilitychange'"))
assert.ok(ui.includes("addEventListener('blur'"))
assert.ok(ui.includes("addEventListener('focus'"))
assert.ok(ui.includes("classList.toggle('isle-paused'"))
const payOn = ui.slice(ui.indexOf('sel.onchange'), ui.indexOf('sel.onchange') + 320)
assert.ok(payOn.includes('sync()'))
assert.ok(payOn.includes('s.feeFor = null'))
assert.ok(!payOn.includes('paint(currentRoute())'))
assert.ok(ui.includes('data-netdot'))
assert.ok(ui.includes("data-act=\"pickShard\""))
assert.ok(i18n.includes('pillShard0: "主鏈"') || i18n.includes("pillShard0: '主鏈'"))
assert.ok(i18n.includes('挖礦速度 每秒 {n} 次'))
assert.ok(i18n.includes('Mining speed {n} tries per second'))
assert.ok(i18n.includes('已連線 {n} 個節點'))
assert.ok(i18n.includes('Connected to {n} nodes'))
assert.ok(!ui.includes("['H/s', 'kH/s', 'MH/s', 'GH/s']"))
assert.ok(ui.includes('function speedText'))
assert.ok(ui.includes('data-tip-explain'))
assert.ok(ui.includes("closest('.explain')"))
assert.ok(ui.includes('也挖主鏈'))
const boot = fs.readFileSync(path.join(__dirname, '../src/js/boot.js'), 'utf8')
assert.ok(boot.includes('挖礦速度 每秒 {n} 次'))
assert.ok(!boot.includes('MH/s'))
const netStats = fs.readFileSync(path.join(__dirname, '../src/js/mining/miningNetworkStats.js'), 'utf8')
assert.ok(!netStats.includes("'H/s'"))
assert.ok(netStats.includes('tries per second'))
const preflightCard = fs.readFileSync(path.join(__dirname, '../src/js/mining/gpuPreflightCard.js'), 'utf8')
assert.ok(preflightCard.includes('Graphics memory '))
assert.ok(preflightCard.includes('This graphics card can be used for mining'))
assert.ok(preflightCard.includes('This graphics card cannot be used for mining'))
assert.ok(!preflightCard.includes("M.L('CUDA: ')"))
assert.ok(fs.readFileSync(path.join(__dirname, '../src/js/mining/types.js'), 'utf8').includes('"This graphics card can be used for mining": "這張顯卡可以用來挖礦"'))
assert.ok(fs.readFileSync(path.join(__dirname, '../src/js/mining/types.js'), 'utf8').includes('。需要 NVIDIA 顯示卡，並安裝最新的 NVIDIA 顯示卡驅動程式，以及 4 GB 顯示記憶體。'))
assert.ok(fs.readFileSync(path.join(__dirname, '../src/js/mining/types.js'), 'utf8').includes('" · source: ": " · 資料來源："'))
assert.ok(preflightCard.includes('Needs an NVIDIA graphics card, the latest NVIDIA graphics driver, and 4 GB of graphics memory.'))
const miningSvc = fs.readFileSync(path.join(__dirname, '../src/main/miningService.js'), 'utf8')
assert.ok(miningSvc.includes("sourceKey: 'scdoscanMainPublic'"))
assert.ok(!/[\u3400-\u9fff]/.test(miningSvc.slice(miningSvc.indexOf('statsCache = {'), miningSvc.indexOf('asOf:', miningSvc.indexOf('statsCache = {')))), 'network stats source must not be fixed Chinese')
assert.ok(fs.readFileSync(path.join(__dirname, '../src/js/mining/types.js'), 'utf8').includes('"scdoscan.io main chain public node": "scdoscan.io 主鏈公開節點"'))
assert.ok(!miningSvc.includes('scdoscan.io RPC'))
const launchSrc = fs.readFileSync(path.join(__dirname, '../src/miner/zpow/launch.js'), 'utf8')
assert.ok(launchSrc.includes('PRIORITY_BELOW_NORMAL'))
assert.ok(launchSrc.includes('os.setPriority'))
assert.ok(launchSrc.includes('relaxMinerPriority(proc)'))
const mgrSrc = fs.readFileSync(path.join(__dirname, '../src/miner/manager.js'), 'utf8')
const spawnBody = mgrSrc.slice(mgrSrc.indexOf('spawnChild (name, cmd, args)'), mgrSrc.indexOf('scheduleRestart (name, code)'))
assert.ok(mgrSrc.includes('PRIORITY_BELOW_NORMAL'))
assert.ok(mgrSrc.includes('os.setPriority'))
assert.ok(spawnBody.includes("if (name === 'rigel') relaxMinerPriority(p)"))
{
  const vm = require('vm')
  const ctx = { window: { SafeDom: { h () { return {} } }, SCDOMining: { lang: 'CN', TW: { 'Mining speed ': '挖礦速度 每秒 ', ' tries per second': ' 次', 'Mining speed is still being worked out': '挖礦速度 還在計算' }, L (en) { const M = ctx.window.SCDOMining; return M.lang === 'CN' && M.TW[en] ? M.TW[en] : en } } } }
  vm.createContext(ctx)
  vm.runInContext(netStats, ctx)
  const fmt = ctx.window.SCDOMining.MiningNetworkStats.fmtHash
  assert.strictEqual(fmt(12.30e6), '挖礦速度 每秒 12,300,000 次')
  ctx.window.SCDOMining.lang = 'EN'
  assert.strictEqual(fmt(85), 'Mining speed 85 tries per second')
  assert.strictEqual(fmt(0), 'Mining speed is still being worked out')
}
assert.ok(i18n.includes('Classic 帳戶分頁在最前面'))
assert.ok(i18n.includes('最上面的狀態列只顯示資料'))
assert.ok(i18n.includes('The top status bar only shows information'))
assert.ok(i18n.includes('isleGoMine: "前往挖礦"') || i18n.includes("isleGoMine: '前往挖礦'"))
assert.ok(i18n.includes('isleStopAll: "全部停止"') || i18n.includes("isleStopAll: '全部停止'"))
assert.ok(i18n.includes('actMining: "挖礦中"'))
assert.ok(i18n.includes('actGoMine: "前往挖礦頁 →"'))
assert.ok(i18n.includes('stopAllTitle: "確定要停止全部挖礦嗎？"'))
assert.ok(i18n.includes('stopAllYes: "確定停止"'))
assert.ok(i18n.includes('低於 75°C 綠色、75°C 到 84°C 橘色、85°C 以上紅色'))
assert.ok(i18n.includes('Below 75°C is green, 75°C to 84°C is orange, and 85°C or above is red'))
assert.ok(i18n.includes('isleEtaName: "{chain} 大約還要多久同步完"'))
assert.ok(i18n.includes('isleTotalName: "一共賺了多少"'))
assert.ok(i18n.includes('isleLegEtaName: "大約還要"'))
assert.ok(i18n.includes('isleLegTotalName: "一共賺了"'))
assert.ok(i18n.includes("tabNew: '主鏈帳戶'"))
assert.ok(i18n.includes("newTitle: '主鏈帳戶'"))
assert.ok(i18n.includes("newAddrLabel: '主鏈收款地址'"))
assert.ok(i18n.includes('用了 {n} 個處理器核心（這台電腦共有 {max} 個）'))
assert.ok(i18n.includes('Using {n} processor cores (this computer has {max})'))
assert.ok(i18n.includes("tabNew: 'Main chain accounts'"))
assert.ok(i18n.includes('actMining: "Mining"'))
assert.ok(i18n.includes('Stop all mining?'))
assert.ok(i18n.includes('isleGoMine: "Open Mining"') || i18n.includes("isleGoMine: 'Open Mining'"))
assert.ok(i18n.includes('等待同步完成後開始挖礦'))
assert.ok(i18n.includes('Waiting to finish syncing before mining'))
assert.ok(i18n.includes('顯卡溫度 {n}°C（{state}）') || i18n.includes('isleTempOne: "顯卡溫度 {n}°C（{state}）"'))
assert.ok(i18n.includes('每秒 {n} 次'))
assert.ok(i18n.includes('{n} tries per second'))
assert.ok(i18n.includes('今天賺了 {s} SCDO'))
assert.ok(i18n.includes('已連線 {n} 個節點'))
assert.ok(i18n.includes('Earned {s} SCDO today'))
const indexHtml = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8')
assert.ok(indexHtml.includes('statusIsland.js'))
assert.ok(indexHtml.indexOf('statusIsland.js') < indexHtml.indexOf('app112.js'))
assert.ok(indexHtml.includes('id="actBar"'))
assert.ok(indexHtml.indexOf('id="hdr"') < indexHtml.indexOf('id="actBar"'))
assert.ok(indexHtml.indexOf('id="actBar"') < indexHtml.indexOf('id="tabs"'))
assert.ok(fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8').includes("'mining:gpuTemp'"))
assert.ok(fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8').includes("ipcMain.handle('mining:gpuTemp'"))
const vm = require('vm')
const i18nBox = { window: {} }
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/js/i18n112.js'), 'utf8'), i18nBox)
function walkI18n (v, fn) {
  if (typeof v === 'string') fn(v)
  else if (Array.isArray(v)) v.forEach(x => walkI18n(x, fn))
  else if (v && typeof v === 'object') Object.values(v).forEach(x => walkI18n(x, fn))
}
for (const langName of ['CN', 'EN']) {
  walkI18n(i18nBox.window.I18N112[langName], s => {
    assert.ok(!s.includes('SCDO Shard0 (EVM)'), langName + ': ' + s.slice(0, 90))
    assert.ok(!s.toLowerCase().includes('cuda'), langName + ': ' + s.slice(0, 90))
    assert.ok(!s.includes('RPC'), langName + ': ' + s.slice(0, 90))
    assert.ok(!s.includes('Shard0'), langName + ' Shard0: ' + s.slice(0, 90))
    assert.ok(!/GPU/i.test(s), langName + ' GPU: ' + s.slice(0, 90))
    assert.ok(!/CPU/.test(s), langName + ' CPU: ' + s.slice(0, 90))
    assert.ok(!s.includes('算力'), langName + ' 算力: ' + s.slice(0, 90))
  })
}
const miningBox = { window: {} }
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/js/mining/types.js'), 'utf8'), miningBox)
for (const [k, v] of Object.entries(miningBox.window.SCDOMining.TW)) {
  for (const s of [k, v]) {
    assert.ok(!s.includes('Shard0'), 'mining Shard0: ' + s.slice(0, 90))
    assert.ok(!/GPU/i.test(s), 'mining GPU: ' + s.slice(0, 90))
    assert.ok(!/CPU/.test(s), 'mining CPU: ' + s.slice(0, 90))
    assert.ok(!s.includes('算力'), 'mining 算力: ' + s.slice(0, 90))
    assert.ok(!s.toLowerCase().includes('cuda'), 'mining cuda: ' + s.slice(0, 90))
    assert.ok(!s.includes('RPC'), 'mining RPC: ' + s.slice(0, 90))
    assert.ok(!s.includes('EVM'), 'mining EVM: ' + s.slice(0, 90))
  }
}
assert.strictEqual(miningBox.window.SCDOMining.TW['Graphics card detection failed'], '顯示卡檢測失敗')
assert.strictEqual(i18nBox.window.I18N112.CN.assetTest, '主鏈代幣')
assert.strictEqual(i18nBox.window.I18N112.EN.assetTest, 'Main chain token')
const noteSrc = fs.readFileSync(path.join(__dirname, '../src/main/miningNotifier.js'), 'utf8')
assert.ok(noteSrc.includes('挖礦速度一直是 0'))
assert.ok(noteSrc.includes('挖礦速度已經 2 分鐘都是 0'))
assert.ok(noteSrc.includes('挖礦速度 2 分鐘都是 0'))
assert.ok(noteSrc.includes('Mining speed is stuck at 0'))
assert.ok(noteSrc.includes('Mining speed at 0 for 2 minutes'))
assert.ok(!noteSrc.includes('算力'))
const traySrc = fs.readFileSync(path.join(__dirname, '../src/main/trayStatus.js'), 'utf8')
assert.ok(traySrc.includes("return '挖礦速度 每秒 ' + num + ' 次'"))
assert.ok(traySrc.includes("return 'Mining speed ' + num + ' tries per second'"))
assert.ok(!traySrc.includes('MH/s') && !traySrc.includes('kH/s') && !traySrc.includes('H/s'))
assert.ok(mainSrc.includes('Classic 處理器礦池'))
assert.ok(mainSrc.includes('Classic processor pool'))
assert.ok(mainSrc.includes('Classic graphics card'))
assert.ok(!mainSrc.includes('Classic CPU 礦池') && !mainSrc.includes("'Classic GPU'"))
assert.strictEqual(miningBox.window.SCDOMining.TW['Graphics memory could not be measured exactly (nvidia-smi unavailable).'], '無法精確測量顯示記憶體（nvidia-smi 無法使用）。')
miningBox.window.SCDOMining.lang = 'CN'
assert.strictEqual(miningBox.window.SCDOMining.reason('Not enough graphics memory: at least 4 GB is required, found 2 GB.'), '顯示記憶體不足：至少需要 4 GB，目前只有 2 GB。')
assert.strictEqual(i18nBox.window.I18N112.CN.rewardAddr, '出塊獎勵地址（主鏈收款地址，0x 開頭）')
assert.strictEqual(i18nBox.window.I18N112.CN.payoutAddr, '節點服務費地址（主鏈收款地址，0x 開頭）')
assert.strictEqual(i18nBox.window.I18N112.CN.locked, '輸入密碼才能看主鏈收款地址')
assert.strictEqual(i18nBox.window.I18N112.CN.s0Balance, '主鏈餘額')
assert.ok(i18nBox.window.I18N112.CN.newNote.startsWith('這裡只顯示主鏈的收款地址（0x 開頭）'))
const isleT = (k, p) => {
  let s = i18nBox.window.I18N112.CN[k]
  if (s == null) s = k
  if (p) s = s.replace(/\{(\w+)\}/g, (mm, n) => p[n] != null ? p[n] : mm)
  return s
}
function assertTips (list, where) {
  assert.ok(list && list.length, where)
  list.forEach(c => {
    assert.ok(c.tip && c.tip.name && c.tip.value && c.tip.explain, (where || '') + ' ' + c.text)
  })
}
const noon = new Date(2026, 9, 7, 12, 0, 0, 0).getTime()
const island = buildIsland({
  classicGpu: { running: true, shard: 1, code: 'CLASSIC_SYNCING', chain: 'classic', mode: 'gpu', localBlock: 100, networkBlock: 200, syncEtaSec: 3600 },
  classicCpu: { running: true, shard: 2, code: 'CLASSIC_MINING', chain: 'classic', mode: 'cpu', hashrate: 1500 },
  shard0: { running: true, chain: 'shard0', mode: 'mine', code: 'MINING', hashrate: 2000000, localBlock: 50, networkBlock: 50 },
  temps: [{ name: 'A', tempC: 61 }, { name: 'B', tempC: 70 }],
  earnLog: { items: [{ t: noon, shard: 1, height: 9 }] },
  now: noon,
  balanceText: '1.5 SCDO',
  T: isleT,
  etaText: (sec) => Math.round(sec / 3600) + ' 小時',
  hashText: (h) => String(h)
})
assert.deepStrictEqual(island.shards.map(s => s.n), [1, 2, 3, 4, 0])
assert.strictEqual(island.shards[0].syncKind, 'syncing')
assert.ok(island.shards[0].syncText.includes('Shard1 同步進度 50%'))
assert.ok(island.shards[0].rowChips.some(c => c.text.includes('大約還要 1 小時')))
assert.ok(island.shards[0].mineText.includes('等待同步完成後開始挖礦'))
assert.ok(!island.shards[0].mineText.includes('挖礦程式啟動中'))
assert.ok(!island.shards[0].mineText.includes('挖礦中'))
assert.ok(!island.shards[0].mineText.includes('即將完成'))
assert.ok(island.shards[0].rowChips[0].tip.detail.includes('100'))
assert.ok(island.shards[0].rowChips[0].tip.detail.includes('200'))
assert.strictEqual(island.shards[1].syncKind, 'pool')
assert.ok(island.shards[1].mineText.includes('Shard2 處理器挖礦速度 每秒 1,500 次'))
assert.strictEqual(island.shards[2].syncKind, 'off')
assert.ok(island.shards[2].mineText.includes('未挖'))
assert.strictEqual(island.shards[4].syncKind, 'synced')
assert.ok(island.shards[4].syncText.includes('主鏈 同步進度 100%'))
assert.ok(island.shards[4].mineText.includes('主鏈 顯卡挖礦速度 每秒 2,000,000 次'))
assert.strictEqual(island.tempC, 70)
assert.ok(island.compactTop.includes('Shard1 同步進度 50%'))
assert.ok(island.compactTop.includes('大約還要 1 小時'))
assert.ok(island.compactTop.includes('Shard2 處理器挖礦速度 每秒 1,500 次'))
assert.ok(island.compactTop.includes('主鏈 顯卡挖礦速度 每秒 2,000,000 次'))
assert.ok(island.compactTop.includes('等待同步完成後開始挖礦'))
assert.ok(!island.compactTop.includes('同步中 (GPU 待命)'))
assert.ok(!/\bS[0-4]\b/.test(island.compactTop))
assert.ok(!island.compactTop.includes('1h'))
assert.ok(!island.compactTop.includes('MH'))
assert.ok(island.compactTop.indexOf('Shard1') < island.compactTop.indexOf('Shard2'))
assert.ok(island.compactTop.indexOf('Shard2') < island.compactTop.indexOf('主鏈'))
assert.strictEqual(island.tempBand, 'ok')
assert.ok(island.compactBottom.includes('第1張顯卡溫度 61°C（正常）'))
assert.ok(island.compactBottom.includes('第2張顯卡溫度 70°C（正常）'))
assert.ok(island.compactBottom.includes('今天賺了 2 SCDO'))
assert.ok(island.compactBottom.includes('一共賺了 2 SCDO'))
assert.ok(island.compactBottom.includes('帳戶餘額 1.5 SCDO'))
assertTips(island.chips, 'compact')
assertTips(island.money, 'money')
island.shards.forEach(s => { if (s.rowChips.length) assertTips(s.rowChips, 'shard' + s.n) })
assert.ok(island.legend.length >= 9)
island.legend.forEach(it => { assert.ok(it.name && it.text) })
assert.ok(island.legend.some(it => it.name === '大約還要' && it.text.includes('帳本大約還要多久')))
assert.ok(island.legend.some(it => it.name === '一共賺了' && it.text.includes('一共挖到多少幣')))
assert.ok(island.legend.some(it => it.text.includes('低於 75°C 綠色、75°C 到 84°C 橘色、85°C 以上紅色')))
const etaChip = island.shards[0].rowChips.find(c => c.kind === 'eta')
assert.strictEqual(etaChip.tip.name, 'Shard1 大約還要多久同步完')
assert.ok(etaChip.tip.value.includes('1 小時'))
assert.ok(!etaChip.tip.name.includes('還在算'))
const totalChip = island.money.find(c => c.text.includes('一共賺了'))
assert.strictEqual(totalChip.tip.name, '一共賺了多少')
assert.strictEqual(totalChip.tip.value, '2 SCDO')
island.chips.concat(island.money).forEach(c => assert.ok(c.key, c.text))
assert.strictEqual(island.earn.todayScdo, 2)
const both = buildIsland({
  classicGpu: { running: true, shard: 3, code: 'CLASSIC_GPU', mode: 'gpu', localBlock: 10, networkBlock: 12, hashrate: 100 },
  classicCpu: { running: true, shard: 3, code: 'CLASSIC_MINING', mode: 'cpu', hashrate: 50 },
  T: isleT,
  hashText: (h) => String(h)
})
assert.strictEqual(both.shards[2].n, 3)
assert.strictEqual(both.shards[2].syncKind, 'synced')
assert.ok(both.shards[2].mineText.includes('Shard3 顯卡挖礦速度 每秒 100 次'))
assert.ok(both.shards[2].mineText.includes('Shard3 處理器挖礦速度 每秒 50 次'))
const nodeOnly = buildIsland({
  shard0: { running: true, mode: 'node', chain: 'shard0', localBlock: 8, networkBlock: 8 },
  T: isleT
})
const wide = buildIsland({
  classicGpu: { running: true, shard: 1, code: 'CLASSIC_SYNCING', chain: 'classic', mode: 'gpu', localBlock: 3022193, networkBlock: 9276140, syncEtaSec: 107 * 3600 + 6 * 60 },
  classicCpu: { running: true, shard: 1, code: 'CLASSIC_MINING', chain: 'classic', mode: 'cpu', hashrate: 16320000 },
  temps: [{ tempC: 56 }],
  earnLog: { items: Array.from({ length: 11 }, (_, i) => ({ t: noon, shard: 1, height: i })) },
  now: noon,
  balanceText: '0.000 SCDO',
  T: isleT,
  hashText: (h) => (h / 1e6).toFixed(2) + ' MH/s'
})
assert.ok(wide.compactTop.includes('Shard1 同步進度'))
assert.ok(wide.compactTop.includes('大約還要 107 小時'))
assert.ok(wide.compactTop.includes('處理器挖礦速度 每秒 16,320,000 次'))
assert.ok(wide.compactTop.includes('等待同步完成後開始挖礦'))
assert.ok(!wide.compactTop.includes('同步中 (GPU 待命)'))
assert.ok(!/\bS[0-4]\b/.test(wide.compactTop))
assert.ok(!wide.compactTop.includes('107h'))
assert.ok(wide.shards[0].rowChips.some(c => c.tip && c.tip.detail && c.tip.detail.includes('3,022,193')))
assert.ok(!wide.compactTop.includes('挖礦程式啟動中'))
assert.ok(!wide.compactTop.includes('即將完成'))
assert.ok(!wide.compactTop.includes('挖礦中'))
assert.strictEqual(wide.tempBand, 'ok')
assert.ok(wide.compactBottom.includes('顯卡溫度 56°C（正常）'))
assert.ok(wide.compactBottom.includes('今天賺了 22 SCDO'))
assert.ok(wide.compactBottom.includes('帳戶餘額 0.000 SCDO'))
const calculating = buildIsland({
  classicGpu: { running: true, shard: 1, code: 'CLASSIC_SYNCING', chain: 'classic', mode: 'gpu', localBlock: 3022193, networkBlock: 9276140, syncEtaSec: 2 },
  T: isleT,
  etaText: (sec) => sec < 5 ? '即將完成' : '184 小時'
})
assert.ok(calculating.compactTop.includes('還在算'))
assert.ok(!calculating.compactTop.includes('即將完成'))
const calcEta = calculating.shards[0].rowChips.find(c => c.kind === 'eta')
assert.strictEqual(calcEta.tip.name, 'Shard1 大約還要多久同步完')
assert.ok(calcEta.tip.value.includes('還在算'))
assert.ok(!calculating.shards[0].syncText.includes('即將完成'))
const noEta = buildIsland({
  classicGpu: { running: true, shard: 1, code: 'CLASSIC_SYNCING', chain: 'classic', mode: 'gpu', localBlock: 3022193, networkBlock: 9276140 },
  T: isleT,
  etaText: () => '即將完成'
})
assert.ok(noEta.compactTop.includes('還在算'))
assert.ok(!noEta.shards[0].syncText.includes('即將完成'))
assert.ok(!noEta.compactTop.includes('即將完成'))
const idle = buildIsland({ T: isleT })
assert.strictEqual(idle.compactTop, '目前沒有在挖礦')
assert.strictEqual(idle.chips[0].kind, 'idle')
assert.ok(!idle.chips.some(c => c.kind === 'start'))
const syncOnly = buildIsland({
  classicGpu: { running: true, shard: 1, code: 'CLASSIC_SYNCING', chain: 'classic', mode: 'gpu', localBlock: 3022193, networkBlock: 9276140 },
  T: isleT
})
assert.ok(syncOnly.compactTop.includes('Shard1 同步進度'))
assert.ok(syncOnly.compactTop.includes('目前沒有在挖礦'))
assert.ok(syncOnly.compactTop.includes('等待同步完成後開始挖礦'))
assert.ok(!syncOnly.compactTop.includes('同步中 (GPU 待命)'))
assert.ok(syncOnly.compactTop.includes('還在算'))
assert.ok(!syncOnly.compactTop.includes('即將完成'))
assert.ok(!syncOnly.compactTop.includes('挖礦中'))
const hot = buildIsland({ temps: [{ tempC: 85 }], T: isleT })
assert.strictEqual(hot.tempBand, 'hot')
assert.strictEqual(hot.money[0].band, 'hot')
assert.ok(hot.money[0].text.includes('顯卡溫度 85°C（過熱已暫停）'))
assert.ok(hot.money[0].tip.explain.includes('75°C'))
assert.ok(hot.money[0].tip.explain.includes('85°C'))
const warm = buildIsland({ temps: [{ name: 'NVIDIA GeForce RTX 5060 Ti', tempC: 76 }], T: isleT })
assert.strictEqual(warm.tempBand, 'warm')
assert.ok(warm.money[0].text.includes('顯卡溫度 76°C（偏熱）'))
assert.ok(warm.money[0].tip.detail.includes('RTX 5060 Ti'))
const linked = buildIsland({
  shard0: { running: true, chain: 'shard0', mode: 'node', localBlock: 10, networkBlock: 10, peers: 8 },
  T: isleT
})
assert.ok(linked.compactTop.includes('主鏈 已連線 8 個節點'))
assert.ok(linked.chips.some(c => c.text.includes('已連線 8 個節點') && c.tip && c.tip.explain))
const triple = buildIsland({
  classicGpu: { running: true, shard: 1, code: 'CLASSIC_GPU', chain: 'classic', mode: 'gpu', hashrate: 17.4e6, localBlock: 3022193, networkBlock: 9276140, syncEtaSec: 335 * 3600 },
  classicCpu: { running: true, shard: 1, code: 'CLASSIC_MINING', chain: 'classic', mode: 'cpu', hashrate: 5100 },
  shard0: { running: true, chain: 'shard0', mode: 'mine', code: 'MINING', hashrate: 31e6, localBlock: 1000, networkBlock: 1000 },
  T: isleT
})
assert.ok(triple.compactTop.includes('Shard1 同步進度'))
assert.ok(triple.compactTop.includes('大約還要 335 小時'))
assert.ok(triple.compactTop.includes('Shard1 顯卡挖礦速度 每秒 17,400,000 次'))
assert.ok(triple.compactTop.includes('Shard1 處理器挖礦速度 每秒 5,100 次'))
assert.ok(triple.compactTop.includes('主鏈 顯卡挖礦速度 每秒 31,000,000 次'))
assert.ok(!triple.compactTop.includes('GPU 待命'))
assert.ok(!/\bS[0-4]\b/.test(triple.compactTop))
assert.ok(!/MH|kH|\d+h/.test(triple.compactTop))
assertTips(triple.chips.concat(triple.money), 'triple')
assert.ok(triple.chips.filter(c => c.kind === 'rate').length === 3)
assert.ok(triple.chips.filter(c => c.kind === 'rate').every(c => c.live))
function chipRowPx (line) {
  const parts = line.split(' · ')
  let w = 0
  parts.forEach((t, i) => {
    let tw = 0
    for (const ch of t) tw += ch.codePointAt(0) > 0x2e80 ? 14 : 9.2
    if (/GPU |CPU |MH|kH/.test(t)) tw += 16
    w += tw + 16
    if (i) w += 4
  })
  return w
}
assert.ok(triple.compactTop.length > 40)
assert.strictEqual(nodeOnly.shards[4].mineText, '主鏈 只在記帳，還沒有開始挖礦')
assert.strictEqual(nodeOnly.shards[4].syncKind, 'synced')
assert.strictEqual(syncOf({ running: true, localBlock: 100, networkBlock: 108 }).kind, 'synced')
assert.strictEqual(syncOf({ running: true, localBlock: 100, networkBlock: 109 }).kind, 'syncing')
assert.strictEqual(syncOf({ running: true, mode: 'cpu', code: 'CLASSIC_MINING' }).kind, 'pool')
assert.strictEqual(syncOf({ running: true, localBlock: 80500, networkBlock: 0 }).kind, 'pending')
assert.strictEqual(syncOf({ running: true, localBlock: 80500, networkBlock: null }).kind, 'pending')
const flash = buildIsland({
  shard0: { running: true, chain: 'shard0', mode: 'mine', code: 'MINING', localBlock: 80500, networkBlock: 0 },
  T: isleT
})
assert.ok(flash.compactTop.includes('主鏈 同步進度 還在查'))
assert.ok(!flash.compactTop.includes('/0'))
assert.ok(!flash.compactTop.includes('80.5k'))
assert.ok(flash.shards[4].syncText.includes('主鏈 同步進度 還在查'))
assert.ok(flash.shards[4].rowChips[0].tip.detail.includes('80,500'))
assert.ok(!flash.shards[4].syncText.includes('/0'))
const zeroH = syncOf({ running: true, localBlock: 0, networkBlock: 0 })
assert.strictEqual(zeroH.kind, 'pending')
assert.strictEqual(zeroH.local, null)
assert.strictEqual(zeroH.network, null)
const blank = buildIsland({
  shard0: { running: true, chain: 'shard0', mode: 'mine', code: 'MINING', localBlock: 0, networkBlock: 0 },
  T: isleT
})
assert.ok(blank.compactTop.includes('主鏈 同步進度 還在查'))
assert.ok(!blank.compactTop.includes('0/'))
assert.ok(blank.shards[4].syncText.includes('還在查'))
assert.ok(!blank.shards[4].syncText.includes('0/'))
const named = buildIsland({ balanceText: 'Alice 1.5 SCDO', balanceMark: 'A', balanceName: 'Alice', T: isleT })
assert.ok(named.money.some(c => c.kind === 'bal' && c.text === '帳戶餘額 Alice 1.5 SCDO' && c.mark === 'A' && c.name === 'Alice' && c.tip && c.tip.explain))
assert.strictEqual(named.balanceName, 'Alice')
assert.ok(named.compactBottom.includes('帳戶餘額 Alice 1.5 SCDO'))
let earn = absorbBlocks(null, [{ shard: 1, height: 100 }, { shard: 1, height: 101 }], noon)
assert.strictEqual(earn.seeded, true)
assert.strictEqual(earn.items.length, 0)
earn = absorbBlocks(earn, [{ shard: 1, height: 100 }, { shard: 1, height: 101 }], noon)
assert.strictEqual(earn.items.length, 0)
earn = absorbBlocks(earn, [{ shard: 1, height: 100 }, { shard: 1, height: 102 }], noon)
assert.strictEqual(earn.items.length, 1)
assert.strictEqual(earn.items[0].height, 102)
assert.strictEqual(earn.items[0].t, noon)
const sum = summarizeEarnings(earn, noon, BLOCK_REWARD_SCDO)
assert.strictEqual(sum.todayBlocks, 1)
assert.strictEqual(sum.totalBlocks, 1)
assert.strictEqual(sum.todayScdo, 2)
assert.strictEqual(sum.totalScdo, 2)
const yest = noon - 24 * 3600 * 1000
const sum2 = summarizeEarnings([{ t: yest, shard: 0, height: 1 }, { t: noon, shard: 0, height: 2 }], noon, 2)
assert.strictEqual(sum2.todayBlocks, 1)
assert.strictEqual(sum2.totalBlocks, 2)
assert.strictEqual(sum2.todayScdo, 2)
assert.strictEqual(sum2.totalScdo, 4)
assert.deepStrictEqual(parseGpuTemp('NVIDIA GeForce RTX 3060, 61\n'), [{ name: 'NVIDIA GeForce RTX 3060', tempC: 61 }])
assert.deepStrictEqual(parseGpuTemp('Tesla T4, 40\nQuadro, RTX, 55\n'), [{ name: 'Tesla T4', tempC: 40 }, { name: 'Quadro, RTX', tempC: 55 }])
assert.deepStrictEqual(parseGpuTemp(''), [])
assert.deepStrictEqual(parseGpuTemp('no comma here\n'), [])
const pillT = (k, p) => {
  const m = { pillStopped: '未在挖礦', pillMining: '挖礦中', pillStarting: '挖礦程式啟動中…', pillNode: '只執行節點（未挖礦）', pillError: '挖礦程式出錯', pillShard0: '主鏈', mineShardN: 'Shard{n}', classicCpu: 'CPU 礦池', classicGpu: '顯示卡節點' }
  let s = m[k] || k
  if (p) s = s.replace(/\{(\w+)\}/g, (mm, n) => p[n] != null ? p[n] : mm)
  return s
}
assert.deepStrictEqual(formatMinePill({}, pillT), { cls: '', t: '⛏ 未在挖礦' })
assert.deepStrictEqual(formatMinePill({ shard0: { running: true, code: 'MINING', mode: 'pool' } }, pillT), { cls: 'ok', t: '⛏ 挖礦中 · 主鏈' })
assert.deepStrictEqual(formatMinePill({
  classicCpu: { running: true, shard: 1, code: 'CLASSIC_MINING', chain: 'classic' },
  classicGpu: { running: true, shard: 1, code: 'CLASSIC_GPU', chain: 'classic' }
}, pillT), { cls: 'ok', t: '⛏ 挖礦中 · Shard1' })
assert.deepStrictEqual(formatMinePill({
  classicGpu: { running: true, shard: 1, code: 'CLASSIC_SYNCING', chain: 'classic' }
}, pillT), { cls: 'warn', t: '⛏ 挖礦程式啟動中… · Shard1' })
assert.deepStrictEqual(formatMinePill({
  classicCpu: { running: true, shard: 1, code: 'CLASSIC_MINING', chain: 'classic' },
  classicGpu: { running: true, shard: 2, code: 'CLASSIC_SYNCING', chain: 'classic' }
}, pillT), { cls: 'warn', t: '⛏ 挖礦中 · Shard1 · 挖礦程式啟動中… · Shard2' })
assert.deepStrictEqual(formatMinePill({ shard0: { running: true, mode: 'node' } }, pillT), { cls: '', t: '只執行節點（未挖礦）' })
assert.deepStrictEqual(formatMinePill({
  shard0: { running: true, mode: 'node' },
  classicCpu: { running: true, shard: 3, code: 'CLASSIC_MINING', chain: 'classic' }
}, pillT).t, '⛏ 挖礦中 · Shard3 · 只執行節點（未挖礦）')
assert.strictEqual(formatMinePill({ classicCpu: { running: true, shard: 4, code: 'LOGIN', chain: 'classic' } }, pillT).cls, 'bad')

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
  assert.ok(pkg.scripts['dist:win'].includes('--publish never'))
  assert.ok(pkg.scripts['dist:win:nsis'].includes('--publish never'))
  const miss = missingMessage(ZMINER_EXE_SHA256)
  assert.ok(miss.includes(ZMINER_EXE_SHA256))
  assert.ok(miss.includes('only runs on Linux'))
  assert.ok(miss.includes('ZMINER_SKIP=1'))
  assert.strictEqual(DEFAULT_ZMINER_URL, 'https://github.com/SCDOLAB/scdowallet/releases/download/zminer-windows-amd64/zminer.exe')
  assert.ok(miss.includes(DEFAULT_ZMINER_URL))
  assert.ok(fs.readFileSync(path.join(root, 'scripts', 'stage-zminer.js'), 'utf8').includes('download(DEFAULT_ZMINER_URL'))
  assert.strictEqual(typeof canBuildHere(), 'boolean')
  const buildSh = fs.readFileSync(path.join(root, 'scripts', 'build-zminer.sh'), 'utf8')
  assert.ok(buildSh.includes('uname -s'))
  assert.ok(buildSh.includes(ZMINER_EXE_SHA256))
  assert.ok(buildSh.includes('only runs on Linux'))
  const ksCompat = fs.readFileSync(path.join(root, 'test', 'keystore-compat.js'), 'utf8')
  assert.ok(ksCompat.includes('keystore-compat: SKIP'))
  assert.ok(ksCompat.includes("path.join('windows', 'client.exe')"))
  assert.ok(ksCompat.includes("path.join('linux', 'client')"))
  assert.ok(!ksCompat.includes("path.join(__dirname, '..', 'cmd', 'linux', 'client')"))
  const nsh = fs.readFileSync(path.join(root, 'build', 'installer.nsh'), 'utf8')
  assert.ok(nsh.includes('scdoReadPerMachineUninstall'))
  assert.ok(nsh.includes('UNINSTALL_REGISTRY_KEY'))
  assert.ok(nsh.includes('SetRegView 64'))
  assert.ok(nsh.includes('SetRegView 32'))
  assert.ok(nsh.includes('hasPerMachineInstallation'))
  const boxes = nsh.match(/MessageBox[^\n]*/g) || []
  assert.strictEqual(boxes.length, 2)
  for (const line of boxes) assert.ok(line.includes('/SD IDOK'), line)
  assert.ok(nsh.includes('SetErrorLevel 1223'))
  assert.ok(nsh.includes('SetErrorLevel 1'))
  assert.ok(nsh.includes('SHChangeNotify'))
  assert.ok(nsh.includes('0x08000000'))
  assert.ok(nsh.includes('CreateShortCut "$newStartMenuLink"'))
  assert.ok(nsh.includes('CreateShortCut "$newDesktopLink"'))
  assert.ok(nsh.includes('"$appExe" 0'))
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
  assert.ok(yml.includes('tag=zminer-windows-amd64'))
  assert.ok(yml.includes('gh release upload'))
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
