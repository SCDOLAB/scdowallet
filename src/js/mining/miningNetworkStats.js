// network stats panel (spec: MiningNetworkStats.tsx). Facts only: hashrate, difficulty, block time, height, share.
;(function (M) {
  const h = (...a) => window.SafeDom.h(...a)
  function grouped (x) {
    const n = Number(x)
    if (!Number.isFinite(n) || n < 0) return ''
    return Math.round(n).toLocaleString('en-US')
  }
  function fmtHash (x) {
    const n = grouped(x)
    if (!n || !(Number(x) > 0)) return M.L('Mining speed is still being worked out')
    return M.L('Mining speed ') + n + M.L(' tries per second')
  }
  function fmtInt (s) { try { return BigInt(s).toLocaleString('en-US') } catch (e) { return String(s) } }
  function fmtShare (p) {
    if (!(p > 0)) return M.L('Your share is about 0 percent')
    if (p >= 100) return M.L('Your share looks higher than the whole network because the estimate is behind')
    const t = p >= 0.01 ? p.toFixed(2) : p.toPrecision(2)
    return M.L('Your share is about ') + t + M.L(' percent')
  }
  function explain (label, value, id, tip) {
    return h('div', {
      class: 'stat explain', tabindex: '0',
      'data-tip-name': tip.name, 'data-tip-value': value, 'data-tip-explain': tip.explain, 'data-tip-detail': tip.detail || ''
    }, h('div', { class: 'lbl', text: label }), h('div', { class: 'v', id, text: value }))
  }
  // source words come from the renderer so they follow the UI language (TW table in types.js)
  const SOURCES = { scdoscanMainPublic: 'scdoscan.io EVM public node' }
  function sourceText (s) { return M.L(SOURCES[s.sourceKey] || s.source || '') }
  function render (s, fetching) {
    const card = h('div', { class: 'card m1-card', id: 'netStats' }, h('div', { class: 'm1-row' }, h('div', { class: 'm1-h', text: M.L('Shard0 (EVM) network') }),
      h('button', { class: 'btn ghost small', id: 'netStatsRefresh', 'data-act': 'netStatsRefresh', text: fetching ? M.L('Refreshing…') : M.L('Refresh') })))
    if (!s) { card.appendChild(h('div', { class: 'statusbar' }, h('span', { class: 'spin' }), M.L(' Loading network data…'))); return card }
    if (!s.ok) { card.appendChild(h('div', { class: 'statusbar bad', text: M.L('Network data not available right now (') + (s.error || M.L('offline')) + M.L('). Retrying every 30 seconds.') })); return card }
    const stale = Date.now() - new Date(s.asOf).getTime() > 5 * 60 * 1000
    const blockLine = s.blockTimeSec
      ? M.L('About ') + Number(s.blockTimeSec).toFixed(1) + M.L(' seconds between blocks, counted from the last ') + s.window + M.L(' blocks')
      : M.L('The time between blocks is still being worked out')
    const heightLine = M.L('Block ') + fmtInt(s.height) + M.L(' on the ledger')
    const diffLine = M.L('Difficulty ') + fmtInt(s.difficulty)
    const yours = s.localHashrate > 0 ? fmtHash(s.localHashrate) : M.L('You are not mining yet, so there is no speed')
    const share = fmtShare(s.sharePercent)
    const netSpeed = fmtHash(s.networkHashrate)
    card.appendChild(h('div', { class: 'stats' + (stale ? ' m1-stale' : '') },
      explain(M.L('Network mining speed'), netSpeed, 'nsHash', { name: M.L('Network mining speed'), explain: M.L('Speed means how many tries happen each second. More tries make a block more likely.'), detail: M.L('This is an estimate for the whole network, not a promise.') }),
      explain(M.L('Mining difficulty'), diffLine, 'nsDiff', { name: M.L('Mining difficulty'), explain: M.L('Difficulty is how hard it is to find the next block. A bigger number needs more tries.') }),
      explain(M.L('Time between blocks'), blockLine, 'nsBlockTime', { name: M.L('Time between blocks'), explain: M.L('This is the average wait between blocks. It changes when the network changes.') }),
      explain(M.L('How far the ledger has been written'), heightLine, 'nsHeight', { name: M.L('How far the ledger has been written'), explain: M.L('This is how far this chain\'s ledger has been written.') }),
      explain(M.L('Your mining speed'), yours, 'nsLocal', { name: M.L('Your mining speed'), explain: M.L('This is your computer\'s mining speed. It is zero until mining starts.') }),
      explain(M.L('Your share of mining'), share, 'nsShare', { name: M.L('Your share of mining'), explain: M.L('This is your computer\'s share of all the tries on the network.') })))
    card.appendChild(h('div', { class: 'lbl', text: M.L('As of ') + new Date(s.asOf).toLocaleString(M.locale()) + M.L(' · source: ') + sourceText(s) + M.L(' · mining speed is tries per second, estimated from difficulty and the average time between blocks') }))
    card.appendChild(h('div', { class: 'm1-disc', text: M.L('Figures are estimates derived from current network data and change constantly; they are not a forecast. Mining uses your hardware and electricity and can add heat, noise and wear.') }))
    return card
  }
  M.MiningNetworkStats = { render, fmtHash }
})(window.SCDOMining)
