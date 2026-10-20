// 3.1.15: Shard1–Shard4 only policy (owner decision 2026-10-20).
// The .90 rig mines only Classic Shard1–Shard4 (reward addresses 1S01… 2S02… 3S03… 4S04…).
// Shard0 EVM graphics-card bookkeeping is stopped. 60% of new Shard1–Shard4 rewards are
// transferred to the treasury address of the same shard (treasury tax).
// The remote config may name the treasury addresses (shardTreasury {1..4}) and turn Shard0
// bookkeeping back on (shard0Mining: true). Without it: Shard1–4 only, no treasury addresses.
'use strict'
;(function () {
  const PREFIX = { 1: '1S01', 2: '2S02', 3: '3S03', 4: '4S04' }
  const CLASSIC_RE = /^(1S01|2S02|3S03|4S04)[0-9a-fA-F]{37}[12]$/
  const DEFAULT_TAX = 0.6
  // Treasury Shard1–4 addresses (CEO, 2026-10-20). The remote config can replace one per shard.
  const DEFAULT_TREASURY = Object.freeze({
    1: '1S0123a229d1815b5bb8a1d45423adc787e90646b1',
    2: '2S02a22dbaed78e0c7a73fd52f20912d9201c0ad11',
    3: '3S03f4b06dbf7360c73c6f0bd05e4172b4636860f1',
    4: '4S046bb72cbeee5064e82de9acf00328b3d1813641'
  })

  function classicShard (addr) {
    const s = String(addr || '').trim()
    if (!CLASSIC_RE.test(s)) return null
    const n = Number(s[0])
    return PREFIX[n] === s.slice(0, 4) ? n : null
  }

  // remote: normalized remote config (or null). Always returns a full policy object.
  function fromRemote (remote) {
    const r = remote && typeof remote === 'object' ? remote : {}
    const treasury = { 1: '', 2: '', 3: '', 4: '' }
    const src = r.shardTreasury && typeof r.shardTreasury === 'object' ? r.shardTreasury : {}
    for (const n of [1, 2, 3, 4]) {
      const a = String(src[n] || src[String(n)] || DEFAULT_TREASURY[n]).trim()
      // A treasury address must be a Classic address on its own shard.
      treasury[n] = classicShard(a) === n ? a : DEFAULT_TREASURY[n]
    }
    const rate = Number(r.shardTaxRate)
    return {
      shard0Mining: r.shard0Mining === true,
      taxRate: Number.isFinite(rate) && rate > 0 && rate < 1 ? rate : DEFAULT_TAX,
      treasury
    }
  }

  // Remove Shard0 EVM (0) from a graphics-card pick while Shard0 bookkeeping is stopped.
  function filterPick (pick, policy) {
    const p = pick || {}
    const gpu = (p.gpu || []).filter(n => policy && policy.shard0Mining ? true : Number(n) !== 0)
    return { cpu: (p.cpu || []).slice(), gpu }
  }

  // Default pick for a new profile under the policy: graphics card on the wallet's Classic shard.
  function freshPick (caps, targets, policy) {
    const gpuAvail = !!(caps && caps.gpu && caps.gpu.available)
    const t = targets || {}
    const g = Number(t.gpu && t.gpu.shard)
    const c = Number(t.cpu && t.cpu.shard)
    if (gpuAvail) {
      if (policy && policy.shard0Mining) return { cpu: [], gpu: [0] }
      return { cpu: [], gpu: [g >= 1 && g <= 4 ? g : 1] }
    }
    return { cpu: [c >= 1 && c <= 4 ? c : 1], gpu: [] }
  }

  function isTreasury (addr, shard, policy) {
    const n = classicShard(addr)
    if (!n || !policy || !policy.treasury) return false
    if (shard != null && Number(shard) !== n) return false
    const t = policy.treasury[n]
    return !!t && t.toLowerCase() === String(addr).trim().toLowerCase()
  }

  // A Shard1–4 row is a treasury tax transfer when it goes out to that shard's treasury.
  function txKind (row, shard, policy) {
    if (!row) return 'out'
    if (row.dir === 'out' && isTreasury(row.to, shard, policy)) return 'tax'
    return row.dir
  }

  // Split a reward (integer base units, BigInt) into treasury tax and the part that stays.
  function taxSplit (amount, policy) {
    const v = BigInt(amount)
    const rate = policy && policy.taxRate ? policy.taxRate : DEFAULT_TAX
    const tax = v * BigInt(Math.round(rate * 10000)) / 10000n
    return { tax, keep: v - tax }
  }

  // Rows for the team / treasury view: one per shard, in order.
  function treasuryRows (policy, balances) {
    const b = balances || {}
    return [1, 2, 3, 4].map(n => ({
      shard: n,
      chain: 'Shard' + n,
      address: (policy && policy.treasury && policy.treasury[n]) || '',
      balance: Object.prototype.hasOwnProperty.call(b, n) ? b[n] : null
    }))
  }

  const api = { DEFAULT_TREASURY, PREFIX, CLASSIC_RE, DEFAULT_TAX, classicShard, fromRemote, filterPick, freshPick, isTreasury, txKind, taxSplit, treasuryRows }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (typeof window !== 'undefined') window.SCDOShardPolicy = Object.freeze(api)
})()
