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
  return null
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
// ETA rate uses heights inside this window. Shorter spans are too noisy.
const ETA_WINDOW_MS = 3 * 60 * 1000
const ETA_MIN_SPAN_SEC = 30

// network is the higher of the peer target and the public getInfo tip.
// ETA prefers the rolling height window. download_getStatus is only a fallback
// before that window has 30s of progress.
function mergeSyncView (opts) {
  opts = opts || {}
  const local = num(opts.local)
  const downloaded = num(opts.downloaded)
  const amount = num(opts.amount)
  const durationSec = num(opts.durationSec)
  const network = maxHeight(opts.peerTarget, opts.publicTip)
  const haveSamples = !!(opts.samples && opts.samples.length >= 2)
  let etaSec = etaFromSamples(opts.samples, local, network, opts.now)
  if (etaSec == null && !haveSamples && durationSec > 0 && downloaded > 0 && amount != null && amount > downloaded) {
    etaSec = (amount - downloaded) * durationSec / downloaded
  } else if (etaSec == null && local != null && network != null && local >= network) {
    etaSec = 0
  }
  return { localBlock: local, networkBlock: network, etaSec }
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
  if (windowed.length < 2) return null
  const first = windowed[0]
  const last = windowed[windowed.length - 1]
  const dt = (Number(last.t) - Number(first.t)) / 1000
  const dh = Number(last.h) - Number(first.h)
  if (!(dt >= ETA_MIN_SPAN_SEC) || !(dh > 0)) return null
  return (network - local) * dt / dh
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

module.exports = {
  parseStatusLine,
  blockRatePerHour,
  parsePoolMiner,
  looksLikeStatus,
  peerTargetOf,
  mergeSyncView,
  etaFromSamples,
  classicGpuPhase,
  BEHIND_BLOCKS,
  ETA_WINDOW_MS
}
