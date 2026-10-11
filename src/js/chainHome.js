// Per-chain balances, address lists and history. No cross-chain total.
// Amounts use the shared 8-decimal cut. Missing numbers stay a dash.
'use strict'
;(function () {
  const DASH = '\u2014'
  const PAGE = 8

  function amountApi () {
    if (typeof window !== 'undefined' && window.SCDOAmount) return window.SCDOAmount
    if (typeof require === 'function') {
      try { return require('./amount') } catch (e) { return null }
    }
    return null
  }

  function shortAddr (a) {
    const t = String(a || '')
    if (!t) return DASH
    if (t.length <= 12) return t
    return t.slice(0, 6) + '\u2026' + t.slice(-4)
  }

  function chainTitle (n) {
    return Number(n) === 0 ? 'Shard0 EVM' : ('Shard' + n + ' Classic')
  }

  function showUnits (units, decimals) {
    if (units == null) return DASH
    const api = amountApi()
    if (!api) return String(units)
    try { return api.fmtUnits(units, decimals) } catch (e) { return DASH }
  }

  function sortEntries (entries) {
    return (entries || []).slice().sort((a, b) => {
      const au = a && a.units != null
      const bu = b && b.units != null
      if (au && bu) {
        const d = b.units > a.units ? 1 : b.units < a.units ? -1 : 0
        if (d) return d
      } else if (au !== bu) return au ? -1 : 1
      return String(a && a.name || '').localeCompare(String(b && b.name || ''))
    })
  }

  function summarize (chain) {
    const entries = sortEntries(chain && chain.entries)
    let sum = 0n
    let dec = 18
    let known = 0
    let failed = 0
    let pending = 0
    for (const e of entries) {
      dec = e.decimals != null ? e.decimals : dec
      if (e.failed) { failed++; continue }
      if (e.units == null) { pending++; continue }
      try { sum += BigInt(e.units); known++ } catch (err) { failed++ }
    }
    let text = DASH
    if (known) text = showUnits(sum, dec)
    else if (!entries.length) text = '0'
    return {
      n: chain && chain.n,
      title: chainTitle(chain && chain.n),
      text: text,
      partial: failed > 0 && known > 0,
      failed: failed > 0,
      pending: pending > 0 && !known,
      entries: entries
    }
  }

  function pickDefault (entries, lastUsed) {
    const sorted = sortEntries(entries)
    const want = String(lastUsed || '').toLowerCase()
    if (want) {
      const hit = sorted.find(e => e.address && String(e.address).toLowerCase() === want)
      if (hit) return hit
    }
    return sorted.find(e => e.units != null) || sorted[0] || null
  }

  function scdoText (text) {
    if (text == null || text === DASH || text === '…') return DASH
    return text + ' SCDO'
  }

  function optionLabel (e) {
    const bal = e.units == null ? DASH : showUnits(e.units, e.decimals)
    return (e.name || DASH) + ' · ' + shortAddr(e.address) + ' · ' + scdoText(bal)
  }

  function selectHtml (id, entries, selected, esc) {
    const sorted = sortEntries(entries)
    const cur = selected ? String(selected).toLowerCase() : ''
    const opts = sorted.map(e => {
      const on = e.address && String(e.address).toLowerCase() === cur
      return '<option value="' + esc(e.address || '') + '"' + (on ? ' selected' : '') + '>' + esc(optionLabel(e)) + '</option>'
    }).join('')
    return '<select class="inp" id="' + esc(id) + '">' + opts + '</select>'
  }

  function txAmount (r) {
    if (r.raw != null && r.decimals != null) return showUnits(r.raw, r.decimals)
    if (r.amount == null || r.amount === '') return DASH
    const api = amountApi()
    if (!api) return String(r.amount)
    const shown = api.fmtDec(r.amount)
    return shown == null ? DASH : shown
  }

  function txRows (chain) {
    const want = String(chain && chain.filter || '').toLowerCase()
    let rows = (chain && chain.txs) || []
    if (want) rows = rows.filter(r => String(r.address || '').toLowerCase() === want)
    return rows.slice().sort((a, b) => (Number(b.t) || 0) - (Number(a.t) || 0))
  }

  function addrBlock (chain, sum, T, esc) {
    const list = sum.entries
    const scroll = list.length > PAGE ? ' addr-scroll' : ''
    const rows = list.map(e => {
      const bal = e.failed || e.units == null ? DASH : showUnits(e.units, e.decimals)
      const addr = e.address || ''
      return '<div class="addr-line" data-addr="' + esc(addr) + '"><div class="addr-main"><b>' + esc(e.name || DASH) + '</b><span class="mono">' + esc(shortAddr(addr)) + '</span><button type="button" class="link" data-act="copy" data-v="' + esc(addr) + '">' + esc(T('copy')) + '</button></div><div class="addr-bal">' + esc(scdoText(bal)) + '</div><div class="addr-go"><button type="button" class="link" data-act="recvAddr" data-v="' + esc(addr) + '" data-shard="' + esc(String(sum.n)) + '">' + esc(T('shellRecvShort')) + '</button><button type="button" class="link" data-act="remitAddr" data-v="' + esc(addr) + '" data-shard="' + esc(String(sum.n)) + '">' + esc(T('shellSendShort')) + '</button></div></div>'
    }).join('')
    return '<div class="addr-list' + scroll + '">' + rows + '</div>'
  }

  function historyHtml (chain, T, esc) {
    const title = T('shellTxOf', { name: chainTitle(chain.n) })
    const rows = txRows(chain)
    const limit = chain.txLimit == null ? PAGE : Number(chain.txLimit)
    const slice = rows.slice(0, limit)
    const body = slice.map(r => {
      const dir = r.dir === 'reward' ? 'reward' : r.dir === 'in' ? 'in' : r.dir === 'self' ? 'self' : 'out'
      const word = dir === 'in' ? T('txReceived') : dir === 'self' ? T('txSelf') : dir === 'reward' ? T('txReward') : T('txSent')
      const sign = dir === 'out' ? '\u2212' : dir === 'self' ? '' : '+'
      const when = r.time || (r.t ? new Date(r.t).toLocaleString() : DASH)
      const status = r.statusText || (r.status === 'done' ? T('d_txDone') : (r.status === 'fail' || r.status === 'error') ? T('d_txFail') : T('d_txPending'))
      const href = r.href || ''
      const link = r.hash && Number(chain.n) === 0
        ? '<button type="button" class="link" data-act="openTx" data-v="' + esc(r.hash) + '">' + esc(T('viewExplorer')) + '</button>'
        : (href ? '<button type="button" class="link" data-act="openExplorer" data-v="' + esc(href) + '">' + esc(T('viewExplorer')) + '</button>' : '')
      return '<div class="tx-line" data-chain="' + esc(String(chain.n)) + '"><span class="mono">' + esc(shortAddr(r.address)) + '</span><span>' + esc(word) + '</span><b>' + esc(sign + txAmount(r)) + ' SCDO</b><span>' + esc(when) + '</span><span>' + esc(status) + '</span>' + link + '</div>'
    }).join('')
    const more = rows.length > slice.length
      ? '<button type="button" class="link" data-act="chainTxMore" data-v="' + esc(String(chain.n)) + '">' + esc(T('shellLoadMore')) + '</button>'
      : ''
    const empty = slice.length ? '' : '<div class="muted">' + esc(T('d_noTx')) + '</div>'
    const filterRows = sortEntries(chain.entries || [])
    const filter = '<details class="shell-fold"><summary><span class="fold-shut">\u25B8</span><span class="fold-open">\u25BE</span> ' + esc(T('shellPickAddr')) + '</summary>' + selectHtml('chainFilter-' + chain.n, filterRows, chain.filter || '', esc) + '</details>'
    return '<div class="chain-tx" data-tx-chain="' + esc(String(chain.n)) + '"><div class="chain-tx-h">' + esc(title) + '</div>' + filter + empty + body + more + '</div>'
  }

  function rowsHtml (chains, T, esc) {
    return (chains || []).map(chain => {
      const sum = summarize(chain)
      const open = !!(chain && chain.open)
      const partial = sum.partial ? '<div class="chain-partial">' + esc(T('shellPartial')) + '</div>' : ''
      const body = open ? (addrBlock(chain, sum, T, esc) + historyHtml(Object.assign({}, chain, { n: sum.n, entries: sum.entries }), T, esc)) : ''
      return '<details class="shell-fold chain-card" data-chain-row="' + sum.n + '"' + (open ? ' open' : '') + '><summary><span class="chain-id"><span class="fold-shut">\u25B8</span><span class="fold-open">\u25BE</span><span class="chain-name">' + esc(sum.title) + '</span></span><b class="chain-bal">' + esc(scdoText(sum.text)) + '</b></summary>' + partial + body + '</details>'
    }).join('')
  }

  const api = {
    DASH: DASH,
    PAGE: PAGE,
    chainTitle: chainTitle,
    shortAddr: shortAddr,
    summarize: summarize,
    sortEntries: sortEntries,
    pickDefault: pickDefault,
    selectHtml: selectHtml,
    rowsHtml: rowsHtml,
    historyHtml: historyHtml,
    txRows: txRows
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (typeof window !== 'undefined') window.SCDOChainHome = Object.freeze(api)
})()
