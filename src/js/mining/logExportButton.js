// sanitized log export (spec: LogExportButton.tsx)
;(function (M) {
  const h = (...a) => window.SafeDom.h(...a)
  function render (onExport) {
    const note = h('div', { class: 'lbl', id: 'logExportNote', text: M.L('Keys and hashes are removed, addresses are shortened (0x1234…abcd) and your Windows user name is removed.') })
    const btn = h('button', { class: 'btn ghost small', id: 'logExport', text: M.L('Export mining logs (sanitized)'),
      onclick: async () => { btn.disabled = true; try { const r = await onExport(); if (r && r.ok) note.textContent = M.L('Saved: ') + r.file; else if (r && !r.canceled) note.textContent = M.L('Export failed.') } finally { btn.disabled = false } } })
    return h('div', { class: 'm1-row', style: 'margin-top:12px;flex-wrap:wrap' }, btn, note)
  }
  M.LogExportButton = { render }
})(window.SCDOMining)
