// Lines written into the backup PNG and the backup .txt.
// The phrase is the key. Callers pass the reminder already translated.
'use strict'
;(function () {
  function wrap (s, n) {
    const src = String(s || '')
    const out = []
    let cur = ''
    for (const ch of src) {
      cur += ch
      if (cur.length >= n) { out.push(cur); cur = '' }
    }
    if (cur) out.push(cur)
    return out.length ? out : ['']
  }
  function lines (opts) {
    opts = opts || {}
    const words = Array.isArray(opts.words) ? opts.words : String(opts.phrase || '').trim().split(/\s+/).filter(Boolean)
    const dateLabel = opts.dateLabel || '日期'
    const addrLabel = opts.addrLabel || 'Shard0 EVM'
    const out = []
    wrap(opts.reminder || '', 28).forEach(x => out.push(x))
    out.push('')
    out.push(dateLabel + ' ' + String(opts.date || ''))
    out.push(addrLabel + ' ' + String(opts.address || ''))
    out.push('')
    words.forEach((w, i) => out.push((i + 1) + '. ' + w))
    return out
  }
  function text (opts) {
    return lines(opts).join('\n') + '\n'
  }
  const api = { wrap, lines, text }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (typeof window !== 'undefined') window.SCDOBackupCard = api
})()
