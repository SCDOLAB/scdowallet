// mining mode settings (spec: MiningSettingsPanel.tsx): Solo (built-in node) or a user-entered pool address, plus
// "Keep mining" (restart the miner automatically if it exits; off by default).
;(function (M) {
  const h = (...a) => window.SafeDom.h(...a)
  const OFFICIAL_POOL = 'ethproxy+tcp://82.223.19.88:3333' // 2.0.5: official SCDO pool, prefilled when nothing is saved
  const POOL_RE = /^(stratum\+tcp|stratum\+ssl|stratum1\+tcp|stratum1\+ssl|ethproxy\+tcp|ethproxy\+ssl|ethstratum\+tcp|ethstratum\+ssl):\/\/([A-Za-z0-9.-]{1,253}|\[[0-9a-fA-F:]+\]):(\d{1,5})$/
  function render (cfg, running, handlers) {
    cfg = cfg || { miningMode: 'solo', poolUrl: '', keepMining: false }
    let mode = cfg.miningMode === 'pool' ? 'pool' : 'solo'
    const err = h('div', { class: 'err', id: 'poolErr' })
    const poolIn = h('input', { class: 'inp mono', id: 'poolUrl', value: cfg.poolUrl || OFFICIAL_POOL, placeholder: OFFICIAL_POOL, autocomplete: 'off', spellcheck: 'false', disabled: running })
    const poolRow = h('div', { class: 'field', id: 'poolRow', style: mode === 'pool' ? '' : 'display:none' }, h('div', { class: 'lbl', text: M.L('Pool address') }), poolIn, h('div', { class: 'lbl', id: 'poolHelp', text: M.L('Official SCDO pool (default). You can change it to another pool.') }))
    const radio = (v, label) => h('label', { class: 'm1-radio' }, h('input', { type: 'radio', name: 'miningMode', value: v, checked: mode === v, disabled: running, onchange: () => { mode = v; poolRow.style.display = v === 'pool' ? '' : 'none' } }), ' ' + label)
    const keep = h('input', { type: 'checkbox', id: 'keepMining', checked: !!cfg.keepMining, onchange: (e) => handlers.onKeepMining(!!e.target.checked) })
    const apply = h('button', { class: 'btn sec', id: 'miningApply', disabled: running, text: M.L('Apply mining mode'),
      onclick: async () => {
        err.textContent = ''
        const url = poolIn.value.trim()
        if (mode === 'pool' && !POOL_RE.test(url)) { err.textContent = M.L('Enter a pool address like stratum+tcp://host:port (also stratum+ssl, ethproxy+tcp, ethstratum+tcp). No user name or password in the address.'); return }
        const r = await handlers.onApply(mode, url)
        if (r && !r.ok) err.textContent = M.L('The pool address was not accepted.')
      } })
    return h('div', { class: 'card m1-card', id: 'miningSettings' },
      h('div', { class: 'm1-h', text: M.L('Mining mode') }),
      h('div', { class: 'm1-row', style: 'gap:28px' }, radio('solo', M.L('Solo (built-in SCDO node)')), radio('pool', M.L('Pool (enter a pool address)'))),
      h('div', { class: 'lbl', text: mode === 'solo' ? M.L('Solo: you only see a result when this PC finds a whole block. With one graphics card that can take a very long time, or not happen at all.') : M.L('Pool: the graphics-card miner connects directly to the pool address below.') }),
      poolRow, err,
      h('div', { class: 'm1-row', style: 'margin-top:10px' }, apply, running ? h('span', { class: 'lbl', text: M.L('Stop mining to change the mode.') }) : null),
      h('label', { class: 'm1-check', style: 'margin-top:14px' }, keep, M.L(' Keep mining: restart the miner automatically if it exits, and resume mining when the wallet starts (off by default)')))
  }
  // 2.0.7: the official pool (the only one with a payout API) - same host check as miningService.isOfficialPool
  function isOfficial (url) { const m = /^[a-z0-9+]+:\/\/([^/]+)$/i.exec(String(url || '').trim()); return !!m && m[1].toLowerCase() === '82.223.19.88:3333' }
  M.MiningSettingsPanel = { render, POOL_RE, OFFICIAL_POOL, isOfficial }
})(window.SCDOMining)
