// Compact status island: Classic shards 1–4 first, then Shard0.
// Sync, mining, GPU temperature, block earnings, and the selected balance.
'use strict'
;(function () {
const BLOCK_REWARD_SCDO = 2
const BEHIND_BLOCKS = 8

function num (v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function isCpu (m) {
  return !!(m && (m.mode === 'cpu' || m.code === 'CLASSIC_MINING'))
}

function isGpuMine (m) {
  if (!m || m.mode === 'node' || isCpu(m)) return false
  return true
}

function miningNow (m) {
  return !!(m && (m.code === 'MINING' || m.code === 'CLASSIC_MINING' || m.code === 'CLASSIC_GPU'))
}

// 0 is what a miner reports before it has a height. It is not block 0.
function knownHeight (v) {
  const n = num(v)
  return n != null && n > 0 ? n : null
}

function syncOf (m) {
  if (!m || !m.running) return { kind: 'off' }
  if (isCpu(m) && m.localBlock == null && m.networkBlock == null) return { kind: 'pool' }
  const local = knownHeight(m.localBlock)
  const network = knownHeight(m.networkBlock)
  const reported = m.localBlock != null || m.networkBlock != null
  if (local == null || network == null) {
    if (reported) return { kind: 'pending', local, network }
    return { kind: 'checking' }
  }
  if (network - local <= BEHIND_BLOCKS) return { kind: 'synced', local, network }
  return { kind: 'syncing', local, network, etaSec: num(m.syncEtaSec) }
}

function groupNum (n) {
  const x = Math.trunc(Number(n))
  if (!Number.isFinite(x)) return String(n)
  return x.toLocaleString('en-US')
}

function trimFixed (v, digits) {
  return Number(v).toFixed(digits).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1')
}

// 3022193 → 3.02M. Small heights stay grouped so 100/200 still reads as heights.
function compactCount (n) {
  const x = Number(n)
  if (!Number.isFinite(x)) return String(n)
  const ax = Math.abs(x)
  if (ax >= 1e6) return trimFixed(x / 1e6, ax >= 1e8 ? 1 : 2) + 'M'
  if (ax >= 10000) return trimFixed(x / 1e3, ax >= 1e5 ? 0 : 1) + 'k'
  return groupNum(x)
}

// 17400000 → 17.4MH, 5100 → 5.1kH, 31000000 → 31MH. No "/s", so three miners fit.
function compactHash (h) {
  const n = Number(h)
  if (!Number.isFinite(n) || n <= 0) return ''
  const units = ['H', 'kH', 'MH', 'GH']
  let i = 0
  let v = n
  while (v >= 1000 && i < 3) { v /= 1000; i++ }
  const digits = v >= 100 ? 0 : (v >= 10 ? 1 : 2)
  return trimFixed(v, digits) + units[i]
}

// Hours drop the leftover minutes once the wait is long: 107h, not "107 小時 6 分鐘".
function compactEta (sec) {
  const n = Number(sec)
  if (sec == null || !Number.isFinite(n) || n < 0) return ''
  const s = Math.round(n)
  if (s < 60) return s + 's'
  const mins = Math.round(s / 60)
  if (mins < 60) return mins + 'm'
  const h = Math.floor(mins / 60)
  const rm = mins % 60
  if (h >= 10 || !rm) return h + 'h'
  return h + 'h' + rm + 'm'
}

function farBehind (sync) {
  if (!sync || sync.local == null || sync.network == null) return false
  return Number(sync.network) - Number(sync.local) > BEHIND_BLOCKS
}

function syncProgress (sync) {
  if (!sync || sync.local == null || sync.network == null || !(Number(sync.network) > 0)) return 0
  return Math.max(0, Math.min(1, Number(sync.local) / Number(sync.network)))
}

function tempBand (c) {
  if (c == null || !Number.isFinite(Number(c))) return ''
  if (Number(c) >= 85) return 'hot'
  if (Number(c) >= 70) return 'warm'
  return 'ok'
}

// A few seconds is not an ETA while millions of blocks remain. Say 計算中.
function panelEta (sync, tr, etaText) {
  if (sync.etaSec == null || (farBehind(sync) && Number(sync.etaSec) < 5)) return tr('isleCalc')
  let text = etaText ? etaText(sync.etaSec) : compactEta(sync.etaSec)
  if (farBehind(sync) && (text === '即將完成' || text === 'almost done')) return tr('isleCalc')
  return text || tr('isleCalc')
}

function etaLabel (sync, tr) {
  if (!sync || sync.kind !== 'syncing') return ''
  if (sync.etaSec == null || (farBehind(sync) && Number(sync.etaSec) < 5)) return tr('isleCalc')
  return compactEta(sync.etaSec) || tr('isleCalc')
}

function heightPair (local, network, compact) {
  const fmt = compact ? compactCount : groupNum
  const loc = local != null ? fmt(local) : '…'
  const net = network != null ? fmt(network) : '…'
  return loc + '/' + net
}

function syncText (sync, tr, etaText) {
  if (!sync || sync.kind === 'off') return tr('isleOff')
  if (sync.kind === 'pool') return tr('islePool')
  if (sync.kind === 'checking') return tr('isleChecking')
  if (sync.kind === 'pending') return heightPair(sync.local, sync.network, false)
  if (sync.kind === 'synced') return tr('isleSynced') + ' ' + groupNum(sync.local) + '/' + groupNum(sync.network)
  return groupNum(sync.local) + '/' + groupNum(sync.network) + ' · ' + panelEta(sync, tr, etaText)
}

function waitingLine (m, tr, syncKind) {
  if (syncKind === 'syncing' || (m && m.code && String(m.code).indexOf('SYNC') >= 0)) return tr('isleSyncWait')
  return ''
}

function mineText (gpu, cpu, nodeOnly, tr, hashText, syncKind) {
  const bits = []
  const add = (m, label) => {
    if (!m || !m.running) return
    const hr = num(m.hashrate)
    const rate = hr != null && hr > 0 && hashText ? hashText(hr) : ''
    if (miningNow(m)) bits.push(label + (rate ? ' ' + rate : ''))
    else bits.push(waitingLine(m, tr, syncKind) || (label + ' ' + tr('isleBoot')))
  }
  if (nodeOnly && nodeOnly.running && nodeOnly.mode === 'node') bits.push(tr('isleNode'))
  add(gpu, tr('isleGpu'))
  add(cpu, tr('isleCpu'))
  return bits.length ? bits.join(' · ') : tr('isleNoMine')
}

function rateOf (m, label) {
  if (!m || !m.running || !miningNow(m)) return null
  return { label: label, hash: compactHash(m.hashrate) || '…' }
}

function shardSources (n, opts) {
  opts = opts || {}
  const cpu = opts.classicCpu
  const gpu = opts.classicGpu
  const s0 = opts.shard0
  if (n === 0) {
    const on = s0 && s0.chain !== 'classic' ? s0 : null
    return {
      node: on && on.mode === 'node' ? on : null,
      gpu: on && on.mode !== 'node' && on.running ? on : null,
      cpu: null,
      syncFrom: on && on.running ? on : null
    }
  }
  const g = gpu && gpu.running && Number(gpu.shard) === n ? gpu : null
  const c = cpu && cpu.running && Number(cpu.shard) === n ? cpu : null
  return { node: null, gpu: g && !isCpu(g) ? g : null, cpu: c && isCpu(c) ? c : null, syncFrom: g || null }
}

function rateChip (n, rate, withShard) {
  let text
  if (!withShard) text = rate.label + ' ' + rate.hash
  else if (n === 0) text = 'S0 ' + rate.hash
  else text = 'S' + n + ' ' + rate.label + ' ' + rate.hash
  return { kind: 'rate', text: text, live: true }
}

function buildIsland (opts) {
  opts = opts || {}
  const tr = typeof opts.T === 'function' ? opts.T : (k) => k
  const etaText = opts.etaText
  const hashText = opts.hashText
  const views = [1, 2, 3, 4, 0].map(n => {
    const src = shardSources(n, opts)
    const sync = src.syncFrom ? syncOf(src.syncFrom) : (src.cpu ? { kind: 'pool' } : { kind: 'off' })
    const gpu = src.gpu && isGpuMine(src.gpu) ? src.gpu : null
    const rates = [rateOf(gpu, tr('isleGpu')), rateOf(src.cpu, tr('isleCpu'))].filter(Boolean)
    const liveMine = rates.length > 0
    const gpuWaiting = gpu && gpu.running && !miningNow(gpu) && (sync.kind === 'syncing' || (gpu.code && String(gpu.code).indexOf('SYNC') >= 0))
    return {
      n,
      sync,
      rates,
      standby: gpuWaiting ? tr('isleGpuIdle') : '',
      liveMine,
      progress: syncProgress(sync),
      syncKind: sync.kind,
      syncText: syncText(sync, tr, etaText),
      mineText: mineText(gpu, src.cpu, src.node, tr, hashText, sync.kind)
    }
  })
  const anyMining = views.some(s => s.liveMine)
  const chips = []
  views.forEach(s => {
    const sync = s.sync
    const showHeight = sync.kind === 'syncing' || sync.kind === 'checking' || sync.kind === 'pending' || (sync.kind === 'synced' && !s.rates.length)
    if (sync.kind === 'off' && !s.rates.length && !s.standby) return
    if (sync.kind === 'checking') {
      chips.push({ kind: 'sync', text: 'S' + s.n + ' ' + tr('isleChecking'), progress: 0 })
    } else if (showHeight && (sync.local != null || sync.kind === 'pending')) {
      let text = 'S' + s.n + ' '
      if (sync.kind === 'syncing' && !anyMining) text += tr('isleSyncShort') + ' '
      text += heightPair(sync.local, sync.network, true)
      chips.push({ kind: 'sync', text: text.trim(), progress: s.progress })
      const eta = etaLabel(sync, tr)
      if (eta) chips.push({ kind: 'eta', text: eta, progress: s.progress })
    } else if (sync.kind === 'pool' && !s.rates.length) {
      chips.push({ kind: 'idle', text: 'S' + s.n + ' ' + tr('islePool') })
    }
    if (s.standby) chips.push({ kind: 'idle', text: s.standby })
    const withShard = !showHeight
    if (s.rates.length === 1) chips.push(rateChip(s.n, s.rates[0], withShard))
    else s.rates.forEach((r, i) => chips.push(rateChip(s.n, r, withShard && i === 0)))
  })
  if (!anyMining) {
    if (chips.length) chips.push({ kind: 'idle', text: tr('isleIdle') })
    else chips.push({ kind: 'start', text: tr('isleStart') })
  }
  const temps = (opts.temps || []).map(t => num(t && t.tempC)).filter(t => t != null)
  const tempC = temps.length ? Math.max.apply(null, temps) : null
  const band = tempBand(tempC)
  const earn = summarizeEarnings(opts.earnLog || [], opts.now == null ? Date.now() : opts.now, opts.rewardScdo == null ? BLOCK_REWARD_SCDO : opts.rewardScdo)
  const balanceText = opts.balanceText || ''
  const balanceMark = opts.balanceMark || ''
  const balanceName = opts.balanceName || ''
  const money = []
  if (tempC != null) money.push({ kind: 'temp', text: String(tempC) + '°C', band: band })
  money.push({ kind: 'earn', text: tr('isleTodayShort', { b: earn.todayBlocks, s: earn.todayScdo }) })
  if (balanceText) money.push({ kind: 'bal', text: tr('isleBalance') + ' ' + balanceText, mark: balanceMark, name: balanceName })
  const compactTop = chips.map(c => c.text).join(' · ')
  const compactBottom = money.map(c => c.text).join(' · ')
  const shards = views.map(s => ({
    n: s.n,
    syncKind: s.syncKind,
    syncText: s.syncText,
    mineText: s.mineText,
    progress: s.progress,
    liveMine: s.liveMine
  }))
  return { shards, tempC, tempBand: band, earn, balanceText, balanceMark, balanceName, compactTop, compactBottom, chips, money }
}

function absorbBlocks (state, events, now) {
  const prev = state && typeof state === 'object' ? state : {}
  const items = Array.isArray(prev.items) ? prev.items.slice() : []
  const known = new Set(Array.isArray(prev.known) ? prev.known.map(String) : items.map(e => e.shard + ':' + e.height))
  const list = Array.isArray(events) ? events : []
  if (!prev.seeded) {
    for (const e of list) if (e && e.height != null) known.add(e.shard + ':' + e.height)
  } else {
    for (const e of list) {
      if (!e || e.height == null) continue
      const key = e.shard + ':' + e.height
      if (known.has(key)) continue
      known.add(key)
      items.push({ t: now, shard: Number(e.shard), height: Number(e.height) })
    }
  }
  const live = []
  for (const e of list) if (e && e.height != null) live.push(e.shard + ':' + e.height)
  const liveSet = new Set(live)
  const extra = [...known].filter(k => !liveSet.has(k)).slice(-500)
  return { seeded: true, items: items.slice(-500), known: extra.concat(live).slice(-800) }
}

function summarizeEarnings (log, now, reward) {
  const items = Array.isArray(log) ? log : (log && Array.isArray(log.items) ? log.items : [])
  const pay = Number(reward)
  const each = Number.isFinite(pay) && pay > 0 ? pay : BLOCK_REWARD_SCDO
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const from = start.getTime()
  let today = 0
  for (const e of items) if (e && Number(e.t) >= from) today++
  return { todayBlocks: today, totalBlocks: items.length, todayScdo: today * each, totalScdo: items.length * each }
}

const api = { BLOCK_REWARD_SCDO, buildIsland, absorbBlocks, summarizeEarnings, syncOf, compactHash, compactCount }
if (typeof module !== 'undefined' && module.exports) module.exports = api
if (typeof window !== 'undefined') window.SCDOIsland = Object.freeze(api)
})()
