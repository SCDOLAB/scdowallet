// 3.1.15 RC6: a send shows in history at once as a pending row (hash, amount, to, shard),
// until the history source lists the same hash. Shard0 rows turn done/fail from the receipt.
'use strict'
;(function () {
  const KEY = 'pendingTx315'
  const MAX_AGE = 24 * 3600 * 1000
  const norm = (h) => String(h || '').toLowerCase().replace(/^0x/, '')
  function load (store) { try { const v = JSON.parse(store.getItem(KEY) || '[]'); return Array.isArray(v) ? v : [] } catch (e) { return [] } }
  function save (store, list) { try { store.setItem(KEY, JSON.stringify(list.slice(0, 50))) } catch (e) {} }
  function add (list, e, now) {
    if (!e || !norm(e.hash) || !e.from) return list
    const row = { hash: String(e.hash), from: String(e.from), to: String(e.to || ''), amount: String(e.amount || ''), shard: Number(e.shard) || 0, t: now, status: 'pending' }
    return [row].concat(list.filter(p => norm(p.hash) !== norm(e.hash)))
  }
  function setStatus (list, hash, status) { return list.map(p => norm(p.hash) === norm(hash) ? Object.assign({}, p, { status: status }) : p) }
  // Drop entries the source already lists (or that are old) and return the rows to show for one address.
  function prune (list, rowsByAddr, now) {
    return list.filter(p => {
      if (now - Number(p.t) > MAX_AGE) return false
      const rows = rowsByAddr[String(p.from).toLowerCase()] || []
      return !rows.some(r => norm(r.hash) === norm(p.hash))
    })
  }
  function merge (rows, list, address) {
    const a = String(address || '').toLowerCase()
    const have = new Set((rows || []).map(r => norm(r.hash)))
    const extra = list.filter(p => String(p.from).toLowerCase() === a && !have.has(norm(p.hash)))
      .map(p => ({ hash: p.hash, from: p.from, to: p.to, amount: p.amount, dir: 'out', status: p.status, t: new Date(p.t).toISOString(), asset: 'SCDO', local: true }))
    return extra.concat(rows || [])
  }
  const api = { KEY, load, save, add, setStatus, prune, merge }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (typeof window !== 'undefined') window.SCDOPendingTx = api
})()
