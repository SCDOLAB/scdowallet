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

// Tries per second from this session. The pool stat is the speed a Classic graphics-card
// session reports when the process itself has not copied a number onto hashrate yet.
function sessionHashrate (m) {
  if (!m) return null
  const direct = num(m.hashrate)
  if (direct != null && direct > 0) return direct
  const pool = m.poolStats
  const fromPool = num(pool && (pool.hashrate != null ? pool.hashrate : pool.hashrate_hs))
  if (fromPool != null && fromPool > 0) return fromPool
  return null
}

function hashing (m, kind) {
  if (!m || m.mode === 'node') return false
  if (kind === 'shard0' && m.chain === 'classic') return false
  if (kind === 'classic' && m.chain && m.chain !== 'classic') return false
  return procsAlive(m) && sessionHashrate(m) != null
}

function liveMiner (m, kind) {
  if (!hashing(m, kind)) return false
  if (m.mode !== 'cpu' && stillSyncing(m)) return false
  return true
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

function chainNames (miners) {
  miners = miners || {}
  const out = []
  if (liveMiner(miners.shard0, 'shard0')) out.push('Shard0 EVM')
  const shards = []
  for (const m of [miners.classicCpu, miners.classicGpu]) {
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
  const list = [
    [miners.shard0, 'shard0'],
    [miners.classicCpu, 'classic'],
    [miners.classicGpu, 'classic']
  ]
  for (const pair of list) {
    const m = pair[0]
    if (!hashing(m, pair[1])) continue
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

function stillSyncing (m) {
  if (!m) return false
  if (m.phase === 'syncing' || m.paused) return true
  if (m.code === 'CLASSIC_SYNCING' || m.code === 'CLASSIC_PAUSED' || m.code === 'CLASSIC_CHECKING' || m.code === 'CLASSIC_STARTING' || m.code === 'SYNCING') return true
  const local = knownHeight(m.localBlock)
  const network = knownHeight(m.networkBlock)
  if (local == null || network == null) return false
  return network - local > BEHIND_BLOCKS
}

function waitingSync (m, kind) {
  if (!m || liveMiner(m, kind) || m.mode === 'node' || m.mode === 'cpu') return false
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
  if (anyLive(miners)) return 'mining'
  if (p === 'mining' || anyArmed(miners)) return 'waiting'
  return 'stopped'
}

function buttonPhase (input) {
  const p = input && input.phase
  if (p === 'starting' || p === 'stopping') return p
  return statusPhase(input) === 'stopped' ? 'stopped' : 'mining'
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
  return p
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

function waitDetail (sessions, T) {
  const sep = tr(T, 'd_listSep')
  return sessions.map(s => {
    const pct = syncPctOf(s.m)
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

// One plain line for the 3.1.0 home strip and mining page.
// Waiting keeps the chain and percent. A busy graphics card replaces 「已停止」.
function plainStatus (m, T) {
  if (m.phase === 'starting') return tr(T, 'shellMineStarting')
  if (m.phase === 'stopping') return tr(T, 'shellMineStopping')
  if (m.phase === 'mining') return tr(T, 'shellMineOn')
  if (m.phase === 'waiting') return m.waitText ? tr(T, 'shellMineWait', { detail: m.waitText }) : tr(T, 'shellMineWaitPlain')
  if (m.noteText) return m.noteText
  return tr(T, 'shellMineOff')
}

function mineButton (m, esc) {
  const kind = m.buttonKind === 'stop' ? 'stop' : 'start'
  const dis = m.buttonDisabled ? ' disabled' : ''
  return `<button type="button" class="shell-mine ${kind}" data-act="homeMine" id="homeMineBtn"${dis}>${esc(m.buttonText)}</button>`
}

function stripHtml (input, T, esc) {
  T = T || function (k) { return k }
  esc = esc || function (s) { return String(s == null ? '' : s) }
  const m = formatMineHome(input, T)
  return `<div class="mine-strip-in" id="homeMineCard"><div class="mh-status ${m.statusTone}" id="homeMineStatus">${esc(plainStatus(m, T))}</div>${mineButton(m, esc)}</div>`
}

function minePageHtml (input, T, esc) {
  T = T || function (k) { return k }
  esc = esc || function (s) { return String(s == null ? '' : s) }
  const m = formatMineHome(input, T)
  const tempCls = m.tempBand ? ' temp-' + m.tempBand : ''
  return `<div class="page shell-mine-page" id="minePage">
    <h1 class="shell-h">${esc(tr(T, 'navMine'))}</h1>
    <div class="shell-huge-wrap">${mineButton(m, esc).replace('shell-mine', 'shell-mine shell-huge')}</div>
    <div class="mh-status ${m.statusTone}" id="homeMineStatus">${esc(plainStatus(m, T))}</div>
    <div class="shell-sub">
      <div><span>${esc(tr(T, 'shellToday'))}</span><b>${esc(m.todayValue)}</b></div>
      <div><span>${esc(tr(T, 'shellTemp'))}</span><b class="shell-temp${tempCls}">${esc(m.tempValue)}</b></div>
    </div>
    <details class="shell-fold" id="mineAdvFold"><summary><span class="fold-shut">\u25B8</span><span class="fold-open">\u25BE</span> ${esc(tr(T, 'shellAdvanced'))}</summary>
      <button type="button" class="shell-adv" data-act="nav" data-v="mineSet">${esc(tr(T, 'shellAdvanced'))}</button>
    </details>
  </div>`
}

const api = { DASH, REWARD_SCDO, TX_PAGE, tempBand, chainNames, reduceMinePhase, jobsForHome, choiceAfterStop, shard0PreflightOk, formatMineHome, cardHtml, stripHtml, minePageHtml, plainStatus, clockText, minutesAgo, earnOf, confirmedEarnLog }
if (typeof module !== 'undefined' && module.exports) module.exports = api
if (typeof window !== 'undefined') window.SCDOMineHome = Object.freeze(api)
})()
