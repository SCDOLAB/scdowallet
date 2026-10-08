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

function speedChip (chain, dev, hash, tr, key) {
  const speed = attemptWords(hash, tr)
  const text = tr('isleSpeed', { chain: chain, dev: dev, speed: speed.text })
  return {
    key: key,
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
    { name: tr('isleLegEtaName'), text: tr('isleLegEta') },
    { name: tr('isleLegSpeedName'), text: tr('isleLegSpeed') },
    { name: tr('isleLegTempName'), text: tr('isleLegTemp') },
    { name: tr('isleLegEarnName'), text: tr('isleLegEarn') },
    { name: tr('isleLegTotalName'), text: tr('isleLegTotal') },
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
        key: 's' + n + '-sync',
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
        key: 's' + n + '-eta',
        kind: 'eta',
        text: text,
        progress: syncProgress(sync),
        tip: tipOf(tr('isleEtaName', { chain: chain }), when, tr('isleTipEtaExplain'), heightDetail(sync, tr))
      })
    }
    if (gpuWaiting) {
      const text = tr('isleWaitMine', { chain: chain })
      row.push({
        key: 's' + n + '-wait',
        kind: 'idle',
        text: text,
        tip: tipOf(chain, tr('isleGpuIdle'), tr('isleTipWaitExplain'), heightDetail(sync, tr))
      })
    }
    if (src.node && src.node.running && src.node.mode === 'node') {
      const text = tr('isleNodeOnly', { chain: chain })
      row.push({ key: 's' + n + '-node', kind: 'idle', text: text, tip: tipOf(chain, text, tr('isleTipNodeExplain'), '') })
    }
    if (gpu && miningNow(gpu)) row.push(speedChip(chain, tr('isleDevGpu'), gpu.hashrate, tr, 's' + n + '-gpu'))
    if (src.cpu && miningNow(src.cpu)) row.push(speedChip(chain, tr('isleDevCpu'), src.cpu.hashrate, tr, 's' + n + '-cpu'))
    if (sync.kind === 'pool' && !(src.cpu && miningNow(src.cpu))) {
      const text = tr('islePoolMine', { chain: chain })
      row.push({ key: 's' + n + '-pool', kind: 'idle', text: text, tip: tipOf(chain, text, tr('isleTipPoolExplain'), '') })
    }
    const peerSource = gpu || src.cpu || (src.node && src.node.running ? src.node : null) || src.syncFrom
    const peers = peersOf(peerSource)
    if (peers != null) {
      const text = tr('islePeers', { chain: chain, n: peers })
      row.push({
        key: 's' + n + '-peers',
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
    chips.push({ key: 'not-mining', kind: 'idle', text: tr('isleNotMining'), tip: tipOf(tr('isleNotMining'), tr('isleNotMining'), tr('isleTipIdleExplain'), '') })
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
    money.push({ key: 'temp-none', kind: 'idle', text: tr('isleNoTemp'), tip: tipOf(tr('isleLegTempName'), tr('isleNoTemp'), tr('isleTipNoTempExplain'), '') })
  } else {
    gpuTemps.forEach((g, i) => {
      const gBand = tempBand(g.tempC)
      const state = tempState(gBand, tr)
      const text = gpuTemps.length > 1
        ? tr('isleTempMany', { i: i + 1, n: g.tempC, state: state })
        : tr('isleTempOne', { n: g.tempC, state: state })
      const detail = g.name ? tr('isleTipTempDetail', { name: g.name }) : ''
      money.push({
        key: 'temp-' + i,
        kind: 'temp',
        text: text,
        band: gBand,
        tip: tipOf(tr('isleLegTempName'), tr('isleTempValue', { n: g.tempC, state: state }), tr('isleTipTempExplain'), detail)
      })
    })
  }
  money.push({
    key: 'earn-today',
    kind: 'earn',
    text: tr('isleEarnedToday', { s: earn.todayScdo }),
    tip: tipOf(tr('isleLegEarnName'), earn.todayScdo + ' SCDO', tr('isleTipEarnExplain'), tr('isleTipEarnDetail', { b: earn.todayBlocks, r: reward }))
  })
  money.push({
    key: 'earn-total',
    kind: 'earn',
    text: tr('isleEarnedTotal', { s: earn.totalScdo }),
    tip: tipOf(tr('isleTotalName'), earn.totalScdo + ' SCDO', tr('isleTipTotalExplain'), tr('isleTipTotalDetail', { b: earn.totalBlocks, r: reward }))
  })
  if (balanceText) {
    money.push({
      key: 'bal',
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


// 3.0.2: the header shows one summary row (the per-chain details live in the five dashboard cards):
// mining (which chains and devices), total speed, graphics-card temperature, overall sync, connected nodes,
// then today's and total earnings. Every item is written out in full words.
function speedWords (n, tr) {
  const x = Math.round(Number(n))
  if (!Number.isFinite(x) || x <= 0) return ''
  if (tr('d_unitMyriad') === '萬' && x >= 10000) return tr('d_perSecMyriad', { n: Math.round(x / 10000).toLocaleString('en-US') })
  return tr('islePerSec', { n: x.toLocaleString('en-US') })
}
function summaryIsland (opts) {
  opts = opts || {}
  const tr = typeof opts.T === 'function' ? opts.T : (k) => k
  const full = buildIsland(opts)
  const parts = []
  let hash = 0
  let anyHash = false
  const pcts = []
  let peers = null
  let behind = null
  ;[0, 1, 2, 3, 4].forEach(n => {
    const src = shardSources(n, opts)
    const chain = chainName(n, tr)
    const gpu = src.gpu && isGpuMine(src.gpu) ? src.gpu : null
    if (gpu && miningNow(gpu)) { parts.push(tr('d_mineDev', { chain: chain, dev: tr('d_devGpu') })); if (num(gpu.hashrate) > 0) { hash += num(gpu.hashrate); anyHash = true } }
    if (src.cpu && miningNow(src.cpu)) { parts.push(tr('d_mineDev', { chain: chain, dev: tr('d_devCpu') })); if (num(src.cpu.hashrate) > 0) { hash += num(src.cpu.hashrate); anyHash = true } }
    if (src.syncFrom) {
      const sy = syncOf(src.syncFrom)
      const pct = syncPct(sy)
      if (pct != null) pcts.push(pct)
      if (sy.kind === 'syncing' && (behind == null || pct < behind.pct)) behind = { pct: pct, eta: sy.etaSec }
    }
    const p = peersOf(gpu || src.cpu || (src.node && src.node.running ? src.node : null) || src.syncFrom)
    if (p != null) peers = peers == null ? p : Math.max(peers, p)
  })
  const chips = []
  if (parts.length) {
    chips.push({ key: 'sum-mine', kind: 'rate', live: true, text: tr('d_islMining', { list: parts.join(tr('d_listSep')) }), tip: tipOf(tr('d_islMiningName'), parts.join(tr('d_listSep')), tr('isleTipSpeedExplain', { n: anyHash ? Math.round(hash).toLocaleString('en-US') : tr('isleUnknown') }), '') })
    const sp = anyHash ? speedWords(hash, tr) : tr('isleSpeedUnknown')
    chips.push({ key: 'sum-speed', kind: 'rate', text: tr('d_islSpeed', { speed: sp }), tip: tipOf(tr('isleLegSpeedName'), sp, tr('isleTipSpeedExplain', { n: anyHash ? Math.round(hash).toLocaleString('en-US') : tr('isleUnknown') }), anyHash ? tr('isleTipSpeedDetail', { n: Math.round(hash).toLocaleString('en-US') }) : '') })
  } else {
    chips.push({ key: 'not-mining', kind: 'idle', text: tr('isleNotMining'), tip: tipOf(tr('isleNotMining'), tr('isleNotMining'), tr('isleTipIdleExplain'), '') })
  }
  full.money.filter(c => c.kind === 'temp' || c.key === 'temp-none').forEach(c => chips.push(c))
  if (pcts.length) {
    const low = Math.min.apply(null, pcts)
    const text = behind ? tr('d_islSyncEta', { pct: behind.pct, when: (behind.eta != null && Number(behind.eta) >= 5 ? durationWords(behind.eta, tr) : '') || tr('isleEtaCalc') }) : tr('d_islSync', { pct: low })
    chips.push({ key: 'sum-sync', kind: 'sync', text: text, progress: low / 100, tip: tipOf(tr('isleLegSyncName'), low + '%', tr('isleTipSyncExplain'), '') })
  }
  if (peers != null) chips.push({ key: 'sum-peers', kind: 'peer', text: tr('d_islPeers', { n: peers }), tip: tipOf(tr('isleLegPeerName'), tr('islePeerCount', { n: peers }), tr('isleTipPeerExplain'), tr('isleTipPeerDetail', { n: peers })) })
  // 3.0.3 (no duplicates): mining state, speed, temperature, sync and peers are already on each of the five
  // Home cards, so the island keeps only what no card shows: today's and total earnings.
  const money = full.money.filter(c => c.kind === 'earn')
  const keep = [tr('isleLegEarnName'), tr('isleLegTotalName')]
  const legend = (full.legend || []).filter(it => it && keep.includes(it.name))
  return { chips: money, money: [], cardChips: chips, legend: legend, tempC: full.tempC, tempBand: full.tempBand, earn: full.earn, shards: full.shards }
}

const api = { BLOCK_REWARD_SCDO, buildIsland, summaryIsland, shardSources, syncPct, peersOf, tempBand, miningNow, isGpuMine, speedWords, durationWords, absorbBlocks, summarizeEarnings, syncOf, compactHash, compactCount }
if (typeof module !== 'undefined' && module.exports) module.exports = api
if (typeof window !== 'undefined') window.SCDOIsland = Object.freeze(api)
})()
