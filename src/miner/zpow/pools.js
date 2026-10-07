// Classic pool endpoints. Shard 1 is live; shards 2–4 use the same host and
// the next ports, and may not be serving yet. Overrides come from the caller
// (env SCDO_ZPOW_POOLS is a JSON object keyed by shard).
'use strict'

const DEFAULT_HOST = '82.223.19.88'

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
  pool.host = String(pool.host || DEFAULT_HOST)
  pool.port = Number(pool.port)
  pool.statsPort = Number(pool.statsPort)
  if (!pool.host || !pool.port || !pool.statsPort) {
    const err = new Error('pool for shard ' + n + ' is missing host, port or statsPort')
    err.code = 'BAD_POOLS'
    throw err
  }
  pool.stratum = pool.host + ':' + pool.port
  pool.statsBase = 'http://' + pool.host + ':' + pool.statsPort
  pool.live = n === 1
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
  DEFAULT_POOLS,
  poolsFromEnv,
  poolForShard,
  minerStatsUrl,
  defaultCpuThreads
}
