// 3.1.15 temporary: the former party host is accepted only from remote zpowPools on the shard's own port.
'use strict'
const assert = require('assert')
const { poolForShard, mergeOverrides, BLOCKED_HOSTS } = require('../src/miner/zpow/pools')
const H = BLOCKED_HOSTS[0]
const cfg = { zpowPools: {} }
for (const n of [1, 2, 3, 4]) cfg.zpowPools[n] = { host: H, port: 3340 + n, statsPort: 8340 + n }
const over = mergeOverrides(cfg, null)
for (const n of [1, 2, 3, 4]) {
  const p = poolForShard(n, over)
  assert.strictEqual(p.stratum, H + ':' + (3340 + n))
  assert.strictEqual(p.statsBase, 'http://' + H + ':' + (8340 + n))
  assert.strictEqual(p.fromConfig, undefined)
}
// wrong port, no port, env/caller overrides, defaults: still refused
assert.strictEqual(poolForShard(1, mergeOverrides({ zpowPools: { 1: { host: H, port: 3342 } } }, null)).stratum, '')
assert.strictEqual(poolForShard(1, mergeOverrides({ zpowPools: { 1: { host: H } } }, null)).stratum, '')
assert.strictEqual(poolForShard(1, mergeOverrides(null, { 1: { host: H, port: 3341 } })).stratum, '')
assert.strictEqual(poolForShard(1, { 1: { host: H, port: 3341 } }).stratum, '')
assert.strictEqual(poolForShard(1, { 1: { host: H, port: 3341, fromConfig: false } }).stratum, '')
assert.strictEqual(poolForShard(1, mergeOverrides(cfg, { 1: { port: 4000 } })).stratum, '')
assert.strictEqual(poolForShard(1, mergeOverrides(cfg, { 1: { statsPort: 9000 } })).stratum, H + ':3341')
assert.strictEqual(poolForShard(1).stratum, '')
console.log('pool88-config-only ok')
