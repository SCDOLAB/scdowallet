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

function syncOf (m) {
  if (!m || !m.running) return { kind: 'off' }
  if (isCpu(m) && m.localBlock == null && m.networkBlock == null) return { kind: 'pool' }
  const local = num(m.localBlock)
  const network = num(m.networkBlock)
  if (local == null || network == null) return { kind: 'checking' }
  if (network - local <= BEHIND_BLOCKS) return { kind: 'synced', local, network }
  return { kind: 'syncing', local, network, etaSec: num(m.syncEtaSec) }
}

function groupNum (n) {
  const x = Math.trunc(Number(n))
  if (!Number.isFinite(x)) return String(n)
  return x.toLocaleString('en-US')
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

// A few seconds is not an ETA while millions of blocks remain. Say 計算中.
function panelEta (sync, tr, etaText) {
  if (sync.etaSec == null || (farBehind(sync) && Number(sync.etaSec) < 5)) return tr('isleCalc')
  let text = etaText ? etaText(sync.etaSec) : compactEta(sync.etaSec)
  if (farBehind(sync) && (text === '即將完成' || text === 'almost done')) return tr('isleCalc')
  return text || tr('isleCalc')
}

function syncText (sync, tr, etaText) {
  if (!sync || sync.kind === 'off') return tr('isleOff')
  if (sync.kind === 'pool') return tr('islePool')
  if (sync.kind === 'checking') return tr('isleChecking')
  if (sync.kind === 'synced') return tr('isleSynced') + ' ' + groupNum(sync.local) + '/' + groupNum(sync.network)
  return groupNum(sync.local) + '/' + groupNum(sync.network) + ' · ' + panelEta(sync, tr, etaText)
}

function compactSync (sync, tr) {
  if (!sync || sync.kind === 'off' || sync.kind === 'pool') return ''
  if (sync.kind === 'checking') return '…'
  const heights = groupNum(sync.local) + '/' + groupNum(sync.network)
  if (sync.kind === 'synced') return heights
  if (sync.etaSec == null || (farBehind(sync) && Number(sync.etaSec) < 5)) return heights + ' · ' + tr('isleCalc')
  const eta = compactEta(sync.etaSec)
  return heights + ' · ' + (eta || tr('isleCalc'))
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

function mineCompact (gpu, cpu, nodeOnly, tr, hashText, syncKind) {
  const bits = []
  const add = (m, label) => {
    if (!m || !m.running) return
    const hr = num(m.hashrate)
    const rate = hr != null && hr > 0 && hashText ? hashText(hr) : ''
    if (miningNow(m)) bits.push(label + ' ' + tr('pillMining') + (rate ? ' ' + rate : ''))
    else bits.push(waitingLine(m, tr, syncKind) || (label + ' ' + tr('isleBoot')))
  }
  if (nodeOnly && nodeOnly.running && nodeOnly.mode === 'node') bits.push(tr('isleNode'))
  add(gpu, tr('isleGpu'))
  add(cpu, tr('isleCpu'))
  return bits.join(' · ')
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

function buildIsland (opts) {
  opts = opts || {}
  const tr = typeof opts.T === 'function' ? opts.T : (k) => k
  const etaText = opts.etaText
  const hashText = opts.hashText
  const shards = [1, 2, 3, 4, 0].map(n => {
    const src = shardSources(n, opts)
    const sync = src.syncFrom ? syncOf(src.syncFrom) : (src.cpu ? { kind: 'pool' } : { kind: 'off' })
    const gpu = src.gpu && isGpuMine(src.gpu) ? src.gpu : null
    return {
      n,
      syncKind: sync.kind,
      syncText: syncText(sync, tr, etaText),
      mineText: mineText(gpu, src.cpu, src.node, tr, hashText, sync.kind),
      compactSync: compactSync(sync, tr),
      compactMine: mineCompact(gpu, src.cpu, src.node, tr, hashText, sync.kind)
    }
  })
  const temps = (opts.temps || []).map(t => num(t && t.tempC)).filter(t => t != null)
  const tempC = temps.length ? Math.max.apply(null, temps) : null
  const earn = summarizeEarnings(opts.earnLog || [], opts.now == null ? Date.now() : opts.now, opts.rewardScdo == null ? BLOCK_REWARD_SCDO : opts.rewardScdo)
  const balanceText = opts.balanceText || ''
  const compactTop = shards.map(s => {
    if (s.syncKind === 'off' && !s.compactMine) return ''
    let line = 'S' + s.n
    if (s.compactSync) line += ' ' + s.compactSync
    if (s.compactMine) line += ' · ' + s.compactMine
    return line
  }).filter(Boolean).join(' · ')
  const compactBottom = [
    tempC == null ? '' : String(tempC) + '°C',
    tr('isleTodayShort', { b: earn.todayBlocks, s: earn.todayScdo }),
    (balanceText ? tr('isleBalance') + ' ' + balanceText : '')
  ].filter(Boolean).join(' · ')
  return { shards, tempC, earn, balanceText, compactTop, compactBottom }
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

const api = { BLOCK_REWARD_SCDO, buildIsland, absorbBlocks, summarizeEarnings, syncOf }
if (typeof module !== 'undefined' && module.exports) module.exports = api
if (typeof window !== 'undefined') window.SCDOIsland = Object.freeze(api)
})()
