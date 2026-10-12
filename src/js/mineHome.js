// SCDO Wallet 3.0.10: the Home mining card. Pure functions (no DOM, no IPC).
// Numbers come only from the miner, temperature and earnings objects passed in.
// A missing reading is a dash. Nothing here invents a sample speed, temperature or payout.
// A chain is listed only when its process is alive and a speed has been read.
// Stop keeps the saved graphics-card / processor choice; start uses that choice again.
'use strict'
;(function () {
const DASH = '\u2014'
const REWARD_SCDO = 2

function num (v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function tr (T, k, p) {
  let s = T(k, p)
  if (s == null) s = k
  if (p && typeof s === 'string' && s.indexOf('{') >= 0) s = s.replace(/\{(\w+)\}/g, (m, name) => p[name] != null ? p[name] : m)
  return s
}

// A miner process the wallet started. An intended or wanted session has no procs yet.
function procsAlive (m) {
  if (!m || !Array.isArray(m.procs)) return false
  return m.procs.some(p => p != null && p !== false && p !== '')
}

// Tries per second copied from this process. A pool stat is not this miner's speed.
function sessionHashrate (m) {
  if (!m) return null
  const direct = num(m.hashrate)
  if (direct != null && direct > 0) return direct
  return null
}

function heightsBehind (m) {
  const local = knownHeight(m && m.localBlock)
  const network = knownHeight(m && m.networkBlock)
  if (local == null || network == null) return null
  return network - local > BEHIND_BLOCKS
}

// Valid work: the processor is connected and reporting a speed, or the Classic
// node says it is mining and is not still behind the tip. A syncing node and a
// borrowed pool speed are not valid work.
function producingWork (m, kind) {
  if (!m || m.mode === 'node') return false
  if (kind === 'shard0') {
    if (m.chain === 'classic') return false
    if (!procsAlive(m) || stillSyncing(m)) return false
    return sessionHashrate(m) != null
  }
  if (kind !== 'classic') return false
  if (m.chain && m.chain !== 'classic') return false
  if (!procsAlive(m)) return false
  if (m.mode === 'cpu') {
    if (m.connected === false) return false
    return sessionHashrate(m) != null
  }
  if (m.backend === 'zminer-gpu') {
    if (!(Number(m.sharesAccepted) > 0)) return false
    return sessionHashrate(m) != null
  }
  if (heightsBehind(m) === true) return false
  if (stillSyncing(m) && m.code !== 'CLASSIC_GPU' && m.gpuActive !== true) return false
  return m.gpuActive === true || m.code === 'CLASSIC_GPU' || m.phase === 'mining'
}

function hashing (m, kind) {
  if (!m || m.mode === 'node') return false
  if (kind === 'shard0' && m.chain === 'classic') return false
  if (kind === 'classic' && m.chain && m.chain !== 'classic') return false
  return procsAlive(m) && sessionHashrate(m) != null
}

function liveMiner (m, kind) {
  return producingWork(m, kind)
}

function engaged (m, kind) {
  if (!m || !m.running || m.mode === 'node') return false
  if (kind === 'shard0' && m.chain === 'classic') return false
  return true
}

function gpuOn (miners) {
  miners = miners || {}
  const s0 = miners.shard0
  if (s0 && s0.running && s0.mode !== 'node' && s0.chain !== 'classic') return true
  const g = miners.classicGpu
  return !!(g && g.running && g.mode !== 'cpu' && g.mode !== 'node')
}

// Same bands as the rest of the wallet: under 75°C normal, 75–84°C warm, 85°C and above hot.
function tempBand (c) {
  if (c == null || !Number.isFinite(Number(c))) return ''
  if (Number(c) >= 85) return 'hot'
  if (Number(c) >= 75) return 'warm'
  return 'ok'
}

function tempDigits (n) {
  const x = Number(n)
  if (!Number.isFinite(x)) return ''
  const r = Math.round(x * 10) / 10
  if (Math.abs(r - Math.round(r)) < 0.001) return String(Math.round(r))
  return String(r)
}

function hottest (temps) {
  let best = null
  for (const t of temps || []) {
    const n = num(t && t.tempC != null ? t.tempC : t)
    if (n == null) continue
    if (best == null || n > best) best = n
  }
  return best
}

function classicList (miners) {
  miners = miners || {}
  const out = []
  if (miners.classicCpu) out.push(miners.classicCpu)
  const g = miners.classicGpu
  if (g && Array.isArray(g.shards) && g.shards.length) {
    for (const s of g.shards) out.push(s)
  } else if (g) out.push(g)
  return out
}

function chainNames (miners) {
  miners = miners || {}
  const out = []
  if (liveMiner(miners.shard0, 'shard0')) out.push('Shard0 EVM')
  const shards = []
  for (const m of classicList(miners)) {
    if (!liveMiner(m, 'classic')) continue
    const n = Number(m.shard)
    if (n >= 1 && n <= 4 && shards.indexOf(n) < 0) shards.push(n)
  }
  shards.sort((a, b) => a - b)
  for (const n of shards) out.push('Shard' + n + ' Classic')
  return out
}

function speedCount (miners) {
  miners = miners || {}
  let sum = 0
  let any = false
  const list = [[miners.shard0, 'shard0']]
  for (const m of classicList(miners)) list.push([m, 'classic'])
  for (const pair of list) {
    const m = pair[0]
    if (!producingWork(m, pair[1])) continue
    const n = sessionHashrate(m)
    if (n != null && n > 0) { sum += n; any = true }
  }
  return any ? Math.round(sum) : null
}

const BEHIND_BLOCKS = 8

function knownHeight (v) {
  const n = num(v)
  return n != null && n > 0 ? n : null
}

function syncPctOf (m) {
  const local = knownHeight(m && m.localBlock)
  const network = knownHeight(m && m.networkBlock)
  if (local == null || network == null || !(network > 0)) return null
  return Math.max(0, Math.min(100, Math.round((local / network) * 100)))
}

// The miner was told to stop and its children are still exiting (geth can take up
// to 60 s to save the chain). That is 「正在停止」, never 「等待同步」.
function shuttingDown (m) {
  if (!m) return false
  if (m.stopping === true) return true
  return m.code === 'STOPPING' && (procsAlive(m) || (Array.isArray(m.shards) && m.shards.some(s => s && procsAlive(s))))
}

function stillSyncing (m) {
  if (!m) return false
  if (shuttingDown(m)) return false
  if (m.phase === 'syncing' || m.paused) return true
  if (m.code === 'CLASSIC_SYNCING' || m.code === 'CLASSIC_PAUSED' || m.code === 'CLASSIC_CHECKING' || m.code === 'CLASSIC_STARTING' || m.code === 'SYNCING') return true
  const local = knownHeight(m.localBlock)
  const network = knownHeight(m.networkBlock)
  if (local == null || network == null) return false
  return network - local > BEHIND_BLOCKS
}

// Local height and network height → synced (within 8 blocks) and a whole-number percent.
// Missing heights are not synced. The percent stays empty until both heights exist.
function nodeSyncOf (input) {
  input = input || {}
  const local = knownHeight(input.local)
  const network = knownHeight(input.network)
  if (local == null || network == null) return { synced: false, pct: null }
  const pct = Math.max(0, Math.min(100, Math.round((local / network) * 100)))
  return { synced: network - local <= BEHIND_BLOCKS, pct: pct }
}

function waitingSync (m, kind) {
  if (!m || liveMiner(m, kind) || m.mode === 'node' || m.mode === 'cpu') return false
  if (shuttingDown(m)) return false
  if (!(m.running || procsAlive(m))) return false
  return stillSyncing(m)
}

// Today's coins and the latest reward are confirmed credits only.
// Source: indexer rows for this wallet's own addresses (Shard0 EVM in st.activity,
// Shard1–Shard4 in st.oldAct), built by confirmedEarnLog. A row counts when the
// indexer marked it dir "reward" (sent from the reward address), status "done",
// asset SCDO, with a real SCDO amount and a time. A miner "block found" height
// is not a credit, and a flat 2 SCDO block reward is not used. Anything less
// certain returns null so the card shows a dash.
const TX_PAGE = 30

function coversToday (rows, now) {
  if (rows.length < TX_PAGE) return true
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const from = start.getTime()
  let oldest = null
  for (const r of rows) {
    const t = num(r && r.t)
    if (t == null) continue
    if (oldest == null || t < oldest) oldest = t
  }
  return oldest != null && oldest < from
}

function confirmedEarnLog (byAddress, now) {
  if (!byAddress || typeof byAddress !== 'object' || Array.isArray(byAddress)) return null
  const keys = Object.keys(byAddress)
  if (!keys.length) return null
  const when = now == null ? Date.now() : now
  const items = []
  for (const key of keys) {
    if (!key) return null
    const rows = byAddress[key]
    if (!Array.isArray(rows)) return null
    if (!coversToday(rows, when)) return null
    for (const r of rows) {
      if (!r || r.dir !== 'reward' || r.status !== 'done') continue
      if (r.asset && r.asset !== 'SCDO') continue
      if (r.amount == null || String(r.amount).trim() === '') return null
      const amount = num(r.amount)
      const t = num(r.t)
      if (amount == null || amount < 0 || t == null) return null
      items.push({ t: t, amount: amount, address: key, confirmed: true })
    }
  }
  return { certain: true, items: items }
}

function earnOf (log, now) {
  if (!log || log.certain !== true || !Array.isArray(log.items)) return null
  const when = now == null ? Date.now() : now
  const start = new Date(when)
  start.setHours(0, 0, 0, 0)
  const from = start.getTime()
  let today = 0
  let last = null
  for (const e of log.items) {
    if (!e || e.confirmed !== true || !e.address) return null
    const t = num(e.t)
    const amount = num(e.amount)
    if (t == null || amount == null || amount < 0) return null
    if (t >= from) today += amount
    if (last == null || t > last) last = t
  }
  return { todayScdo: today, last: last }
}

function scdoCount (n) {
  if (Math.abs(n - Math.round(n)) < 1e-8) return Math.round(n).toLocaleString('en-US')
  return n.toLocaleString('en-US', { maximumFractionDigits: 8 })
}

function clockText (t) {
  const d = new Date(t)
  const h = d.getHours()
  const m = d.getMinutes()
  return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m
}

function minutesAgo (t, now) {
  const ms = Number(now) - Number(t)
  if (!Number.isFinite(ms)) return null
  return Math.max(0, Math.floor(ms / 60000))
}

function anyLive (miners) {
  miners = miners || {}
  return liveMiner(miners.shard0, 'shard0') || liveMiner(miners.classicCpu, 'classic') || liveMiner(miners.classicGpu, 'classic')
}

function anyShuttingDown (miners) {
  miners = miners || {}
  return shuttingDown(miners.shard0) || shuttingDown(miners.classicCpu) || shuttingDown(miners.classicGpu)
}

// Shard0 EVM needs its own miner:stop when it is wanted, or when its node/proxy are
// still alive and no stop is already running. A cleared running flag alone is not
// "already stopped": the processes can outlive it.
function shard0NeedsStop (s0) {
  if (!s0 || s0.mode === 'node' || s0.chain === 'classic') return false
  if (s0.running) return true
  return procsAlive(s0) && !shuttingDown(s0)
}

function anyEngaged (miners) {
  miners = miners || {}
  return engaged(miners.shard0, 'shard0') || engaged(miners.classicCpu, 'classic') || engaged(miners.classicGpu, 'classic')
}

// A session is armed when its process is up, or it is paused while the chain syncs.
// A running flag with no process and no sync state is not armed.
function sessionArmed (m, kind) {
  if (!m || m.mode === 'node') return false
  if (kind === 'shard0' && m.chain === 'classic') return false
  if (kind === 'classic' && m.chain && m.chain !== 'classic') return false
  if (liveMiner(m, kind) || waitingSync(m, kind)) return true
  return procsAlive(m)
}

function anyArmed (miners) {
  miners = miners || {}
  return sessionArmed(miners.shard0, 'shard0') || sessionArmed(miners.classicCpu, 'classic') || sessionArmed(miners.classicGpu, 'classic')
}

function waitingSessions (miners) {
  miners = miners || {}
  const out = []
  const s0 = miners.shard0
  if (waitingSync(s0, 'shard0')) out.push({ m: s0, chain: 'Shard0 EVM' })
  const g = miners.classicGpu
  if (waitingSync(g, 'classic')) {
    const n = Number(g.shard)
    if (n >= 1 && n <= 4) out.push({ m: g, chain: 'Shard' + n + ' Classic' })
  }
  return out
}

// Mining only when a process is alive and reporting a speed.
// Waiting when a session is armed but not hashing yet (usually still syncing).
// Stopped only when nothing is armed. starting and stopping are the click in progress.
// The button uses the same split, so 「已停止」 is never next to 「停止挖礦」.
function statusPhase (input) {
  const p = input && input.phase
  if (p === 'starting' || p === 'stopping') return p
  const miners = input && input.miners
  if (anyShuttingDown(miners)) return 'stopping'
  if (anyLive(miners)) return 'mining'
  if (input && input.liveOnly) {
    if (p === 'mining') return 'mining'
    if (armedWithProcess(miners)) return 'waiting'
    return 'stopped'
  }
  if (p === 'mining' || anyArmed(miners)) return 'waiting'
  return 'stopped'
}

function buttonPhase (input) {
  const p = input && input.phase
  if (p === 'starting' || p === 'stopping') return p
  const sp = statusPhase(input)
  if (sp === 'stopping') return 'stopping'
  return sp === 'stopped' ? 'stopped' : 'mining'
}

// Click moves stopped → starting and mining → stopping.
// starting and stopping ignore further clicks.
// Only an explicit ok/fail/cancel finishes the in-progress step.
// Nothing here starts mining by itself.
function reduceMinePhase (phase, event) {
  const p = phase === 'starting' || phase === 'stopping' || phase === 'mining' || phase === 'stopped' ? phase : 'stopped'
  if (event === 'click') {
    if (p === 'stopped') return 'starting'
    if (p === 'mining') return 'stopping'
    return p
  }
  if (event === 'ok') {
    if (p === 'starting') return 'mining'
    if (p === 'stopping') return 'stopped'
    return p
  }
  if (event === 'fail' || event === 'cancel') {
    if (p === 'starting') return 'stopped'
    if (p === 'stopping') return 'mining'
    return p
  }
  // A hung start or stop must leave the button. The deadline always wins.
  if (event === 'timeout') {
    if (p === 'starting' || p === 'stopping') return 'stopped'
    return p
  }
  return p
}

// Stop is allowed to show 「正在停止」 only while a kill is in flight.
// Start has its own cap so a click cannot sit on 「正在啟動」 either.
const STOP_DEADLINE_MS = 2000
const START_DEADLINE_MS = 8000

function processAlive (m) {
  if (!m) return false
  if (procsAlive(m)) return true
  if (Array.isArray(m.shards) && m.shards.some(processAlive)) return true
  return false
}

function deviceProcessAlive (miners, device) {
  miners = miners || {}
  if (device === 'cpu') return processAlive(miners.classicCpu)
  if (processAlive(miners.classicGpu)) return true
  const s0 = miners.shard0
  if (!s0 || s0.mode === 'node' || s0.chain === 'classic') return false
  return processAlive(s0)
}

// One click on a device button.
// phase is what that button is showing. alive means a child process exists.
// stuck means starting/stopping has already passed its deadline, so the click
// is not swallowed. No child means stop is already finished.
function planDeviceClick (input) {
  input = input || {}
  const known = input.phase === 'starting' || input.phase === 'stopping' || input.phase === 'mining' || input.phase === 'waiting'
  const phase = known ? input.phase : 'stopped'
  const alive = input.alive === true
  const stuck = input.stuck === true
  if ((phase === 'starting' || phase === 'stopping') && !stuck) return { next: phase, op: 'ignore', deadlineMs: 0 }
  if (stuck && !alive) return { next: 'stopped', op: 'idle-stop', deadlineMs: 0 }
  const wantStop = phase === 'mining' || phase === 'waiting' || (stuck && phase === 'stopping')
  if (!wantStop) {
    if (Array.isArray(input.chains) && input.chains.length === 0) return { next: 'stopped', op: 'need-chain', deadlineMs: 0 }
    return { next: 'starting', op: 'start', deadlineMs: START_DEADLINE_MS }
  }
  if (!alive) return { next: 'stopped', op: 'idle-stop', deadlineMs: 0 }
  return { next: 'stopping', op: 'kill', deadlineMs: STOP_DEADLINE_MS }
}

// Stop does not change the saved choice. Graphics card stays graphics card.
function choiceAfterStop (saved) {
  saved = saved || {}
  const classic = saved.classic === 'gpu' || saved.classic === 'external' || saved.classic === 'cpu' ? saved.classic : ''
  return { classic: classic, cpu: !!(saved.cpu && classic !== 'cpu'), shard0: !!saved.shard0 }
}

function normalizeSaved (input) {
  input = input || {}
  const s = input.saved || {}
  let classic = s.classic
  if (classic !== 'gpu' && classic !== 'external' && classic !== 'cpu') {
    if (input.backend === 'gpu' || input.backend === 'external' || input.backend === 'cpu') classic = input.backend
    else classic = ''
  }
  return choiceAfterStop({ classic: classic, cpu: !!s.cpu, shard0: !!s.shard0 })
}

// Shard0 EVM starts only when the graphics-card check passed.
// A missing check, or a card that is not ready, does not pass.
function shard0PreflightOk (preflight) {
  if (!preflight || preflight.ok === false || preflight.supported === false) return false
  const gpus = preflight.gpus
  if (!Array.isArray(gpus) || !gpus.length) return false
  return gpus.some(g => g && (g.status === 'ready' || g.status === 'warn'))
}

function pushClassic (jobs, mode, target, caps) {
  if (mode !== 'gpu' && mode !== 'external' && mode !== 'cpu') return
  if (!target || !target.address) return
  const shard = Number(target.shard)
  if (!(shard >= 1 && shard <= 4)) return
  let allowed = true
  if (caps) {
    if (mode === 'cpu') allowed = !!(caps.cpu && caps.cpu.available)
    else if (mode === 'external') allowed = !!(caps.external && caps.external.available)
    else allowed = !!(caps.gpu && caps.gpu.available)
  }
  if (!allowed) return
  jobs.push({
    chain: 'classic',
    backend: mode === 'cpu' ? 'cpu' : 'gpu',
    gpuMiner: mode === 'external' ? 'external' : 'classic-node',
    shard: shard,
    address: String(target.address)
  })
}

// Graphics-card row while its own node is still behind the tip.
// Shard name only, as in 「等待同步（Shard1 52%），同步完成後顯卡自動開始」.
function gpuWaitText (shard, pct, zh) {
  const n = Number(shard)
  const name = 'Shard' + (n >= 1 && n <= 4 ? n : '')
  const pctOk = pct != null && pct !== '' && Number.isFinite(Number(pct))
  const inside = (name ? name : 'Shard') + (pctOk ? (' ' + Math.round(Number(pct)) + '%') : '')
  if (zh) return '等待同步（' + inside + '），同步完成後顯卡自動開始'
  return 'Waiting for sync (' + inside + '). The graphics card starts on its own when sync finishes.'
}

function cpuPoolText (zh) {
  return zh ? '經礦池挖' : 'Mining through the pool'
}

function gpuMineText (zh) {
  return zh ? '顯卡挖礦中' : 'Graphics card mining'
}

function gpuPoolText (zh) {
  return zh ? '顯卡經礦池挖' : 'Graphics card mining through the pool'
}

function gpuPoolSyncText (zh, pct) {
  const n = Math.round(Number(pct))
  if (zh) return '顯卡經礦池挖（本機節點同步 ' + n + '%）'
  return 'Graphics card mining through the pool (local node sync ' + n + '%)'
}

function shownPoolLabel (zh, held, session) {
  const candidates = [(held && held.label) || '', (session && session.mineLabel) || '']
  for (let i = 0; i < candidates.length; i++) {
    const label = candidates[i]
    if (label.indexOf('（本機節點同步') >= 0 || label.indexOf('(local node sync') >= 0) return label
  }
  for (let i = 0; i < candidates.length; i++) {
    const label = candidates[i]
    if (label.indexOf('顯卡經礦池挖') === 0 || label.indexOf('Graphics card mining through the pool') === 0) return label
  }
  return gpuPoolText(zh)
}

// Default is the graphics-card pool miner. Solo node.exe runs only when solo
// was saved and that node is already synced. An unsynced node, including a
// solo choice left over from an older wallet, mines through the pool instead.
// A known percent under 100 is not caught up, even if a pool height looked close.
function chooseMinePath (input) {
  input = input || {}
  const zh = input.zh !== false
  const pct = input.syncPct
  const pctOk = pct != null && pct !== '' && Number.isFinite(Number(pct))
  const low = pctOk && Math.round(Number(pct)) < 100
  if (input.explicitSolo === true && input.nodeSynced === true && !low) {
    return { action: 'mine', gpuMiner: 'classic-node', reason: '', label: gpuMineText(zh), offerCpu: false }
  }
  const label = input.explicitSolo === true && low ? gpuPoolSyncText(zh, pct) : gpuPoolText(zh)
  return { action: 'pool', gpuMiner: 'zminer-gpu', reason: '', label: label, offerCpu: false }
}

// Which miners a Home click should start. The saved choice wins over the settings
// default, so a graphics-card session is not replaced by the processor.
// Shard0 EVM is included only when it was enabled and its preflight passed.
// An empty configuration returns no jobs. A hot graphics card keeps only a processor job
// that was already chosen. It does not invent one.
function jobsForHome (input) {
  input = input || {}
  const saved = normalizeSaved(input)
  const caps = input.caps
  const jobs = []
  const primary = saved.classic === 'cpu' ? (input.classicCpu || input.classic) : input.classic
  if (saved.classic) pushClassic(jobs, saved.classic, primary, caps)
  if (saved.cpu) pushClassic(jobs, 'cpu', input.classicCpu || input.classic, caps)
  const reward = String(input.reward || '')
  if (saved.shard0 && !input.gpuBusy && input.nvidia && shard0PreflightOk(input.preflight) && /^0x[0-9a-fA-F]{40}$/.test(reward)) {
    jobs.push({ chain: 'shard0', backend: 'gpu', mode: 'mine', address: reward })
  }
  if (input.hot) return jobs.filter(j => j.chain === 'classic' && j.backend === 'cpu')
  return jobs
}

// Why a waiting session is not hashing yet: no peers, sync stopped moving, or plain syncing.
function waitReason (m) {
  if (!m) return 'syncing'
  if (m.code === 'NO_PEERS' || (m.peers != null && Number(m.peers) === 0 && m.phase === 'syncing')) return 'noPeers'
  if (m.syncStalled === true) return 'stalled'
  return 'syncing'
}

function waitDetail (sessions, T) {
  const sep = tr(T, 'd_listSep')
  return sessions.map(s => {
    const why = waitReason(s.m)
    const pct = syncPctOf(s.m)
    if (why === 'noPeers') return tr(T, 'homeMineWaitNoPeers', { chain: s.chain })
    if (why === 'stalled') return tr(T, pct == null ? 'homeMineWaitStalled' : 'homeMineWaitStalledPct', { chain: s.chain, pct: pct })
    return pct == null ? tr(T, 'homeMineWaitChain', { chain: s.chain }) : tr(T, 'homeMineWaitPct', { chain: s.chain, pct: pct })
  }).join(sep)
}

function noteLines (miners, input, T) {
  miners = miners || {}
  input = input || {}
  const lines = []
  const s0 = miners.shard0
  if (input.gpuBusy && !liveMiner(s0, 'shard0') && !waitingSync(s0, 'shard0')) lines.push(tr(T, 'homeMineGpuBusy'))
  return lines
}

function formatMineHome (input, T) {
  input = input || {}
  T = T || function (k) { return k }
  const miners = input.miners || {}
  const phase = statusPhase(input)
  const press = buttonPhase(input)
  const sep = tr(T, 'd_listSep')
  const waits = phase === 'waiting' ? waitingSessions(miners) : []
  let statusText = tr(T, phase === 'starting' ? 'homeMineStarting' : phase === 'stopping' ? 'homeMineStopping' : phase === 'mining' ? 'homeMineOn' : phase === 'waiting' ? 'homeMineWaitPlain' : 'homeMineOff')
  if (phase === 'waiting' && waits.length) statusText = tr(T, 'homeMineWait', { detail: waitDetail(waits, T) })
  const tone = phase === 'mining' ? 'on' : phase === 'stopped' ? 'off' : phase === 'waiting' ? 'wait' : 'busy'
  const speedN = speedCount(miners)
  const speedValue = speedN == null ? DASH : tr(T, 'islePerSec', { n: speedN.toLocaleString('en-US') })
  const speedText = speedN == null ? tr(T, 'homeMineSpeedNone') : tr(T, 'mineSpeedLine', { n: speedN.toLocaleString('en-US') })
  let tempBandName = ''
  let tempValue = DASH
  let tempText = tr(T, 'homeMineTempNone')
  if (gpuOn(miners)) {
    const c = hottest(input.temps)
    if (c != null) {
      tempBandName = tempBand(c)
      const stateKey = tempBandName === 'hot' ? 'isleHot' : tempBandName === 'warm' ? 'isleWarm' : 'isleOk'
      const shown = tempDigits(c)
      tempValue = tr(T, 'homeMineTempVal', { n: shown, state: tr(T, stateKey) })
      tempText = tr(T, 'homeMineTemp', { n: shown, state: tr(T, stateKey) })
    }
  }
  const earn = earnOf(input.earnLog, input.now == null ? Date.now() : input.now)
  let todayValue = DASH
  let todayText = tr(T, 'homeMineTodayNone')
  let lastValue = DASH
  let lastText = tr(T, 'homeMineLastNone')
  let lastClock = ''
  let lastMinutes = null
  if (earn) {
    const todayN = scdoCount(earn.todayScdo)
    todayValue = todayN + ' SCDO'
    todayText = tr(T, 'homeMineToday', { n: todayN })
    if (earn.last != null) {
      lastClock = clockText(earn.last)
      lastMinutes = minutesAgo(earn.last, input.now == null ? Date.now() : input.now)
      const ago = tr(T, 'homeMineAgo', { n: lastMinutes })
      lastValue = tr(T, 'homeMineLastVal', { t: lastClock, ago: ago })
      lastText = tr(T, 'homeMineLast', { t: lastClock, ago: ago })
    }
  }
  const names = chainNames(miners)
  const chainsValue = names.length ? names.join(sep) : DASH
  const chainsText = names.length ? tr(T, 'homeMineChains', { list: names.join(sep) }) : tr(T, 'homeMineChainsNone')
  const reasons = noteLines(miners, input, T)
  const noteText = reasons.join(' ')
  const waitText = waits.length ? waitDetail(waits, T) : ''
  const buttonKey = press === 'starting' ? 'homeMineBtnStarting' : press === 'stopping' ? 'homeMineBtnStopping' : press === 'mining' ? 'homeMineStop' : 'homeMineStart'
  return {
    phase: phase,
    statusText: statusText,
    statusTone: tone,
    speedText: speedText,
    speedValue: speedValue,
    tempText: tempText,
    tempValue: tempValue,
    tempBand: tempBandName,
    todayText: todayText,
    todayValue: todayValue,
    lastText: lastText,
    lastValue: lastValue,
    lastClock: lastClock,
    lastMinutes: lastMinutes,
    chainsText: chainsText,
    chainsValue: chainsValue,
    chains: names,
    noteText: noteText,
    waitText: waitText,
    reasons: reasons,
    buttonText: tr(T, buttonKey),
    buttonDisabled: press === 'starting' || press === 'stopping',
    buttonKind: press === 'mining' ? 'stop' : press === 'stopped' ? 'start' : 'busy'
  }
}

function cardHtml (input, T, esc) {
  T = T || function (k) { return k }
  esc = esc || function (s) { return String(s == null ? '' : s) }
  const m = formatMineHome(input, T)
  const row = (field, label, value, cls) => `<div class="mh-stat" data-field="${field}" aria-label="${esc(label + ' ' + value)}"><span class="lbl">${esc(label)}</span><b class="${cls || ''}">${esc(value)}</b></div>`
  const stats = [
    row('speed', tr(T, 'homeMineSpeedLbl'), m.speedValue, ''),
    row('temp', tr(T, 'homeMineTempLbl'), m.tempValue, m.tempBand ? 'temp-' + m.tempBand : ''),
    row('today', tr(T, 'homeMineTodayLbl'), m.todayValue, ''),
    row('last', tr(T, 'homeMineLastLbl'), m.lastValue, ''),
    row('chains', tr(T, 'homeMineChainsLbl'), m.chainsValue, '')
  ].join('')
  const kind = m.buttonKind === 'stop' ? 'dan' : 'pri'
  const dis = m.buttonDisabled ? ' disabled' : ''
  const note = m.noteText ? `<div class="mh-note" id="homeMineNote">${esc(m.noteText)}</div>` : ''
  return `<section class="mine-home card" id="homeMineCard" aria-label="${esc(tr(T, 'homeMineTitle'))}">
    <div class="mh-top">
      <div class="mh-main">
        <div class="mh-title">${esc(tr(T, 'homeMineTitle'))}</div>
        <div class="mh-status ${m.statusTone}" id="homeMineStatus">${esc(m.statusText)}</div>
      </div>
      <button type="button" class="btn big ${kind}" data-act="homeMine" id="homeMineBtn"${dis}>${esc(m.buttonText)}</button>
    </div>
    <div class="mh-stats">${stats}</div>
    ${note}
  </section>`
}

// 3.1.0 mining page: two devices, one Classic chain each.
// The processor (zminer) can mine Shard1–Shard4 Classic. Shard0 EVM is the graphics-card
// program (rigel). A pool tick stays off only when that shard's live stats say it is down.
// The graphics card can mine Shard0 EVM and one of Shard1–Shard4 Classic (solo node).
// The same Classic chain may run on both devices: the processor uses the pool and the
// graphics card uses its own node. Extra Classic ticks are saved but not started.
// Stop does not clear the saved ticks.
function chainLabel (n) {
  return Number(n) === 0 ? 'Shard0 EVM' : ('Shard' + n + ' Classic')
}

function poolKnownDown (pools, n) {
  if (!pools || typeof pools !== 'object') return false
  const p = pools[n] || pools[String(n)]
  if (!p || p.online == null) return false
  return p.online === false
}

function chainSupport (device, n, caps, pools) {
  n = Number(n)
  const known = !!(caps && (caps.gpu || caps.cpu))
  if (device === 'cpu') {
    if (n === 0) return { ok: false, reasonKey: 'shellOnlyGpu' }
    if (n >= 1 && n <= 4) {
      if (known && caps.cpu && caps.cpu.available === false) return { ok: false, reasonKey: 'shellNoCpu' }
      if (poolKnownDown(pools, n)) return { ok: false, reasonKey: '', poolDown: true }
      return { ok: true, reasonKey: '' }
    }
    return { ok: false, reasonKey: '' }
  }
  if (known && caps.gpu && caps.gpu.available === false) return { ok: false, reasonKey: 'shellNoGpu' }
  if (n === 0 || (n >= 1 && n <= 4)) return { ok: true, reasonKey: '' }
  return { ok: false, reasonKey: '' }
}

function sanitizeChainPick (pick, caps, pools) {
  pick = pick || {}
  const keep = (device, list) => {
    const out = []
    for (const n of list || []) {
      const x = Number(n)
      if (!chainSupport(device, x, caps, pools).ok) continue
      if (out.indexOf(x) < 0) out.push(x)
    }
    out.sort((a, b) => a - b)
    return out
  }
  return { cpu: keep('cpu', pick.cpu), gpu: keep('gpu', pick.gpu) }
}

function defaultChainPick (saved, caps, targets, miners) {
  saved = saved || {}
  targets = targets || {}
  miners = miners || {}
  const gpuAvail = !!(caps && caps.gpu && caps.gpu.available)
  const shardOf = (t, miner) => {
    const n = Number(t && t.shard)
    if (n >= 1 && n <= 4) return n
    const m = Number(miner && miner.shard)
    if (m >= 1 && m <= 4) return m
    return 0
  }
  const cpuShard = shardOf(targets.cpu, miners.classicCpu) || 1
  const gpuShard = shardOf(targets.gpu, miners.classicGpu) || 1
  let cpu = []
  let gpu = []
  if (saved.classic === 'cpu' || (saved.cpu && !saved.classic)) cpu = [cpuShard]
  else if (saved.classic === 'gpu' || saved.classic === 'external') {
    gpu = [gpuShard]
    if (saved.cpu) cpu = [cpuShard]
  } else if (gpuAvail) gpu = [0] // 3.1.3: a graphics card with nothing saved mines Shard0 EVM
  else cpu = [cpuShard]
  if (saved.shard0 && gpu.indexOf(0) < 0) gpu.unshift(0)
  return sanitizeChainPick({ cpu: cpu, gpu: gpu }, caps)
}

// Stop keeps whatever the user ticked.
function selectionAfterStop (pick) {
  const clean = sanitizeChainPick(pick, null)
  return { cpu: clean.cpu.slice(), gpu: clean.gpu.slice() }
}

function jobsForDevice (input) {
  input = input || {}
  const device = input.device === 'gpu' ? 'gpu' : 'cpu'
  const caps = input.caps
  const chains = Array.isArray(input.chains) ? input.chains.map(Number) : []
  const supported = chains.filter(n => chainSupport(device, n, caps, input.pools).ok)
  const classics = supported.filter(n => n >= 1 && n <= 4)
  const notices = []
  const jobs = []
  if (device === 'gpu' && input.hot) {
    notices.push('homeMineHot')
    return { jobs: jobs, notices: notices, blocked: classics.map(n => ({ shard: n, reasonKey: 'homeMineHot' })), cpuFallback: false }
  }
  const solo = device === 'gpu' && input.explicitSolo === true
  const noCard = device === 'gpu' && input.nvidia === false && classics.length > 0
  if (device === 'cpu' && classics.length > 1) notices.push('shellOneClassic')
  if (noCard) notices.push('shellNoNvidiaCpu')
  const addresses = input.addresses || {}
  const blocked = []
  let startedClassic = false
  for (const n of classics) {
    const address = addresses[n] || addresses[String(n)] || ''
    if (noCard) { blocked.push({ shard: n, reasonKey: 'shellNoNvidiaCpu' }); continue }
    if (!address) { notices.push('pickAddr'); blocked.push({ shard: n, reasonKey: 'pickAddr' }); continue }
    if (device === 'cpu') {
      if (startedClassic) { notices.push('shellOneClassic'); blocked.push({ shard: n, reasonKey: 'shellOneClassic' }); continue }
      startedClassic = true
      jobs.push({
        chain: 'classic', backend: 'cpu', gpuMiner: 'classic-node', shard: n, address: String(address),
        action: 'cpu', mineLabel: cpuPoolText(input.zh !== false)
      })
      continue
    }
    const node = (input.nodes && (input.nodes[n] || input.nodes[String(n)])) || {}
    const path = chooseMinePath({
      shard: n,
      nodeSynced: node.synced === true,
      syncPct: node.pct,
      explicitSolo: solo,
      zh: input.zh !== false
    })
    if (path.gpuMiner !== 'zminer-gpu') {
      if (startedClassic) { notices.push('shellOneClassic'); blocked.push({ shard: n, reasonKey: 'shellOneClassic' }); continue }
      startedClassic = true
    }
    const external = path.action === 'mine' && input.saved && input.saved.classic === 'external'
    jobs.push({
      chain: 'classic',
      backend: 'gpu',
      gpuMiner: external ? 'external' : path.gpuMiner,
      shard: n,
      address: String(address),
      syncPct: node.pct,
      nodeSynced: node.synced === true,
      miningMode: solo ? 'solo' : 'pool',
      zh: input.zh !== false,
      mineLabel: path.label,
      action: path.action,
      offerCpu: path.offerCpu === true
    })
  }
  if (!input.skipShard0 && device === 'gpu' && supported.indexOf(0) >= 0) {
    const reward = String(input.reward || addresses[0] || '')
    if (input.gpuBusy) notices.push('homeMineGpuBusy')
    else if (!input.nvidia || !shard0PreflightOk(input.preflight) || !/^0x[0-9a-fA-F]{40}$/.test(reward)) notices.push('shellShard0Wait')
    else jobs.push({ chain: 'shard0', backend: 'gpu', mode: 'mine', address: reward })
  }
  return { jobs: jobs, notices: notices, blocked: blocked, cpuFallback: noCard }
}

function minersForDevice (miners, device) {
  miners = miners || {}
  if (device === 'cpu') return { classicCpu: miners.classicCpu }
  return { shard0: miners.shard0, classicGpu: miners.classicGpu }
}

function gpuPoolUp (g) {
  if (!g) return false
  const list = Array.isArray(g.shards) && g.shards.length ? g.shards : [g]
  return list.some(s => s && s.backend === 'zminer-gpu' && s.mode !== 'node' && procsAlive(s))
}

// Waiting is a live process that has not started hashing. A running flag
// with no child is stopped, so the page cannot sit on 「等待同步」 by itself.
function armedWithProcess (miners) {
  miners = miners || {}
  const one = (m, kind) => processAlive(m) && (liveMiner(m, kind) || waitingSync(m, kind) || procsAlive(m))
  return one(miners.shard0, 'shard0') || one(miners.classicCpu, 'classic') || one(miners.classicGpu, 'classic')
}

function devicePhase (input, device) {
  const press = input && input.press && input.press[device]
  if (press === 'starting' || press === 'stopping') return press
  const miners = minersForDevice(input && input.miners, device)
  if (anyShuttingDown(miners)) return 'stopping'
  if (anyLive(miners)) return 'mining'
  if (device === 'gpu' && gpuPoolUp(miners.classicGpu)) return 'mining'
  if (armedWithProcess(miners)) return 'waiting'
  return 'stopped'
}

function zhUi (T) {
  return tr(T, 'shellMineOff') === '已停止'
}

function deviceTitle (device, T) {
  const cn = zhUi(T)
  if (device === 'cpu') return cn ? 'CPU 挖礦' : 'CPU mining'
  return cn ? 'GPU 挖礦' : 'GPU mining'
}

function viewChains (input) {
  if (input && input.chains && Array.isArray(input.chains.cpu) && Array.isArray(input.chains.gpu)) {
    return sanitizeChainPick(input.chains, input.caps, input && input.pools)
  }
  const miners = input && input.miners
  const saved = input && input.saved
  const inferred = saved && (saved.classic || saved.cpu || saved.shard0) ? saved : inferredSaved(miners)
  return defaultChainPick(inferred, input && input.caps, input && input.targets, miners)
}

function inferredSaved (miners) {
  miners = miners || {}
  const gpu = miners.classicGpu
  const cpu = miners.classicCpu
  const s0 = miners.shard0
  let classic = ''
  if (gpu && gpu.running && gpu.mode !== 'cpu' && gpu.mode !== 'node') classic = gpu.backend === 'external' ? 'external' : 'gpu'
  else if (cpu && cpu.running && cpu.mode !== 'node') classic = 'cpu'
  return {
    classic: classic,
    cpu: !!(cpu && cpu.running && cpu.mode !== 'node'),
    shard0: !!(s0 && s0.running && s0.mode !== 'node' && s0.chain !== 'classic')
  }
}

function deviceModel (input, device, T) {
  const miners = minersForDevice(input && input.miners, device)
  const phase = devicePhase(input, device)
  const view = formatMineHome({
    miners: miners,
    temps: device === 'gpu' ? input.temps : [],
    earnLog: input.earnLog,
    now: input.now,
    phase: phase,
    liveOnly: true
  }, T)
  let status = plainStatus(view, T)
  const known = !!(input && input.caps && (input.caps.gpu || input.caps.cpu))
  const g = (input && input.miners && input.miners.classicGpu)
  if (device === 'gpu' && g && processAlive(g) && g.backend !== 'zminer-gpu' && waitingSync(g, 'classic') && !(g.gpuActive || g.code === 'CLASSIC_GPU')) {
    const pct = syncPctOf(g)
    status = gpuWaitText(g.shard, pct != null ? pct : g.syncPct, zhUi(T))
    view.statusTone = 'wait'
  }
  if (input && input.needChain && input.needChain[device] && view.phase === 'stopped') status = tr(T, 'shellNeedChain')
  else if (device === 'gpu' && view.phase === 'stopped' && input && input.gpuBusy) status = tr(T, 'homeMineGpuBusy')
  else if (device === 'gpu' && view.phase === 'stopped' && known && input.caps.gpu && input.caps.gpu.available === false) {
    status = tr(T, 'shellNoGpu')
    view.buttonDisabled = true
  }
  return { view: view, status: status, phase: view.phase }
}

function earnForAddress (log, address) {
  if (!log || log.certain !== true || !address) return null
  const a = String(address).toLowerCase()
  const items = (log.items || []).filter(e => e && String(e.address || '').toLowerCase() === a)
  return earnOf({ certain: true, items: items })
}

function chainSession (input, device, n) {
  const miners = (input && input.miners) || {}
  if (n === 0) return device === 'gpu' ? miners.shard0 : null
  if (device === 'gpu') {
    const g = miners.classicGpu
    if (g && Array.isArray(g.shards)) {
      const hit = g.shards.find(s => s && Number(s.shard) === Number(n))
      if (hit) return hit
    }
    if (g && Number(g.shard) === Number(n)) return g
    return null
  }
  const m = miners.classicCpu
  if (m && Number(m.shard) === Number(n)) return m
  return null
}

// One plain line for one device.
// Waiting keeps the chain and percent. A busy graphics card replaces 「已停止」.
function plainStatus (m, T) {
  if (m.phase === 'starting') return tr(T, 'shellMineStarting')
  if (m.phase === 'stopping') return tr(T, 'shellMineStopping')
  if (m.phase === 'mining') return tr(T, 'shellMineOn')
  if (m.phase === 'waiting') return m.waitText ? tr(T, 'shellMineWait', { detail: m.waitText }) : tr(T, 'shellMineWaitPlain')
  if (m.noteText) return m.noteText
  return tr(T, 'shellMineOff')
}

function mineDevButton (device, m, esc, huge) {
  const kind = m.buttonKind === 'stop' ? 'stop' : 'start'
  const dis = m.buttonDisabled ? ' disabled' : ''
  const id = device === 'cpu' ? 'homeMineCpu' : 'homeMineGpu'
  const cls = huge ? 'shell-mine shell-huge' : 'shell-mine'
  return `<button type="button" class="${cls} ${kind}" data-act="homeMineDev" data-dev="${device}" id="${id}"${dis}>${esc(m.buttonText)}</button>`
}

function foldSummary (title) {
  return `<summary><span class="fold-shut">\u25B8</span><span class="fold-open">\u25BE</span> ${title}</summary>`
}

function reportedRate (m) {
  if (!m || m.hashrateSource === 'pool' || m.mode === 'node') return null
  const zpow = m.backend === 'zminer-gpu' || m.backend === 'zminer' || m.mode === 'cpu'
  if (!zpow) return null
  if (m.rateSeen === false) return null
  const n = num(m.hashrate)
  return n
}

function zpowSessions (miners, device) {
  miners = miners || {}
  const out = []
  if (device === 'cpu') {
    const m = miners.classicCpu
    if (m && m.mode !== 'node' && processAlive(m)) out.push(m)
    return out
  }
  const g = miners.classicGpu
  const list = g && Array.isArray(g.shards) && g.shards.length ? g.shards : (g ? [g] : [])
  for (const s of list) {
    if (s && s.backend === 'zminer-gpu' && s.mode !== 'node' && processAlive(s)) out.push(s)
  }
  return out
}

function rateOfList (list) {
  let sum = 0
  let any = false
  for (const m of list || []) {
    const n = reportedRate(m)
    if (n == null) continue
    any = true
    if (n > 0) sum += n
  }
  return any ? sum : null
}

function sessionEarnText (list, T) {
  let shares = 0
  let paid = 0
  let anyShare = false
  let anyPay = false
  let exposed = false
  for (const m of list || []) {
    const e = m && m.sessionEarn
    if (!e || e.exposed !== true) continue
    exposed = true
    if (e.shares != null && Number.isFinite(Number(e.shares))) { shares += Number(e.shares); anyShare = true }
    const pay = e.paid != null ? Number(e.paid) : (e.earned != null ? Number(e.earned) : null)
    if (pay != null && Number.isFinite(pay)) { paid += pay; anyPay = true }
  }
  if (!exposed) return null
  const parts = []
  if (anyShare) parts.push(tr(T, 'sessionEarnShares', { n: String(shares) }))
  if (anyPay) parts.push(tr(T, 'sessionEarnPaid', { n: scdoCount(paid) }))
  return parts.length ? parts.join(' · ') : DASH
}

function reportedShares (m) {
  if (!m || m.sharesSeen !== true) return null
  const n = num(m.sharesAccepted)
  return n == null ? null : n
}

function chainPickHtml (device, picked, other, caps, T, esc, pools, open, input) {
  const supported = [0, 1, 2, 3, 4].filter(n => chainSupport(device, n, caps, pools).ok)
  const allOn = supported.length > 0 && supported.every(n => picked.indexOf(n) >= 0)
  const boxes = [0, 1, 2, 3, 4].map(n => {
    const sup = chainSupport(device, n, caps, pools)
    const on = sup.ok && picked.indexOf(n) >= 0
    const down = sup.poolDown ? (zhUi(T) ? ('Shard' + n + ' 礦池暫時連不上') : ('Shard' + n + ' pool cannot be reached right now')) : ''
    const why = sup.ok ? '' : ` <span class="mine-why">${esc(down || tr(T, sup.reasonKey))}</span>`
    const label = `<label class="mine-chain${sup.ok ? '' : ' off'}"><input type="checkbox" data-act="mineChain" data-dev="${device}" data-v="${n}"${on ? ' checked' : ''}${sup.ok ? '' : ' disabled'}> ${esc(chainLabel(n))}${why}</label>`
    return `<div class="mine-chain-row">${label}${chainExpandHtml(input, device, n, T, esc, pools)}</div>`
  }).join('')
  const shared = picked.filter(n => n >= 1 && other.indexOf(n) >= 0)
  const note = shared.length ? `<div class="mine-note">${esc(tr(T, 'shellBothMine'))}</div>` : ''
  const many = device === 'cpu' && picked.filter(n => n >= 1).length > 1 ? `<div class="mine-note">${esc(tr(T, 'shellOneClassic'))}</div>` : ''
  const pickOpen = open ? ' open' : ''
  return `<details class="shell-fold" id="minePick-${device}"${pickOpen}>${foldSummary(esc(tr(T, 'shellPickChains')))}
      <label class="mine-chain"><input type="checkbox" data-act="mineChain" data-dev="${device}" data-v="all"${allOn ? ' checked' : ''}${supported.length ? '' : ' disabled'}> ${esc(tr(T, 'shellPickAll'))}</label>
      ${boxes}${note}${many}
    </details>`
}

function chainExpandHtml (input, device, n, T, esc, pools) {
  const session = input ? chainSession(input, device, n) : null
  const alive = !!(session && processAlive(session) && session.mode !== 'node')
  const rate = reportedRate(session)
  let state = tr(T, 'shellMineOff')
  if (alive && (session.backend === 'zminer-gpu' || session.backend === 'zminer' || session.mode === 'cpu')) state = rate == null ? tr(T, 'shellBoot') : tr(T, 'shellMineOn')
  else if (alive && (session.phase === 'mining' || session.code === 'CLASSIC_GPU' || session.code === 'CLASSIC_MINING' || session.gpuActive)) state = tr(T, 'shellMineOn')
  else if (alive && stillSyncing(session)) state = tr(T, 'shellMineWaitPlain')
  else if (alive) state = tr(T, 'shellMineStarting')
  const speed = rate == null ? DASH : tr(T, 'islePerSec', { n: Math.round(rate).toLocaleString('en-US') })
  const sharesN = reportedShares(session)
  const shares = sharesN == null ? DASH : String(sharesN)
  const local = session && knownHeight(session.localBlock) != null ? String(Math.round(knownHeight(session.localBlock))) : DASH
  const pool = pools && (pools[n] || pools[String(n)])
  const diff = pool && pool.network_difficulty != null && pool.network_difficulty !== '' ? String(pool.network_difficulty) : DASH
  const row = (k, v) => `<div class="mine-kv"><span>${esc(k)}</span><b class="${v === DASH ? 'dash' : ''}">${esc(v)}</b></div>`
  return `<details class="mine-x" id="mineX-${device}-${n}">${foldSummary('')}
      <div class="mine-x-body">
        ${row(tr(T, 'shellStat'), state)}
        ${row(tr(T, 'homeMineSpeedLbl'), speed)}
        ${row(tr(T, 'shellShares'), shares)}
        ${row(tr(T, 'shellLocalH'), local)}
        ${row(tr(T, 'shellDiff'), diff)}
      </div>
    </details>`
}

function chainDetailHtml (input, device, n, T, esc) {
  const addresses = (input && input.addresses) || {}
  const address = addresses[n] || addresses[String(n)] || ''
  const session = chainSession(input, device, n)
  const held = input && input.mineRows && (input.mineRows[n] || input.mineRows[String(n)])
  const zh = zhUi(T)
  let state = tr(T, 'shellMineOff')
  let waitingRow = false
  const gpuRunning = device === 'gpu' && n >= 1 && session && session.mode !== 'node' && session.mode !== 'cpu' && procsAlive(session)
  const poolGpu = gpuRunning && session.backend === 'zminer-gpu'
  const behind = gpuRunning && !poolGpu ? heightsBehind(session) : null
  const miningNow = gpuRunning && !poolGpu && (session.gpuActive || session.code === 'CLASSIC_GPU' || (behind === false && (session.phase === 'mining' || session.code === 'CLASSIC_GPU')))
  if (device === 'cpu' && n >= 1 && session && session.mode !== 'node' && (session.running || procsAlive(session))) {
    state = cpuPoolText(zh)
  } else if (poolGpu || (!gpuRunning && held && held.action === 'pool' && device === 'gpu')) {
    state = shownPoolLabel(zh, held, session)
  } else if (miningNow || (gpuRunning && behind === false && (held && held.action === 'mine'))) {
    state = gpuMineText(zh)
  } else if (gpuRunning && (behind === true || session.phase === 'syncing' || session.paused || session.code === 'CLASSIC_SYNCING' || session.code === 'CLASSIC_PAUSED' || (held && held.action === 'sync' && behind !== false))) {
    const pct = syncPctOf(session)
    const shown = pct != null ? pct : session.syncPct
    state = gpuWaitText(n, shown, zh)
    waitingRow = true
  } else if (held && held.action === 'sync') {
    state = held.label || gpuWaitText(n, held.syncPct, zh)
    waitingRow = true
  } else if (held && held.action === 'mine') {
    state = held.label || gpuMineText(zh)
  } else if (held && held.action === 'cpu') {
    state = held.label || cpuPoolText(zh)
  } else if (held && held.action === 'pool') state = shownPoolLabel(zh, held, session)
  else if (held && held.label && held.action === 'solo') state = held.label
  else if (held && held.reason) state = held.reason
  else if (held && held.reasonKey) state = tr(T, held.reasonKey)
  else if (session && ((n === 0 && liveMiner(session, 'shard0')) || (n >= 1 && liveMiner(session, 'classic')))) state = tr(T, 'shellMineOn')
  else if (session && processAlive(session) && ((n === 0 && waitingSync(session, 'shard0')) || (n >= 1 && waitingSync(session, 'classic')))) {
    const pct = syncPctOf(session)
    state = pct == null ? tr(T, 'shellMineWaitPlain') : tr(T, 'shellMineWait', { detail: chainLabel(n) + ' ' + pct + '%' })
    waitingRow = n >= 1 && device === 'gpu'
  }
  const workKind = n === 0 ? 'shard0' : 'classic'
  const working = session && producingWork(session, workKind)
  const speedN = working ? sessionHashrate(session) : null
  const speed = speedN == null ? DASH : tr(T, 'islePerSec', { n: Math.round(speedN).toLocaleString('en-US') })
  const earn = working ? earnForAddress(input && input.earnLog, address) : null
  let today = DASH
  let last = DASH
  if (earn) {
    today = scdoCount(earn.todayScdo) + ' SCDO'
    if (earn.last != null) last = tr(T, 'homeMineLastVal', { t: clockText(earn.last), ago: tr(T, 'homeMineAgo', { n: minutesAgo(earn.last, input.now == null ? Date.now() : input.now) }) })
  }
  let pct = session ? syncPctOf(session) : null
  if (pct == null && session && session.running && session.syncPct != null && Number.isFinite(Number(session.syncPct))) pct = Math.round(Number(session.syncPct))
  const sync = pct == null ? DASH : (pct + '%')
  const pool = input && input.pools && (input.pools[n] || input.pools[String(n)])
  const height = !pool || pool.online == null ? DASH : (pool.online && pool.chain_height != null ? String(pool.chain_height) : (zh ? '未連接' : 'Not connected'))
  const links = !pool || pool.online == null ? DASH : (pool.online && pool.connections != null ? String(pool.connections) : (zh ? '未連接' : 'Not connected'))
  const addr = address || DASH
  let mode = DASH
  if (n >= 1 && device === 'cpu') mode = cpuPoolText(zh)
  else if (n >= 1 && device === 'gpu') mode = waitingRow ? state : (poolGpu || (held && held.action === 'pool') ? shownPoolLabel(zh, held, session) : (gpuRunning || (held && held.action === 'mine') ? gpuMineText(zh) : tr(T, 'poolLocal')))
  else if (n === 0) mode = session && session.mode === 'pool' ? tr(T, 'poolEndpoint') : tr(T, 'poolLocal')
  const row = (k, v, cls) => `<div class="mine-kv"><span>${esc(k)}</span><b${cls ? ' class="' + cls + '"' : ''}>${esc(v)}</b></div>`
  const title = state === tr(T, 'shellMineOff') ? chainLabel(n) : (chainLabel(n) + ' · ' + state)
  const cpu = input && input.miners && input.miners.classicCpu
  const cpuHere = cpu && cpu.running && cpu.mode !== 'node' && Number(cpu.shard) === Number(n)
  const hint = waitingRow && address && !cpuHere
    ? `<button type="button" class="shell-hint" data-act="mineCpuFirst" data-shard="${n}" data-addr="${esc(address)}">${esc(tr(T, 'shellCpuFirst'))}</button>`
    : ''
  return `<details class="shell-fold" id="mineChain-${device}-${n}">${foldSummary(esc(title))}
      ${row(tr(T, 'shellStat'), state, waitingRow ? 'wait' : '')}
      ${row(tr(T, 'homeMineSpeedLbl'), speed)}
      ${row(tr(T, 'homeMineTodayLbl'), today)}
      ${row(tr(T, 'shellLast'), last)}
      ${row(tr(T, 'd_sync'), sync)}
      ${row(tr(T, 'd_addr'), addr)}
      ${n >= 1 ? row(tr(T, 'shellHeight'), height) : ''}
      ${n >= 1 ? row(tr(T, 'shellLinks'), links) : ''}
      ${row(tr(T, 'poolEndpoint'), mode, waitingRow ? 'wait' : '')}
      ${hint}
    </details>`
}

function homeLine (input, T) {
  input = input || {}
  const miners = input.miners || {}
  const gpu = miners.classicGpu
  const cpu = miners.classicCpu
  const s0 = miners.shard0
  const press = input.press || {}
  let base
  if (press.gpu === 'starting' || press.cpu === 'starting' || input.phase === 'starting') base = tr(T, 'homeLineStarting')
  else if (press.gpu === 'stopping' || press.cpu === 'stopping' || input.phase === 'stopping') base = tr(T, 'homeLineStopping')
  else if (gpuPoolUp(gpu)) base = tr(T, 'homeLineGpuPool')
  else {
    const gpuOn = gpu && gpu.mode !== 'node' && gpu.mode !== 'cpu' && processAlive(gpu)
    if (gpuOn && waitingSync(gpu, 'classic') && !(gpu.gpuActive || gpu.code === 'CLASSIC_GPU')) {
      const pct = syncPctOf(gpu)
      base = gpuWaitText(gpu.shard, pct != null ? pct : gpu.syncPct, zhUi(T))
    } else if (gpuOn && (gpu.gpuActive || gpu.code === 'CLASSIC_GPU' || gpu.phase === 'mining')) base = tr(T, 'homeLineGpuMine')
    else if (input.gpuBusy && !gpuOn) base = tr(T, 'homeMineGpuBusy')
    else if (cpu && cpu.mode !== 'node' && (cpu.running || procsAlive(cpu))) base = tr(T, 'homeLineCpuPool')
    else if (s0 && s0.mode !== 'node' && (s0.running || procsAlive(s0))) base = tr(T, 'homeLineShard0')
    else base = tr(T, 'homeLineIdle')
  }
  return base
}

function heightTicker (pools) {
  const parts = []
  for (const n of [1, 2, 3, 4]) {
    const p = pools && (pools[n] || pools[String(n)])
    const known = p && p.online !== false && p.chain_height != null && p.chain_height !== ''
    parts.push('Shard' + n + ' ' + (known ? String(p.chain_height) : DASH))
  }
  return parts.join(' · ')
}

function devicePanel (input, device, picked, other, T, esc, huge) {
  const model = deviceModel(input, device, T)
  const tempCls = model.view.tempBand ? ' temp-' + model.view.tempBand : ''
  const temp = device === 'gpu' ? `<div class="mine-temp"><span>${esc(tr(T, 'shellTemp'))}</span> <b class="shell-temp${tempCls}">${esc(model.view.tempValue)}</b></div>` : ''
  const rows = picked.map(n => chainDetailHtml(input, device, n, T, esc)).join('')
  const fallback = device === 'gpu' && input && input.gpuFallback
    ? `<p class="mine-note">${esc(tr(T, 'shellNoNvidiaCpu'))}</p><button type="button" class="shell-hint" data-act="mineCpuInstead">${esc(tr(T, 'shellUseCpu'))}</button>`
    : ''
  const needPick = !!(input && input.needChain && input.needChain[device] && model.phase === 'stopped')
  const needNote = needPick ? `<p class="mine-note" id="mineNeed-${device}">${esc(tr(T, 'shellNeedChain'))}</p>` : ''
  const zpow = zpowSessions(input && input.miners, device)
  let load = ''
  if (zpow.length && model.phase !== 'stopped' && model.phase !== 'stopping') {
    const rate = rateOfList(zpow)
    model.status = rate == null ? tr(T, 'shellBoot') : tr(T, 'shellMineOn')
    model.view.statusTone = rate == null ? 'busy' : 'on'
    const rateText = rate == null ? DASH : tr(T, 'islePerSec', { n: Math.round(rate).toLocaleString('en-US') })
    const earn = sessionEarnText(zpow, T)
    const earnText = earn == null ? DASH : earn
    const mode = rate == null ? 'wait' : 'run'
    load = `<div class="mine-load ${mode}" data-mine-load="${device}"><div class="mine-load-bar"></div></div>
      <div class="mine-rate">${esc(tr(T, 'homeMineSpeedLbl'))} <b class="${rate == null ? 'dash' : ''}">${esc(rateText)}</b></div>
      <div class="mine-earn">${esc(tr(T, 'sessionEarn'))} <b class="${earnText === DASH ? 'dash' : ''}">${esc(earnText)}</b></div>`
  }
  const html = `<section class="mine-panel" data-dev="${device}">
      <h2>${esc(deviceTitle(device, T))}</h2>
      <div class="mine-glance mh-status ${model.view.statusTone}" data-dev-status="${device}"><span class="mine-dot" aria-hidden="true"></span><span class="mine-glance-t">${esc(model.status)}</span></div>
      ${load}
      <div class="shell-huge-wrap">${mineDevButton(device, model.view, esc, huge)}</div>
      ${fallback}
      ${needNote}
      ${chainPickHtml(device, picked, other, input && input.caps, T, esc, input && input.pools, needPick, input)}
    </section>`
  return { html: html, rows: rows, temp: temp }
}

function stripHtml (input, T, esc) {
  T = T || function (k) { return k }
  esc = esc || function (s) { return String(s == null ? '' : s) }
  const row = (device) => {
    const model = deviceModel(input, device, T)
    return `<div class="mine-dev" data-dev="${device}"><span class="mine-dev-name">${esc(deviceTitle(device, T))}</span><div class="mh-status ${model.view.statusTone}" data-dev-status="${device}">${esc(model.status)}</div>${mineDevButton(device, model.view, esc, false)}</div>`
  }
  return `<div class="mine-strip-in mine-strip-two" id="homeMineCard">${row('cpu')}${row('gpu')}</div>`
}

function minePageHtml (input, T, esc, extra) {
  T = T || function (k) { return k }
  esc = esc || function (s) { return String(s == null ? '' : s) }
  const pick = viewChains(input)
  const cpu = devicePanel(input, 'cpu', pick.cpu, pick.gpu, T, esc, true)
  const gpu = devicePanel(input, 'gpu', pick.gpu, pick.cpu, T, esc, true)
  return `<div class="page shell-mine-page" id="minePage">
    <h1 class="shell-h">${esc(tr(T, 'navMine'))}</h1>
    <div class="mine-panels">
      ${cpu.html}
      ${gpu.html}
    </div>
    <details class="shell-fold" id="mineAdvFold">${foldSummary(esc(tr(T, 'shellAdvanced')))}
      ${extra || ''}
      ${gpu.temp}
      ${cpu.rows}
      ${gpu.rows}
    </details>
  </div>`
}

const api = { DASH, REWARD_SCDO, TX_PAGE, tempBand, chainNames, reduceMinePhase, planDeviceClick, processAlive, deviceProcessAlive, devicePhase, STOP_DEADLINE_MS, START_DEADLINE_MS, jobsForHome, choiceAfterStop, shard0PreflightOk, formatMineHome, cardHtml, stripHtml, minePageHtml, homeLine, heightTicker, plainStatus, clockText, minutesAgo, earnOf, confirmedEarnLog, chainSupport, sanitizeChainPick, defaultChainPick, selectionAfterStop, jobsForDevice, chooseMinePath, gpuWaitText, nodeSyncOf, syncPctOf, stillSyncing, producingWork, deviceTitle, shuttingDown, shard0NeedsStop, waitReason }
if (typeof module !== 'undefined' && module.exports) module.exports = api
if (typeof window !== 'undefined') window.SCDOMineHome = Object.freeze(api)
})()
