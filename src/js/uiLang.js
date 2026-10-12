// 3.0.8: first launch is 華語 (Traditional Chinese, stored as 'CN').
// A language the user already saved ('EN' or 'CN', including zh / TW spellings) is kept.
// The operating-system language is never read. Mac used to open in English because the
// shipped viewconfig and migrateConfig wrote lang "EN", and the menu treated every other
// value as English (src/js/menu.js).
'use strict'
;(function () {
  function normLang (v) {
    if (v == null) return 'CN'
    const s = String(v).trim().toUpperCase()
    if (!s) return 'CN'
    if (s === 'EN' || s.startsWith('EN-') || s.startsWith('EN_')) return 'EN'
    return 'CN'
  }
  // Native menu labels follow the same rule, including when no language has been passed yet.
  function menuLang (lang) { return normLang(lang) }
  const api = { normLang, menuLang }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (typeof window !== 'undefined') window.SCDOUiLang = api
})()
