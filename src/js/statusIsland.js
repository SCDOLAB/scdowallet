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
  if (Number(c) >= 75) return 'warm'
  return 'ok'
}

function tempState (band, tr) {
  if (band === 'hot') return tr('isleHot')
  if (band === 'warm') return tr('isleWarm')
  return tr('isleOk')
}

function chainName (n, tr) {
  return n === 0 ? tr('isleMainChain') : tr('isleShardN', { n: n })
}

function tipOf (name, value, explain, detail) {
  return { name: name || '', value: value || '', explain: explain || '', detail: detail || '' }
}

function syncPct (sync) {
  if (!sync || sync.local == null || sync.network == null || !(Number(sync.network) > 0)) return null
  const pct = Math.round((Number(sync.local) / Number(sync.network)) * 100)
  return Math.max(0, Math.min(100, pct))
}

function durationWords (sec, tr) {
  const n = Number(sec)
  if (sec == null || !Number.isFinite(n) || n < 0) return ''
  const s = Math.round(n)
  if (s < 60) return tr('isleDurSec', { n: s })
  const mins = Math.round(s / 60)
  if (mins < 60) return tr('isleDurMin', { n: mins })
  const h = Math.floor(mins / 60)
  const rm = mins % 60
  if (h < 24 * 14) {
    if (!rm || h >= 10) return tr('isleDurHour', { n: h })
    return tr('isleDurHourMin', { h: h, m: rm })
  }
  return tr('isleDurDay', { n: Math.round(h / 24) })
}

function attemptWords (hash, tr) {
  const n = Number(hash)
  if (!Number.isFinite(n) || n <= 0) return { text: tr('isleSpeedUnknown'), count: '' }
  const rounded = Math.round(n)
  return { text: tr('islePerSec', { n: rounded.toLocaleString('en-US') }), count: rounded.toLocaleString('en-US') }
}

function heightDetail (sync, tr) {
  const local = sync && sync.local != null ? groupNum(sync.local) : tr('isleUnknown')
  const network = sync && sync.network != null ? groupNum(sync.network) : tr('isleUnknown')
  return tr('isleHeightDetail', { local: local, network: network })
}

function gpuLabel (name) {
  return String(name || '').replace(/^NVIDIA\s+/i, '').replace(/^GeForce\s+/i, '').trim()
}

function syncSentence (sync, chain, tr) {
  const pct = syncPct(sync)
  if (pct == null) return tr('isleSyncUnknown', { chain: chain })
  return tr('isleSyncPct', { chain: chain, pct: pct })
}

