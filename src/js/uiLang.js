// A saved EN or CN (華語) is kept. zh-CN, zh-TW, zh-Hans and zh-Hant are 華語.
// An empty value is not a choice. The caller passes the operating-system locale:
// zh-* becomes 華語, and every other locale becomes English. That result is stored
// on first launch so the next start uses the saved choice.
'use strict'
;(function () {
  function normLang (v) {
    if (v == null) return null
    const s = String(v).trim().toUpperCase().replace(/_/g, '-')
    if (!s) return null
    if (s === 'EN' || s.startsWith('EN-')) return 'EN'
    if (s === 'CN' || s === 'TW' || s.startsWith('ZH')) return 'CN'
    return null
  }
  function langFromLocale (locale) {
    const s = String(locale == null ? '' : locale).trim().toLowerCase().replace(/_/g, '-')
    if (s === 'zh' || s.startsWith('zh-')) return 'CN'
    return 'EN'
  }
  function resolveLang (saved, locale) {
    return normLang(saved) || langFromLocale(locale)
  }
  function osLocale () {
    try {
      const electron = require('electron')
      const app = electron && electron.app
      if (app && typeof app.getLocale === 'function') {
        const v = app.getLocale()
        if (v) return String(v)
      }
    } catch (e) {}
    try {
      const v = Intl.DateTimeFormat().resolvedOptions().locale
      if (v) return String(v)
    } catch (e) {}
    return 'en'
  }
  function menuLang (lang, locale) { return resolveLang(lang, locale) }
  const api = { normLang, langFromLocale, resolveLang, osLocale, menuLang }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (typeof window !== 'undefined') window.SCDOUiLang = api
})()
