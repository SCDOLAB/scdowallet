// network stats store (spec: src/hooks/useMiningNetworkStats.ts). Data comes from the main process ('mining:networkStats'),
// which reads SCDO Shard0 blocks from the scdoscan.io RPC: tip height, difficulty, mean block time over the last 120 blocks,
// network hashrate estimate = difficulty / mean block time, and this PC's share = local hashrate / network hashrate.
;(function (M) {
  const listeners = new Set(); let stats = null; let fetching = false; let timer = null
  async function refresh () {
    if (fetching) return stats; fetching = true; emit()
    try { stats = await window.scdo.invoke('mining:networkStats') } catch (e) { stats = { ok: false, error: e.message } } finally { fetching = false; emit() }
    return stats
  }
  function emit () { for (const f of listeners) { try { f(stats, fetching) } catch (e) {} } }
  function subscribe (f) { listeners.add(f); if (!timer) { refresh(); timer = setInterval(refresh, 30000) } return () => { listeners.delete(f); if (!listeners.size && timer) { clearInterval(timer); timer = null } } }
  M.networkStats = { refresh, subscribe, get: () => stats, isFetching: () => fetching }
})(window.SCDOMining)
