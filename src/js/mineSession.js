// 3.1.0: chain selection (what the next manual Start uses) is not the running state.
// A 3.0.x Classic GPU profile migrates to that Classic chain only. Shard0 EVM is opt-in.
// Launch starts miners only when auto-resume is explicitly on.
'use strict'
;(function () {
  function shardOf (addr) {
    const s = String(addr || '')
    if (/^[1-4]S[0-9a-fA-F]{40}$/.test(s)) return Number(s[0])
    return 1
  }

  // Old localStorage → checkbox lists. Running flags are not a selection.
  // Classic GPU (even with a stuck Shard0 "was running" flag) stays Classic only.
  // Returns null when there is no 3.0.x intent to migrate.
  function migrateSelection (store) {
    store = store || {}
    if (store.minerPickClassicGpu || store.minerPickClassicCpu === '1' || store.minerPickShard0 === '1') return null
    const gpuRun = String(store.minerRunClassicGpu || '')
    const mode = store.minerMode || ''
    // The saved mode wins over stuck running flags. Classic GPU only stays Classic GPU.
    let classicGpu = gpuRun === 'gpu' || gpuRun === 'external'
    let classicCpu = store.minerRunClassicCpu === '1'
    if (mode === 'classic-gpu') { classicGpu = true; classicCpu = false }
    else if (mode === 'classic-cpu') { classicCpu = true; classicGpu = false }
    const shard0Mode = mode === 'mine' || mode === 'shard0'
    if (!classicGpu && !classicCpu && !shard0Mode) return null
    const cpu = classicCpu ? ALL_CLASSIC.slice() : []
    const gpu = classicGpu ? [shardOf(store.minerClassicGpu || store.minerClassic)] : []
    // Shard0 EVM only when that was the saved mode and this profile was not Classic-only.
    if (shard0Mode && !classicGpu && !classicCpu && gpu.indexOf(0) < 0) gpu.unshift(0)
    return { cpu: cpu, gpu: gpu }
  }

  // 3.1.5: the processor mines every Classic shard (1–4) at once, one zminer per
  // shard, sharing the thread slider. A new profile with a graphics card ticks
  // Shard0 EVM on the GPU side and all four Classic shards on the CPU side.
  const ALL_CLASSIC = [1, 2, 3, 4]

  function freshSelection (caps, targets) {
    if (caps && caps.gpu && caps.gpu.available) return { cpu: ALL_CLASSIC.slice(), gpu: [0] }
    return { cpu: ALL_CLASSIC.slice(), gpu: [] }
  }

  // 3.1.5: split the thread slider total across the enabled Classic shards.
  // Even split; the remainder goes to the lowest shard numbers. Every shard
  // gets at least 1 thread while the total allows it. Pure function.
  // splitThreads(8, [1,2,3,4]) → {1:2, 2:2, 3:2, 4:2}; 6 → {1:2, 2:2, 3:1, 4:1}.
  function splitThreads (total, shards) {
    const seen = []
    for (const raw of shards || []) {
      const n = Number(raw)
      if (n >= 1 && n <= 4 && seen.indexOf(n) < 0) seen.push(n)
    }
    seen.sort((a, b) => a - b)
    const out = {}
    if (!seen.length) return out
    let n = Math.floor(Number(total))
    if (!Number.isFinite(n) || n < 1) n = 1
    if (n < seen.length) {
      for (let i = 0; i < n; i++) out[seen[i]] = 1
      return out
    }
    const base = Math.floor(n / seen.length)
    let rem = n % seen.length
    for (const s of seen) {
      out[s] = base + (rem > 0 ? 1 : 0)
      if (rem > 0) rem--
    }
    return out
  }

  // autoResume must be strictly true. A "was running" flag never starts a miner by itself.
  // When a resume snapshot exists it wins, so a stuck Shard0 flag cannot ride along.
  function launchPlan (opts) {
    opts = opts || {}
    if (opts.autoResume !== true) return { start: [] }
    const snap = opts.resume
    const hasSnap = !!(snap && typeof snap === 'object')
    const src = hasSnap ? snap : (opts.running || {})
    const start = []
    if (src.cpu) start.push('cpu')
    if (src.classicGpu) start.push('classicGpu')
    if (src.shard0) start.push('shard0')
    return { start: start }
  }

  function clearedFlags (store) {
    const next = Object.assign({}, store || {})
    next.minerRunClassicCpu = ''
    next.minerRunClassicGpu = ''
    next.minerRunShard0 = ''
    return next
  }

  const api = { shardOf, migrateSelection, freshSelection, splitThreads, launchPlan, clearedFlags }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (typeof window !== 'undefined') window.SCDOMineSession = Object.freeze(api)
})()
