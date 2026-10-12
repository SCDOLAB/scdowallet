// 2.0.10: full-width / compatibility chars -> half-width ASCII before address/amount/key validation.
// NFKC folds ０ｘＡ… and １．５ to 0xA… / 1.5; then strip zero-width/BOM/NBSP and trim.
'use strict'
function normalizeHalfWidth (s) {
  return String(s == null ? '' : s)
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '')
    .trim()
}
if (typeof module !== 'undefined' && module.exports) module.exports = { normalizeHalfWidth }
else if (typeof window !== 'undefined') window.normalizeHalfWidth = normalizeHalfWidth
