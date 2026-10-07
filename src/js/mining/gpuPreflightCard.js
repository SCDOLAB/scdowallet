// GPU pre-flight card (spec: GpuPreflightCard.tsx), DOM-built (no innerHTML)
;(function (M) {
  const h = (...a) => window.SafeDom.h(...a)
  const COL = { ready: '#146c2e', warn: '#8a5a00', notReady: '#a3160c' }
  const BG = { ready: '#e8f7ee', warn: '#fff6e0', notReady: '#fff1f0' }
  const LABEL = { ready: 'READY', warn: 'CHECK', notReady: 'NOT READY' }
  function render (pre, loading) {
    const card = h('div', { class: 'card m1-card', id: 'gpuPreflight' }, h('div', { class: 'm1-h' , text: M.L('GPU pre-flight check') }))
    if (loading || !pre) { card.appendChild(h('div', { class: 'statusbar' }, h('span', { class: 'spin' }), M.L(' Detecting GPU hardware and drivers…'))); return card }
    if (!pre.supported) { card.appendChild(M.macNotSupportedCard()); return card }
    if (!pre.gpus.length) card.appendChild(h('div', { class: 'nogpu', text: M.L('No graphics card was detected.') }))
    for (const g of pre.gpus) {
      const st = g.status || 'notReady'
      card.appendChild(h('div', { class: 'm1-gpu' },
        h('div', { class: 'm1-row' }, h('b', { text: g.deviceName || M.L('Unknown GPU') }), h('span', { class: 'tag', style: 'background:' + BG[st] + ';color:' + COL[st], text: M.L(LABEL[st]) })),
        h('div', { class: 'm1-kv' },
          h('span', { text: M.L('Vendor: ') + g.vendor }),
          h('span', { text: M.L('VRAM: ') + (g.vramGB ? g.vramGB + ' GB' + (g.vramApprox ? M.L(' (approx.)') : '') : M.L('unknown')) }),
          h('span', { text: M.L('Driver: ') + (g.driverVersion || M.L('not detected')) }),
          h('span', { text: M.L('CUDA: ') + (g.cuda ? M.L('yes') : M.L('no')) })),
        h('ul', { class: 'm1-reasons' }, (g.reasons || []).map(r => h('li', { text: M.reason(r) })))))
    }
    card.appendChild(h('div', { class: 'lbl', text: M.L('Checked ') + new Date(pre.checkedAt || Date.now()).toLocaleString(M.locale()) + M.L('. Minimum: NVIDIA GPU with CUDA driver and 4 GB VRAM.') }))
    return card
  }
  // Mac: static notice, GPU mining is not offered (spec: Mac static hint card)
  M.macNotSupportedCard = function () {
    return h('div', { class: 'nogpu', id: 'macNoGpu' }, h('b', { text: M.L('GPU mining not supported on Mac') }),
      h('div', { style: 'margin-top:6px;font-size:17px', text: M.L('Macs have no CUDA support and the built-in miner (Rigel) has no macOS version, so GPU mining is not offered on this computer. Accounts, transfers and the network stats below work normally.') }))
  }
  M.GpuPreflightCard = { render }
})(window.SCDOMining)
