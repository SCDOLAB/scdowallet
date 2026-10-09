// SCDO Wallet 3.0.9: the Home mining card. Pure functions (no DOM, no IPC).
// Numbers come only from the miner, temperature and earnings objects passed in.
// A missing reading is a dash. Nothing here invents a sample speed, temperature or payout.
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

function shard0On (m) {
  return !!(m && m.running && m.mode !== 'node' && m.chain !== 'classic')
}

function classicOn (m) {
  return !!(m && m.running && m.mode !== 'node')
}

function anyOn (miners) {
  miners = miners || {}
  return shard0On(miners.shard0) || classicOn(miners.classicCpu) || classicOn(miners.classicGpu)
}

function gpuOn (miners) {
  miners = miners || {}
  if (shard0On(miners.shard0)) return true
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
  if (shard0On(miners.shard0)) out.push('Shard0 EVM')
  const shards = []
  for (const m of [miners.classicCpu, miners.classicGpu]) {
    if (!classicOn(m)) continue
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
  const list = [miners.shard0, miners.classicCpu, miners.classicGpu]
  for (const m of list) {
    if (!m || !m.running) continue
    if (m === miners.shard0 && !shard0On(m)) continue
    if (m !== miners.shard0 && !classicOn(m)) continue
    const n = num(m.hashrate)
    if (n != null && n > 0) { sum += n; any = true }
  }
  return any ? Math.round(sum) : null
}

function earnOf (log, now) {
  if (log == null) return null
  const items = Array.isArray(log) ? log : (Array.isArray(log.items) ? log.items : null)
  if (!items) return null
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const from = start.getTime()
  let today = 0
  let last = null
  for (const e of items) {
    if (!e) continue
    const t = num(e.t)
    if (t == null) continue
    if (t >= from) today++
    if (last == null || t > last) last = t
  }
  return { todayScdo: today * REWARD_SCDO, last: last }
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

function shownPhase (input) {
  const p = input && input.phase
  if (p === 'starting' || p === 'stopping' || p === 'mining' || p === 'stopped') return p
  return anyOn(input && input.miners) ? 'mining' : 'stopped'
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

// Which miners a Home click should start, from the saved backend and addresses.
// An empty configuration returns no jobs. A hot graphics card keeps only a processor job.
function jobsForHome (input) {
  input = input || {}
  const backendName = input.backend === 'gpu' || input.backend === 'external' ? input.backend : 'cpu'
  const backend = backendName === 'cpu' ? 'cpu' : 'gpu'
  const gpuMiner = backendName === 'external' ? 'external' : 'classic-node'
  const caps = input.caps
  const classic = input.classic
  let classicAllowed = true
  if (caps) {
    if (backendName === 'cpu') classicAllowed = !!(caps.cpu && caps.cpu.available)
    else if (backendName === 'external') classicAllowed = !!(caps.external && caps.external.available)
    else classicAllowed = !!(caps.gpu && caps.gpu.available)
  }
  const jobs = []
  const shard = classic ? Number(classic.shard) : 0
  if (classicAllowed && classic && classic.address && shard >= 1 && shard <= 4) {
    jobs.push({ chain: 'classic', backend: backend, gpuMiner: gpuMiner, shard: shard, address: String(classic.address) })
  }
  const reward = String(input.reward || '')
  if (input.nvidia && /^0x[0-9a-fA-F]{40}$/.test(reward)) {
    jobs.push({ chain: 'shard0', backend: 'gpu', mode: 'mine', address: reward })
  }
  if (input.hot) return jobs.filter(j => j.chain === 'classic' && j.backend === 'cpu')
  return jobs
}

function formatMineHome (input, T) {
  input = input || {}
  T = T || function (k) { return k }
  const miners = input.miners || {}
  const phase = shownPhase(input)
  const sep = tr(T, 'd_listSep')
  const statusKey = phase === 'starting' ? 'homeMineStarting' : phase === 'stopping' ? 'homeMineStopping' : phase === 'mining' ? 'homeMineOn' : 'homeMineOff'
  const tone = phase === 'mining' ? 'on' : phase === 'stopped' ? 'off' : 'busy'
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
    const todayN = earn.todayScdo.toLocaleString('en-US')
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
  const buttonKey = phase === 'starting' ? 'homeMineBtnStarting' : phase === 'stopping' ? 'homeMineBtnStopping' : phase === 'mining' ? 'homeMineStop' : 'homeMineStart'
  return {
    phase: phase,
    statusText: tr(T, statusKey),
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
    buttonText: tr(T, buttonKey),
    buttonDisabled: phase === 'starting' || phase === 'stopping',
    buttonKind: phase === 'mining' ? 'stop' : phase === 'stopped' ? 'start' : 'busy'
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
  return `<section class="mine-home card" id="homeMineCard" aria-label="${esc(tr(T, 'homeMineTitle'))}">
    <div class="mh-top">
      <div class="mh-main">
        <div class="mh-title">${esc(tr(T, 'homeMineTitle'))}</div>
        <div class="mh-status ${m.statusTone}" id="homeMineStatus">${esc(m.statusText)}</div>
      </div>
      <button type="button" class="btn big ${kind}" data-act="homeMine" id="homeMineBtn"${dis}>${esc(m.buttonText)}</button>
    </div>
    <div class="mh-stats">${stats}</div>
  </section>`
}

const api = { DASH, REWARD_SCDO, tempBand, chainNames, reduceMinePhase, jobsForHome, formatMineHome, cardHtml, clockText, minutesAgo, earnOf }
if (typeof module !== 'undefined' && module.exports) module.exports = api
if (typeof window !== 'undefined') window.SCDOMineHome = Object.freeze(api)
})()
