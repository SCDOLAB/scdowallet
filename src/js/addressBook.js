// 3.1.15: address book + recent recipients and the address-poisoning check (same rules as iOS/Android).
// A lookalike shares the first 4 and last 4 characters with a known address but differs in the middle.
;(function (root) {
  'use strict'
  const EDGE = 4
  const RECENT_LIMIT = 20
  function key (a) { let s = String(a == null ? '' : a).trim().toLowerCase(); if (s.startsWith('0x')) s = s.slice(2); return s }
  function body (a) { let s = key(a); if (s.length === 42 && /[0-9]/.test(s[0]) && s[1] === 's') s = s.slice(4, -1); return s }
  function lookalike (candidate, known) {
    const c = body(candidate)
    if (c.length <= EDGE * 2) return null
    for (const k of known || []) {
      const b = body(k)
      if (b.length !== c.length || b === c) continue
      if (b.slice(0, EDGE) === c.slice(0, EDGE) && b.slice(-EDGE) === c.slice(-EDGE)) return k
    }
    return null
  }
  function clean (list) {
    return (Array.isArray(list) ? list : []).filter(e => e && typeof e.address === 'string' && e.address.trim())
      .map(e => ({ address: e.address.trim(), name: String(e.name || '').trim().slice(0, 60), lastUsed: Number(e.lastUsed) || 0 }))
  }
  function find (list, a) { const k = key(a); return clean(list).find(e => key(e.address) === k) || null }
  function recordSend (list, a, now) {
    const out = clean(list); const k = key(a)
    const e = out.find(x => key(x.address) === k)
    if (e) e.lastUsed = now; else out.push({ address: String(a).trim(), name: '', lastUsed: now })
    const unnamed = out.filter(x => !x.name).sort((x, y) => y.lastUsed - x.lastUsed)
    const drop = new Set(unnamed.slice(RECENT_LIMIT).map(x => key(x.address)))
    return out.filter(x => x.name || !drop.has(key(x.address)))
  }
  function save (list, a, name) {
    const out = clean(list); const n = String(name || '').trim().slice(0, 60); const k = key(a)
    const e = out.find(x => key(x.address) === k)
    if (e) e.name = n; else out.push({ address: String(a).trim(), name: n, lastUsed: 0 })
    return out
  }
  function chips (list, max) {
    const all = clean(list)
    const named = all.filter(e => e.name)
    const recent = all.filter(e => !e.name && e.lastUsed).sort((x, y) => y.lastUsed - x.lastUsed)
    return named.concat(recent).slice(0, max || 12)
  }
  const api = { EDGE, RECENT_LIMIT, key, lookalike, find, recordSend, save, chips }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (root) root.SCDOAddressBook = api
})(typeof window !== 'undefined' ? window : null)
