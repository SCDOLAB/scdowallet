// Miner-agnostic status lines.
// CPU zminer prints one JSON object per line: {"type":"status","hashrate",accepted,rejected,connected,blocks}.
// The Classic CUDA node prints no hashrate. Blocks come from its log, and a rate is
// estimated from how many blocks this process has found.
'use strict'

function num (v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return null
}

function looksLikeStatus (obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false
  if (obj.type === 'status' || obj.type === 'scdo-miner') return true
  const hashrate = num(obj.hashrate != null ? obj.hashrate : obj.hashrate_hs)
  const connected = typeof obj.connected === 'boolean'
  const shares = num(obj.accepted) != null || num(obj.rejected) != null
  return hashrate != null && (connected || shares)
}

function fromStatusObject (obj) {
  const hashrate = num(obj.hashrate != null ? obj.hashrate : obj.hashrate_hs)
  return {
    kind: 'status',
    hashrate,
    accepted: num(obj.accepted),
    rejected: num(obj.rejected),
    connected: typeof obj.connected === 'boolean' ? obj.connected : null,
    blocks: num(obj.blocks)
  }
}

// Returns a patch, or null when the line is ordinary log text.
function parseStatusLine (line) {
  const s = String(line == null ? '' : line).trim()
  if (!s) return null
  if (s.startsWith('{')) {
    try {
      const obj = JSON.parse(s)
      if (looksLikeStatus(obj)) return fromStatusObject(obj)
    } catch (e) { /* not status json */ }
  }
  let m = /GPU miner called number of blocks\s*=\s*(\d+)\s*,\s*number of block threads\s*=\s*(\d+)/i.exec(s)
  if (m) return { kind: 'gpu-active', grid: Number(m[1]), blockThreads: Number(m[2]) }
  m = /found a new mined block,\s*height:\s*(\d+)/i.exec(s)
  if (m) return { kind: 'block-found', height: Number(m[1]) }
  if (/saved mined block successfully/i.test(s)) return { kind: 'block-saved' }
  if (/got download start event,\s*stop miner/i.test(s)) return { kind: 'gpu-paused' }
  if (/Miner started\b/i.test(s)) return { kind: 'gpu-resumed' }
  if (/Miner stopped\b/i.test(s)) return { kind: 'gpu-stopped' }
  if (/login failed:/i.test(s)) return { kind: 'login-failed', message: s }
  // go-scdo info/debug lines. "found a new mined block" is already a block-found.
  m = /from height=(\d+),\s*target height=(\d+)/i.exec(s)
  if (m) return { kind: 'sync-target', local: Number(m[1]), network: Number(m[2]) }
  m = /got block message and save it\.\s*height[=:]\s*(\d+)/i.exec(s)
  if (m) return { kind: 'chain-height', local: Number(m[1]) }
  m = /(?:mining block|new task for the pool|committing a new task to engine),?\s*height:\s*(\d+)/i.exec(s)
  if (m) return { kind: 'chain-height', local: Number(m[1]) }
  // zminer-gpu summary, every 15s:
  // hashrate 248000 H/s | batch 8192 | NVIDIA GeForce ... | accepted 12 rejected 0 dropped 0 blocks 1 | up 3m0s
  m = /hashrate\s+([0-9]+(?:\.[0-9]+)?)\s*H\/s\b.*?accepted\s+(\d+)\s+rejected\s+(\d+)/i.exec(s)
  if (m) return { kind: 'status', hashrate: Number(m[1]), accepted: Number(m[2]), rejected: Number(m[3]), connected: null, blocks: null }
  return null
}

// The graphics-card pool miner cannot start. The wallet shows one fallback, not a retry loop.
function cudaInitFailed (line) {
  return /CUDA driver version is insufficient|no CUDA device|zpow GPU library not found|CUDA device \d+ out of range/i.test(String(line || ''))
}

// download_getStatus: Amount = toNo - fromNo + 1, so the peer tip is StartNum + Amount - 1.
function peerTargetOf (dl) {
  if (!dl || typeof dl !== 'object') return null
  const start = num(dl.StartNum != null ? dl.StartNum : dl.startNum)
  const amount = num(dl.Amount != null ? dl.Amount : dl.amount)
  if (start == null || amount == null || amount <= 0) return null
  return start + amount - 1
}

