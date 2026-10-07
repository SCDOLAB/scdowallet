// network stats panel (spec: MiningNetworkStats.tsx). Facts only: hashrate, difficulty, block time, height, share.
;(function (M) {
  const h = (...a) => window.SafeDom.h(...a)
  function fmtHash (x) { if (!(x > 0)) return '0 H/s'; const u = ['H/s', 'kH/s', 'MH/s', 'GH/s', 'TH/s', 'PH/s']; let i = 0; while (x >= 1000 && i < u.length - 1) { x /= 1000; i++ } return x.toFixed(2) + ' ' + u[i] }
  function fmtInt (s) { try { return BigInt(s).toLocaleString('en-US') } catch (e) { return String(s) } }
  function fmtShare (p) { if (!(p > 0)) return '0 %'; if (p >= 100) return M.L('> 100 % (estimate lags behind)'); return (p >= 0.01 ? p.toFixed(2) : p.toPrecision(2)) + ' %' }
  function stat (label, value, id) { return h('div', { class: 'stat' }, h('div', { class: 'lbl', text: label }), h('div', { class: 'v', id, text: value })) }
  function render (s, fetching) {
    const card = h('div', { class: 'card m1-card', id: 'netStats' }, h('div', { class: 'm1-row' }, h('div', { class: 'm1-h', text: M.L('Network stats (SCDO Shard0)') }),
      h('button', { class: 'btn ghost small', id: 'netStatsRefresh', 'data-act': 'netStatsRefresh', text: fetching ? M.L('Refreshing…') : M.L('Refresh') })))
    if (!s) { card.appendChild(h('div', { class: 'statusbar' }, h('span', { class: 'spin' }), M.L(' Loading network data…'))); return card }
    if (!s.ok) { card.appendChild(h('div', { class: 'statusbar bad', text: M.L('Network data not available right now (') + (s.error || M.L('offline')) + M.L('). Retrying every 30 s.') })); return card }
    const stale = Date.now() - new Date(s.asOf).getTime() > 5 * 60 * 1000
    card.appendChild(h('div', { class: 'stats' + (stale ? ' m1-stale' : '') },
      stat(M.L('Network hashrate (estimate)'), fmtHash(s.networkHashrate), 'nsHash'),
      stat(M.L('Difficulty'), fmtInt(s.difficulty), 'nsDiff'),
      stat(M.L('Average block time (last ') + s.window + M.L(' blocks)'), s.blockTimeSec ? s.blockTimeSec.toFixed(1) + ' s' : '–', 'nsBlockTime'),
      stat(M.L('Block height'), fmtInt(s.height), 'nsHeight'),
      stat(M.L('Your hashrate'), s.localHashrate > 0 ? fmtHash(s.localHashrate) : M.L('not mining'), 'nsLocal'),
      stat(M.L('Your share of network hashrate'), fmtShare(s.sharePercent), 'nsShare')))
    card.appendChild(h('div', { class: 'lbl', text: M.L('As of ') + new Date(s.asOf).toLocaleString(M.locale()) + M.L(' · source: ') + s.source + M.L(' · hashrate = difficulty ÷ average block time') }))
    card.appendChild(h('div', { class: 'm1-disc', text: M.L('Figures are estimates derived from current network data and change constantly; they are not a forecast. Mining uses your hardware and electricity and can add heat, noise and wear.') }))
    return card
  }
  M.MiningNetworkStats = { render, fmtHash }
})(window.SCDOMining)
