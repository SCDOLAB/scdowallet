// mining batch-1 section of the Mining tab (spec: MiningPage.tsx). app112.js renders the existing miner controls and
// calls mount() with a placeholder element; everything here is DOM-built (no innerHTML).
;(function (M) {
  const h = (...a) => window.SafeDom.h(...a)
  let cfg = null; let unsub = null
  async function loadConfig () { try { cfg = await window.scdo.invoke('mining:getConfig') } catch (e) { cfg = { miningMode: 'solo', poolUrl: '', keepMining: false } } return cfg }
  function mount (root, ctx) {
    if (!root) return
    const isMac = M.getPlatform() === M.PlatformType.MACOS
    const running = !!(ctx.miner && ctx.miner.running)
    const pre = M.gpuDetector.get()
    const parts = []
    parts.push(M.GpuPreflightCard.render(pre, !pre && !isMac))
    if (!pre && !isMac) M.gpuDetector.detect().then(() => ctx.rerender())
    if (!isMac) {
      if (!cfg) loadConfig().then(() => ctx.rerender())
      else {
        parts.push(M.MiningSettingsPanel.render(cfg, running, {
          onApply: async (mode, url) => { const r = await window.scdo.invoke('mining:setConfig', { miningMode: mode, poolUrl: url }); if (r && r.ok) { cfg = Object.assign({}, cfg, { miningMode: r.miningMode, poolUrl: r.poolUrl || cfg.poolUrl }); ctx.toast(r.miningMode === 'pool' ? M.L('Pool mode saved: ') + r.poolUrl : M.L('Solo mode saved')); ctx.rerender() } return r },
          onKeepMining: async (on) => { const r = await window.scdo.invoke('mining:setKeepMining', on); cfg = Object.assign({}, cfg, { keepMining: !!(r && r.keepMining) }); ctx.toast(on ? M.L('Keep mining is on') : M.L('Keep mining is off')) }
        }))
      }
    }
    // 2.0.7 (P2): pool payout progress, pool mode only (reward address = the running miner's, else the saved choice)
    if (!isMac && cfg && cfg.miningMode === 'pool' && M.PayoutProgressCard) {
      const addr = (ctx.miner && ctx.miner.running && ctx.miner.wallet) || localStorage.getItem('minerReward') || ''
      const pool = (ctx.miner && ctx.miner.running && ctx.miner.poolUrl) || cfg.poolUrl || ''
      parts.push(M.PayoutProgressCard.render({ address: addr, poolUrl: pool, official: M.MiningSettingsPanel.isOfficial(pool) }))
    }
    const statsBox = h('div', { id: 'netStatsBox' })
    parts.push(statsBox)
    const draw = (s, f) => { const c = M.MiningNetworkStats.render(s, f); statsBox.replaceChildren(c) }
    draw(M.networkStats.get(), M.networkStats.isFetching())
    if (unsub) unsub()
    unsub = M.networkStats.subscribe((s, f) => { if (document.body.contains(statsBox)) draw(s, f) })
    if (!isMac) parts.push(h('div', { class: 'card m1-card' }, h('div', { class: 'm1-h', text: M.L('Logs') }), M.LogExportButton.render(() => M.minerLogger.exportLogs())))
    root.replaceChildren(...parts)
  }
  function setKeep (on) { if (cfg) cfg.keepMining = !!on }
  function unmount () { if (unsub) { unsub(); unsub = null } }
  M.MiningPage = { mount, unmount, loadConfig, setKeep, getConfig: () => cfg }
})(window.SCDOMining)
