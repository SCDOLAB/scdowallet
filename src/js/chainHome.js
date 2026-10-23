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

  function balanceView (units, decimals) {
    if (units == null) return { short: DASH, full: '' }
    const api = amountApi()
    if (!api) return { short: String(units), full: '' }
    try {
      if (api.fmtBalance) return api.fmtBalance(units, decimals)
      const t = api.fmtUnits(units, decimals)
      return { short: t, full: t }
    } catch (e) { return { short: DASH, full: '' } }
  }

  function showUnits (units, decimals) {
    return balanceView(units, decimals).short
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
    let full = ''
    if (known) {
      const view = balanceView(sum, dec)
      text = view.short
      full = view.full
    }
    // No address on this chain is not a zero balance. A dash stays until a real read arrives.
    return {
      n: chain && chain.n,
      title: chainTitle(chain && chain.n),
      text: text,
      full: full,
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

  function accountMenuHtml (id, entries, selected, esc) {
    const sorted = sortEntries(entries)
    const cur = selected ? String(selected).toLowerCase() : ''
    const row = (e, tag, on) => {
      const view = balanceView(e.units, e.decimals)
      const bal = e.units == null ? DASH : scdoText(view.short)
      const tip = e.units == null ? '' : scdoText(view.full || view.short)
      const dash = e.units == null ? ' dash' : ''
      const attr = tag === 'button' ? ' type="button" data-pay-addr="' + esc(e.address || '') + '"' : ''
      return '<' + tag + ' class="pay-acct-row' + (on ? ' on' : '') + '"' + attr + '>' +
        '<span class="pay-acct-name">' + esc(e.name || DASH) + '</span>' +
        '<span class="pay-acct-addr">' + esc(shortAddr(e.address)) + '</span>' +
        '<b class="pay-acct-bal' + dash + '" title="' + esc(tip) + '">' + esc(bal) + '</b>' +
        '</' + tag + '>'
    }
    const picked = sorted.find(e => e.address && String(e.address).toLowerCase() === cur) || null
    const head = picked ? row(picked, 'span', false) : '<span class="pay-acct-row"><span class="pay-acct-name">' + esc(DASH) + '</span></span>'
    const list = sorted.map(e => row(e, 'button', !!(e.address && String(e.address).toLowerCase() === cur))).join('')
    return '<details class="pay-acct" id="' + esc(id) + '"><summary>' + head + '</summary><div class="pay-acct-list">' + list + '</div></details>'
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
      const view = e.failed || e.units == null ? { short: DASH, full: '' } : balanceView(e.units, e.decimals)
      const bal = view.short
      const tip = view.full ? scdoText(view.full) : ''
      const addr = e.address || ''
      return '<div class="addr-line" data-addr="' + esc(addr) + '"><div class="addr-main"><b>' + esc(e.name || DASH) + '</b><span class="mono">' + esc(shortAddr(addr)) + '</span><button type="button" class="link" data-act="copy" data-v="' + esc(addr) + '">' + esc(T('copy')) + '</button></div><div class="addr-bal" title="' + esc(tip) + '">' + esc(scdoText(bal)) + '</div><div class="addr-go"><button type="button" class="link" data-act="recvAddr" data-v="' + esc(addr) + '" data-shard="' + esc(String(sum.n)) + '">' + esc(T('shellRecvShort')) + '</button><button type="button" class="link" data-act="remitAddr" data-v="' + esc(addr) + '" data-shard="' + esc(String(sum.n)) + '">' + esc(T('shellSendShort')) + '</button></div></div>'
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

  function latestTx (chains) {
    let best = null
    for (const chain of chains || []) {
      const rows = txRows(chain)
      if (!rows.length) continue
      const top = rows[0]
      const t = Number(top.t) || 0
      if (!best || t > best.t) best = { n: chain.n, t: t, tx: top }
    }
    return best
  }

  function homeCardsHtml (cards, esc) {
    return (cards || []).map(card => {
      const n = Number(card.n)
      const list = card.addresses || []
      const sel = String(card.selected || '')
      const opts = list.map(a => {
        const on = String(a.address).toLowerCase() === sel.toLowerCase()
        const text = (a.label ? String(a.label) + ' · ' : '') + String(a.address)
        return '<option value="' + esc(a.address) + '"' + (on ? ' selected' : '') + '>' + esc(text) + '</option>'
      }).join('')
      const go = sel
        ? '<div class="home-chain-go"><button type="button" class="link" data-act="recvAddr" data-v="' + esc(sel) + '" data-shard="' + n + '">' + esc(card.recvLabel || '') + '</button><button type="button" class="link" data-act="remitAddr" data-v="' + esc(sel) + '" data-shard="' + n + '">' + esc(card.sendLabel || '') + '</button></div>'
        : ''
      const pick = list.length
        ? '<div class="home-chain-addr"><select class="inp" id="homeAddr-' + n + '" data-shard="' + n + '">' + opts + '</select><button type="button" class="link" data-act="copy" data-v="' + esc(sel) + '">' + esc(card.copyLabel || '') + '</button></div><p class="mono home-chain-full" id="homeAddrShown-' + n + '">' + esc(sel) + '</p>' + go
        : '<p class="home-chain-empty">' + esc(card.empty || '') + '</p>'
      const dash = card.dash ? ' class="dash"' : ''
      const tip = card.balFull ? ' title="' + esc(card.balFull) + '"' : ''
      return '<article class="home-chain" data-shard="' + n + '"><h2>' + esc(card.title || '') + '</h2><p class="home-chain-bal"><b' + dash + tip + '>' + esc(card.bal || '') + '</b></p><div class="lbl">' + esc(card.addrLabel || '') + '</div>' + pick + '</article>'
    }).join('')
  }

  function rowsHtml (chains, T, esc) {
    return (chains || []).map(chain => {
      const sum = summarize(chain)
      const open = !!(chain && chain.open)
      const partial = sum.partial ? '<div class="chain-partial">' + esc(T('shellPartial')) + '</div>' : ''
      const body = open ? (addrBlock(chain, sum, T, esc) + historyHtml(Object.assign({}, chain, { n: sum.n, entries: sum.entries }), T, esc)) : ''
      const tip = sum.full ? scdoText(sum.full) : scdoText(sum.text)
      return '<details class="shell-fold chain-card" data-chain-row="' + sum.n + '"' + (open ? ' open' : '') + '><summary><span class="chain-id"><span class="fold-shut">\u25B8</span><span class="fold-open">\u25BE</span><span class="chain-name">' + esc(sum.title) + '</span></span><b class="chain-bal" title="' + esc(tip) + '">' + esc(scdoText(sum.text)) + '</b></summary>' + partial + body + '</details>'
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
    accountMenuHtml: accountMenuHtml,
    homeCardsHtml: homeCardsHtml,
    rowsHtml: rowsHtml,
    historyHtml: historyHtml,
    txRows: txRows,
    latestTx: latestTx
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (typeof window !== 'undefined') window.SCDOChainHome = Object.freeze(api)
})()
