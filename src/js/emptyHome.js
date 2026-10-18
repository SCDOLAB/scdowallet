// Home when the keystore has no account, plus a read-only external payout address.
// A missing balance stays a dash. This module never invents 0 SCDO.
'use strict'
;(function () {
  const DASH = '\u2014'
  const ADDR = /^0x[0-9a-fA-F]{40}$/

  function norm (x) { return String(x || '').trim() }

  function externalPayout (input) {
    input = input || {}
    const owned = {}
    for (const a of input.accounts || []) {
      const evm = norm(a && a.evm).toLowerCase()
      if (ADDR.test(evm)) owned[evm] = true
    }
    const keys = ['minerReward', 'minerWallet', 'nodePayout', 'agentPayout']
    for (const k of keys) {
      const addr = norm(input[k])
      if (!ADDR.test(addr)) continue
      if (owned[addr.toLowerCase()]) continue
      return { address: addr }
    }
    return null
  }

  function balanceText (units, fmt) {
    if (units == null || units === '') return DASH
    try {
      const t = fmt ? fmt(units) : String(units)
      if (t == null || t === '' || t === DASH) return DASH
      return String(t) + ' SCDO'
    } catch (e) { return DASH }
  }

  function payoutHtml (t, esc, payout, fmt) {
    if (!payout || !payout.address) return ''
    const bal = balanceText(payout.units, fmt)
    const dash = bal === DASH ? ' dash' : ''
    return '<section class="ext-payout" id="extPayout" data-readonly="1">' +
      '<div class="lbl">' + esc(t('payoutExternal')) + '</div>' +
      '<div class="mono" id="extPayoutAddr">' + esc(payout.address) + '</div>' +
      '<div class="ext-bal' + dash + '" id="extPayoutBal">' + esc(bal) + '</div>' +
      '<p class="ext-note" id="extPayoutNote">' + esc(t('payoutNoKey')) + '</p></section>'
  }

  function html (t, esc, model) {
    t = t || function (k) { return k }
    esc = esc || function (s) { return String(s == null ? '' : s) }
    model = model || {}
    const actions = '<div class="shell-actions empty-actions">' +
      '<button type="button" class="shell-act" id="emptyCreate" data-act="create">' + esc(t('emptyCreate')) + '</button>' +
      '<button type="button" class="shell-act" id="emptyImport" data-act="import">' + esc(t('emptyImport')) + '</button></div>'
    return '<section class="empty-wallet" id="emptyWallet">' +
      '<h1 class="shell-h" id="emptyWalletTitle">' + esc(t('emptyWallet')) + '</h1>' +
      actions +
      payoutHtml(t, esc, model.payout, model.fmt) +
      '</section>'
  }

  const api = { DASH: DASH, externalPayout: externalPayout, balanceText: balanceText, payoutHtml: payoutHtml, html: html }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (typeof window !== 'undefined') window.SCDOEmptyHome = api
})()