function speedChip (chain, dev, hash, tr) {
  const speed = attemptWords(hash, tr)
  const text = tr('isleSpeed', { chain: chain, dev: dev, speed: speed.text })
  return {
    kind: 'rate',
    text: text,
    live: true,
    tip: tipOf(
      tr('isleSpeedName', { chain: chain, dev: dev }),
      speed.text,
      tr('isleTipSpeedExplain', { n: speed.count || tr('isleUnknown') }),
      speed.count ? tr('isleTipSpeedDetail', { n: speed.count }) : ''
    )
  }
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

function peersOf (m) {
  if (!m || m.peers == null || m.peers === '') return null
  const n = num(m.peers)
  return n != null && n >= 0 ? Math.round(n) : null
}

function legendItems (tr) {
  return [
    { name: tr('isleLegSyncName'), text: tr('isleLegSync') },
    { name: tr('isleLegSpeedName'), text: tr('isleLegSpeed') },
    { name: tr('isleLegTempName'), text: tr('isleLegTemp') },
    { name: tr('isleLegEarnName'), text: tr('isleLegEarn') },
    { name: tr('isleLegPeerName'), text: tr('isleLegPeer') },
    { name: tr('isleLegBalName'), text: tr('isleLegBal') },
    { name: tr('isleLegWaitName'), text: tr('isleLegWait') }
  ]
}

function buildIsland (opts) {
  opts = opts || {}
  const tr = typeof opts.T === 'function' ? opts.T : (k) => k
  const views = [1, 2, 3, 4, 0].map(n => {
    const src = shardSources(n, opts)
    const sync = src.syncFrom ? syncOf(src.syncFrom) : (src.cpu ? { kind: 'pool' } : { kind: 'off' })
    const gpu = src.gpu && isGpuMine(src.gpu) ? src.gpu : null
    const chain = chainName(n, tr)
    const gpuWaiting = gpu && gpu.running && !miningNow(gpu) && (sync.kind === 'syncing' || (gpu.code && String(gpu.code).indexOf('SYNC') >= 0))
    const row = []
    const active = sync.kind !== 'off' || gpu || src.cpu || (src.node && src.node.running)
    if (active && sync.kind !== 'pool') {
      const sentence = sync.kind === 'off' ? tr('isleSyncUnknown', { chain: chain }) : syncSentence(sync, chain, tr)
      const pct = syncPct(sync)
      row.push({
        kind: 'sync',
        text: sentence,
        progress: syncProgress(sync),
        tip: tipOf(chain + ' ' + tr('isleSyncShort'), pct == null ? tr('isleEtaCalc') : pct + '%', tr('isleTipSyncExplain'), heightDetail(sync, tr))
      })
    }
    if (sync.kind === 'syncing') {
      const far = farBehind(sync) && sync.etaSec != null && Number(sync.etaSec) < 5
      const when = (!far && sync.etaSec != null) ? (durationWords(sync.etaSec, tr) || tr('isleEtaCalc')) : tr('isleEtaCalc')
      const text = tr('isleEtaLeft', { chain: chain, when: when })
      row.push({
        kind: 'eta',
        text: text,
        progress: syncProgress(sync),
        tip: tipOf(chain + ' ' + tr('isleEtaCalc'), when, tr('isleTipEtaExplain'), heightDetail(sync, tr))
      })
    }
    if (gpuWaiting) {
      const text = tr('isleWaitMine', { chain: chain })
      row.push({
        kind: 'idle',
        text: text,
        tip: tipOf(chain, tr('isleGpuIdle'), tr('isleTipWaitExplain'), heightDetail(sync, tr))
      })
    }
    if (src.node && src.node.running && src.node.mode === 'node') {
      const text = tr('isleNodeOnly', { chain: chain })
      row.push({ kind: 'idle', text: text, tip: tipOf(chain, text, tr('isleTipNodeExplain'), '') })
    }
    if (gpu && miningNow(gpu)) row.push(speedChip(chain, tr('isleDevGpu'), gpu.hashrate, tr))
    if (src.cpu && miningNow(src.cpu)) row.push(speedChip(chain, tr('isleDevCpu'), src.cpu.hashrate, tr))
    if (sync.kind === 'pool' && !(src.cpu && miningNow(src.cpu))) {
      const text = tr('islePoolMine', { chain: chain })
      row.push({ kind: 'idle', text: text, tip: tipOf(chain, text, tr('isleTipPoolExplain'), '') })
    }
    const peerSource = gpu || src.cpu || (src.node && src.node.running ? src.node : null) || src.syncFrom
    const peers = peersOf(peerSource)
    if (peers != null) {
      const text = tr('islePeers', { chain: chain, n: peers })
      row.push({
        kind: 'idle',
        text: text,
        tip: tipOf(tr('isleLegPeerName'), tr('islePeerCount', { n: peers }), tr('isleTipPeerExplain'), tr('isleTipPeerDetail', { n: peers }))
      })
    }
    const liveMine = row.some(c => c.kind === 'rate')
    const mineBits = row.filter(c => c.kind !== 'sync' && c.kind !== 'eta').map(c => c.text)
    return {
      n,
      title: chain,
      sync,
      liveMine,
      progress: syncProgress(sync),
      syncKind: sync.kind,
      syncText: (row.find(c => c.kind === 'sync') || {}).text || (sync.kind === 'off' ? tr('isleOff') : ''),
      mineText: mineBits.join(' · ') || tr('isleNoMine'),
      rowChips: row
    }
  })
  const anyMining = views.some(s => s.liveMine)
  const chips = []
  views.forEach(s => { s.rowChips.forEach(c => chips.push(c)) })
  if (!anyMining) {
    if (chips.length) {
      chips.push({ kind: 'idle', text: tr('isleNotMining'), tip: tipOf(tr('isleNotMining'), tr('isleNotMining'), tr('isleTipIdleExplain'), '') })
    } else {
      chips.push({ kind: 'start', text: tr('isleStart'), tip: tipOf(tr('isleStart'), tr('isleStart'), tr('isleTipStartExplain'), '') })
    }
  }
  const gpuTemps = (opts.temps || []).map(t => ({ name: gpuLabel(t && t.name), tempC: num(t && t.tempC) })).filter(t => t.tempC != null)
  const tempC = gpuTemps.length ? Math.max.apply(null, gpuTemps.map(t => t.tempC)) : null
  const band = tempBand(tempC)
  const earn = summarizeEarnings(opts.earnLog || [], opts.now == null ? Date.now() : opts.now, opts.rewardScdo == null ? BLOCK_REWARD_SCDO : opts.rewardScdo)
  const reward = opts.rewardScdo == null ? BLOCK_REWARD_SCDO : opts.rewardScdo
  const balanceText = opts.balanceText || ''
  const balanceMark = opts.balanceMark || ''
  const balanceName = opts.balanceName || ''
  const money = []
  if (!gpuTemps.length) {
    money.push({ kind: 'idle', text: tr('isleNoTemp'), tip: tipOf(tr('isleLegTempName'), tr('isleNoTemp'), tr('isleTipNoTempExplain'), '') })
  } else {
    gpuTemps.forEach((g, i) => {
      const gBand = tempBand(g.tempC)
      const state = tempState(gBand, tr)
      const text = gpuTemps.length > 1
        ? tr('isleTempMany', { i: i + 1, n: g.tempC, state: state })
        : tr('isleTempOne', { n: g.tempC, state: state })
      const detail = g.name ? tr('isleTipTempDetail', { name: g.name }) : ''
      money.push({
        kind: 'temp',
        text: text,
        band: gBand,
        tip: tipOf(tr('isleLegTempName'), tr('isleTempValue', { n: g.tempC, state: state }), tr('isleTipTempExplain'), detail)
      })
    })
  }
  money.push({
    kind: 'earn',
    text: tr('isleEarnedToday', { s: earn.todayScdo }),
    tip: tipOf(tr('isleLegEarnName'), earn.todayScdo + ' SCDO', tr('isleTipEarnExplain'), tr('isleTipEarnDetail', { b: earn.todayBlocks, r: reward }))
  })
  money.push({
    kind: 'earn',
    text: tr('isleEarnedTotal', { s: earn.totalScdo }),
    tip: tipOf(tr('isleEarnedTotal', { s: '' }).trim(), earn.totalScdo + ' SCDO', tr('isleTipTotalExplain'), tr('isleTipTotalDetail', { b: earn.totalBlocks, r: reward }))
  })
  if (balanceText) {
    money.push({
      kind: 'bal',
      text: tr('isleAcctBal', { text: balanceText }),
      mark: balanceMark,
      name: balanceName,
      tip: tipOf(tr('isleLegBalName'), balanceText, tr('isleTipBalExplain'), balanceName ? balanceName : '')
    })
  }
  const compactTop = chips.map(c => c.text).join(' · ')
  const compactBottom = money.map(c => c.text).join(' · ')
  const shards = views.map(s => ({
    n: s.n,
    title: s.title,
    syncKind: s.syncKind,
    syncText: s.syncText,
    mineText: s.mineText,
    progress: s.progress,
    liveMine: s.liveMine,
    rowChips: s.rowChips
  }))
  return { shards, tempC, tempBand: band, earn, balanceText, balanceMark, balanceName, compactTop, compactBottom, chips, money, legend: legendItems(tr) }
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
