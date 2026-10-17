// Classic pool endpoints. Shard1–Shard4 use the same host and the next ports.
// Whether a pool is online is not stored here: the wallet reads /api/stats.
// 3.1.6: there is NO built-in host. The old default belonged to the former project party and is being
// shut down; the wallet must never connect to it. A Shard1–4 pool is used only when the remote config
// (zpowPools) or env SCDO_ZPOW_POOLS names one. Without a host, CPU mining reports NO_POOL and the
// stats poller makes no request. Blocked hosts are dropped even when a config names them.
'use strict'

const DEFAULT_HOST = null
const BLOCKED_HOSTS = ['82.223.19.88']
function hostAllowed (h) { return !!h && !BLOCKED_HOSTS.includes(String(h).trim()) }
const HOST_RE = /^[A-Za-z0-9.-]{1,253}$/

const DEFAULT_POOLS = {
  1: { shard: 1, host: DEFAULT_HOST, port: 3341, statsPort: 8341 },
  2: { shard: 2, host: DEFAULT_HOST, port: 3342, statsPort: 8342 },
  3: { shard: 3, host: DEFAULT_HOST, port: 3343, statsPort: 8343 },
  4: { shard: 4, host: DEFAULT_HOST, port: 3344, statsPort: 8344 }
}

function poolsFromEnv (env) {
  env = env || process.env
  const raw = env.SCDO_ZPOW_POOLS
  if (!raw) return null
  let parsed
  try { parsed = JSON.parse(raw) } catch (e) {
    const err = new Error('SCDO_ZPOW_POOLS is not JSON')
    err.code = 'BAD_POOLS'
    throw err
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const err = new Error('SCDO_ZPOW_POOLS must be an object keyed by shard')
    err.code = 'BAD_POOLS'
    throw err
  }
  return parsed
}

function remotePoolOverrides (remote) {
  const zp = remote && remote.zpowPools
  if (!zp || typeof zp !== 'object' || Array.isArray(zp)) return null
  const out = {}
  for (const key of Object.keys(zp)) {
    const n = Number(key)
    if (n !== 1 && n !== 2 && n !== 3 && n !== 4) continue
    const src = zp[key]
    if (!src || typeof src !== 'object' || Array.isArray(src)) continue
    const o = {}
    if (src.host != null) {
      const host = String(src.host).trim()
      if (HOST_RE.test(host) && hostAllowed(host)) o.host = host
    }
    if (src.port != null) {
      const port = Number(src.port)
      if (Number.isInteger(port) && port >= 1 && port <= 65535) o.port = port
    }
    if (src.statsPort != null) {
      const statsPort = Number(src.statsPort)
      if (Number.isInteger(statsPort) && statsPort >= 1 && statsPort <= 65535) o.statsPort = statsPort
    }
    if (Object.keys(o).length) out[n] = o
  }
  return Object.keys(out).length ? out : null
}

// Remote config first, then env / caller overrides replace a host or port.
function mergeOverrides (remote, envOverrides) {
  const base = remotePoolOverrides(remote) || {}
  const env = envOverrides && typeof envOverrides === 'object' && !Array.isArray(envOverrides) ? envOverrides : {}
  const out = {}
  for (const n of [1, 2, 3, 4]) {
    const a = base[n] || base[String(n)]
    const b = env[n] || env[String(n)]
    if (a || b) out[n] = Object.assign({}, a || {}, b || {})
  }
  return Object.keys(out).length ? out : null
}

function poolForShard (shard, overrides) {
  const n = Number(shard)
  if (!DEFAULT_POOLS[n]) {
    const err = new Error('classic pool shard must be 1, 2, 3 or 4')
    err.code = 'BAD_SHARD'
    throw err
  }
  const extra = overrides && (overrides[n] || overrides[String(n)])
  const pool = Object.assign({}, DEFAULT_POOLS[n], extra || {})
  pool.shard = n
  pool.host = hostAllowed(pool.host) ? String(pool.host).trim() : ''
  pool.port = Number(pool.port)
  pool.statsPort = Number(pool.statsPort)
  if (!pool.host) {
    // No pool configured for this shard: nothing to connect to, nothing to poll.
    pool.stratum = ''
    pool.statsBase = ''
    return pool
  }
  if (!pool.port || !pool.statsPort) {
    const err = new Error('pool for shard ' + n + ' is missing host, port or statsPort')
    err.code = 'BAD_POOLS'
    throw err
  }
  pool.stratum = pool.host + ':' + pool.port
  pool.statsBase = 'http://' + pool.host + ':' + pool.statsPort
  return pool
}

function minerStatsUrl (pool, address) {
  if (!pool || !pool.statsBase) {
    const err = new Error('pool is required')
    err.code = 'BAD_POOLS'
    throw err
  }
  return pool.statsBase.replace(/\/$/, '') + '/api/miner/' + encodeURIComponent(address)
}

function defaultCpuThreads (cpuCount) {
  const n = Number(cpuCount)
  if (!Number.isFinite(n) || n < 1) return 1
  return Math.max(1, Math.floor(n / 2))
}

module.exports = {
  DEFAULT_HOST,
  BLOCKED_HOSTS,
  hostAllowed,
  DEFAULT_POOLS,
  poolsFromEnv,
  remotePoolOverrides,
  mergeOverrides,
  poolForShard,
  minerStatsUrl,
  defaultCpuThreads
}