function maxHeight () {
  let best = null
  for (let i = 0; i < arguments.length; i++) {
    const n = num(arguments[i])
    if (n == null || n < 0) continue
    if (best == null || n > best) best = n
  }
  return best
}

// A node that is still this far behind the network is syncing, not mining.
const BEHIND_BLOCKS = 8
// ETA rate uses heights inside this window. The startup stall is dropped first.
const ETA_WINDOW_MS = 3 * 60 * 1000
const ETA_MIN_SAMPLES = 3
const ETA_MIN_SPAN_SEC = 60
// Longer than this is a bad sample (a flat prefix, or a one-block blip), not a forecast.
const ETA_MAX_SEC = 14 * 24 * 3600

// network is the higher of the peer target and the public getInfo tip.
// ETA prefers the rolling height window. download_getStatus is only a fallback
// when there are not yet two samples. A partial window stays "calculating".
function mergeSyncView (opts) {
  opts = opts || {}
  const local = num(opts.local)
  const downloaded = num(opts.downloaded)
  const amount = num(opts.amount)
  const durationSec = num(opts.durationSec)
  const network = maxHeight(opts.peerTarget, opts.publicTip)
  const haveSamples = !!(opts.samples && opts.samples.length >= 2)
  let etaSec = etaFromSamples(opts.samples, local, network, opts.now)
  const gap = local != null && network != null ? network - local : null
  if (etaSec == null && !haveSamples && durationSec > 0 && downloaded > 0 && amount != null && amount > downloaded) {
    const chunkLeft = amount - downloaded
    // A nearly finished peer chunk is not the chain gap. Stay on 計算中 until the height window has an ETA.
    const coversGap = gap == null || chunkLeft >= gap * 0.5 || amount >= gap * 0.5
    if (coversGap) etaSec = chunkLeft * durationSec / downloaded
  } else if (etaSec == null && local != null && network != null && local >= network) {
    etaSec = 0
  }
  if (etaSec != null && etaSec > ETA_MAX_SEC) etaSec = null
  // 即將完成 is only for a node that is actually close. A few seconds against millions of blocks is not an ETA.
  if (etaSec != null && etaSec > 0 && gap != null && gap > BEHIND_BLOCKS && etaSec < 5) etaSec = null
  return { localBlock: local, networkBlock: network, etaSec }
}

// Drop a flat prefix so the rate starts at the first height increase.
// A ramp that moves on the first step is kept whole.
function dropStalledPrefix (windowed) {
  if (!windowed || windowed.length < 2) return windowed || []
  const base = Number(windowed[0].h)
  let flat = 0
  while (flat < windowed.length && Number(windowed[flat].h) === base) flat++
  if (flat >= 2 && flat < windowed.length && Number(windowed[flat].h) > base) return windowed.slice(flat)
  return windowed
}

function etaFromSamples (samples, local, network, now) {
  if (local != null && network != null && local >= network) return 0
  if (!samples || samples.length < 2 || local == null || network == null || network <= local) return null
  const end = now != null ? Number(now) : Number(samples[samples.length - 1].t)
  const cutoff = end - ETA_WINDOW_MS
  const windowed = []
  for (const s of samples) {
    const t = Number(s && s.t)
    if (t >= cutoff && t <= end) windowed.push(s)
  }
  const progress = dropStalledPrefix(windowed)
  if (progress.length < ETA_MIN_SAMPLES) return null
  const first = progress[0]
  const last = progress[progress.length - 1]
  const dt = (Number(last.t) - Number(first.t)) / 1000
  const dh = Number(last.h) - Number(first.h)
  if (!(dt >= ETA_MIN_SPAN_SEC) || !(dh > 0)) return null
  const eta = (network - local) * dt / dh
  if (!(eta > 0) || eta > ETA_MAX_SEC) return null
  return eta
}

