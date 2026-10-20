// 3.0.8: first launch is 華語, stored as 'CN'.
// A saved EN stays English. zh-CN, zh-TW, zh-Hans, zh-Hant and any other value are 華語.
// The operating-system language is never read. Mac used to open in English because the
// shipped viewconfig and migrateConfig wrote lang "EN", and the menu treated every other
// value as English (src/js/menu.js).
'use strict'
;(function () {
  function normLang (v) {
    if (v == null) return 'CN'
    const s = String(v).trim().toUpperCase().replace(/_/g, '-')
    if (!s) return 'CN'
    if (s === 'EN' || s.startsWith('EN-')) return 'EN'
    return 'CN'
  }
  // Native menu labels follow the same rule, including when no language has been passed yet.
  function menuLang (lang) { return normLang(lang) }
  const api = { normLang, menuLang }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (typeof window !== 'undefined') window.SCDOUiLang = api
})()
