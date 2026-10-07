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
  return null
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

module.exports = { parseStatusLine, blockRatePerHour, parsePoolMiner, looksLikeStatus }
