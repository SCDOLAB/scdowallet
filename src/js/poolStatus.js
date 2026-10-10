// Live Classic pool status. Online only when the stats JSON says dry_run is false
// and chain_height is present. Unreachable or dry_run is offline for that shard only.
// Nothing here hard-codes a shard as online or offline.
'use strict'

const TTL = 60 * 1000
const TIMEOUT_MS = 4000
let cache = null
let cacheAt = 0

function judge (httpOk, body) {
  if (!httpOk || !body || typeof body !== 'object') return { online: false }
  if (body.dry_run === true) return { online: false, dry_run: true }
  if (body.chain_height == null || body.chain_height === '') return { online: false }
  const counters = body.counters && typeof body.counters === 'object' ? body.counters : {}
  return {
    online: true,
    dry_run: false,
    chain_height: body.chain_height,
    connections: body.connections,
    algorithm: body.algorithm,
    blocks_found: counters.blocks_found
  }
}

function statsUrl (pool) {
  if (!pool || !pool.statsBase) return ''
  return String(pool.statsBase).replace(/\/$/, '') + '/api/stats'
}

function reset () {
  cache = null
  cacheAt = 0
}

async function readAll (listPools, fetchImpl, now) {
  const t = now == null ? Date.now() : now
  if (cache && t - cacheAt < TTL) return cache
  const pools = listPools()
  const fetchFn = fetchImpl || fetch
  const out = {}
  await Promise.all([1, 2, 3, 4].map(async (n) => {
    const pool = pools[n] || pools[String(n)]
    const url = statsUrl(pool)
    if (!url) { out[n] = { shard: n, online: false, url: '' }; return }
    try {
      const res = await fetchFn(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
      let body = null
      if (res && res.ok) {
        try { body = await res.json() } catch (e) { body = null }
      }
      out[n] = Object.assign({ shard: n, url: url }, judge(!!(res && res.ok), body))
    } catch (e) {
      out[n] = { shard: n, url: url, online: false }
    }
  }))
  cache = out
  cacheAt = t
  return out
}

module.exports = { TTL, TIMEOUT_MS, judge, statsUrl, readAll, reset }