// Classic GPU status before and after the first height. Mining is only claimed
// once both heights are known and the node is within a few blocks of the tip.
function classicGpuPhase (s) {
  s = s || {}
  const local = num(s.localBlock)
  const network = num(s.networkBlock)
  if (local == null && network == null) {
    return { code: s.gpuActive || s.nodeSeen ? 'CLASSIC_CHECKING' : 'CLASSIC_STARTING', phase: 'starting' }
  }
  const gapKnown = local != null && network != null
  const behind = !gapKnown || (network - local) > BEHIND_BLOCKS
  if (s.paused && gapKnown) return { code: 'CLASSIC_PAUSED', phase: 'syncing' }
  if (behind) return { code: 'CLASSIC_SYNCING', phase: 'syncing' }
  if (s.gpuActive) return { code: 'CLASSIC_GPU', phase: 'mining' }
  return { code: 'CLASSIC_SYNCING', phase: 'syncing' }
}

// Blocks found by this process divided by hours since start. Null until both exist.
function blockRatePerHour (blocksFound, startedAt, now) {
  const blocks = Number(blocksFound)
  if (!Number.isFinite(blocks) || blocks < 0 || startedAt == null || now == null) return null
  const hours = (Number(now) - Number(startedAt)) / 3600000
  if (!(hours > 0)) return null
  return blocks / hours
}

function parsePoolMiner (body) {
  if (!body || typeof body !== 'object') return null
  return {
    hashrate: num(body.hashrate_hs),
    pending: body.balance_scdo == null ? null : String(body.balance_scdo),
    paid: body.paid_scdo == null ? null : String(body.paid_scdo),
    shares: num(body.shares),
    blocks: num(body.blocks)
  }
}

function moneyText (v) {
  if (v == null || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  return String(Math.round(n * 1e8) / 1e8)
}

function moneyDelta (now, base) {
  const a = moneyText(now)
  const b = moneyText(base)
  if (a == null || b == null) return null
  const d = Math.round((Number(a) - Number(b)) * 1e8) / 1e8
  return d < 0 ? '0' : String(d)
}

function figureFrom (obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null
  const shares = num(obj.shares != null ? obj.shares : (obj.accepted != null ? obj.accepted : obj.shares_valid))
  const paid = obj.paid_scdo != null ? moneyText(obj.paid_scdo) : moneyText(obj.paid)
  const earned = obj.earned_scdo != null ? moneyText(obj.earned_scdo) : null
  if (shares == null && paid == null && earned == null) return null
  return { shares: shares, paid: paid, earned: earned }
}

// Per worker or per address only. Pool-wide counters are not this session.
function workerFigure (body, address, worker) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const keys = []
  if (worker) keys.push(String(worker))
  if (address) keys.push(String(address))
  const maps = [body.workers, body.miners, body.addresses]
  for (const map of maps) {
    if (!map || typeof map !== 'object' || Array.isArray(map)) continue
    for (const key of keys) {
      if (map[key] && typeof map[key] === 'object') {
        const hit = figureFrom(map[key])
        if (hit) return hit
      }
      const found = Object.keys(map).find(k => k.toLowerCase() === key.toLowerCase())
      if (found && map[found] && typeof map[found] === 'object') {
        const hit = figureFrom(map[found])
        if (hit) return hit
      }
    }
  }
  if (body.address && address && String(body.address).toLowerCase() === String(address).toLowerCase()) return figureFrom(body)
  return null
}

function sessionDelta (base, now) {
  if (!now) return null
  base = base || {}
  return {
    exposed: true,
    shares: now.shares != null && base.shares != null ? Math.max(0, now.shares - base.shares) : null,
    paid: moneyDelta(now.paid, base.paid),
    earned: moneyDelta(now.earned, base.earned)
  }
}

module.exports = {
  parseStatusLine,
  cudaInitFailed,
  blockRatePerHour,
  parsePoolMiner,
  workerFigure,
  sessionDelta,
  looksLikeStatus,
  peerTargetOf,
  mergeSyncView,
  etaFromSamples,
  classicGpuPhase,
  BEHIND_BLOCKS,
  ETA_WINDOW_MS
}
