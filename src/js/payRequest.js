// Shard0 payment request. The link stays on scdo.com.au so the wallet opens it in-app.
// Amounts are public. This module never reads or prints a key, phrase, or password.
'use strict'
;(function () {
  const CHAIN_ID = 5680
  const MEMO_MAX = 100
  const PAGE = 'https://scdo.com.au/wallet/#/pay'

  function amountApi () {
    if (typeof window !== 'undefined' && window.SCDOAmount) return window.SCDOAmount
    try { return require('./amount') } catch (e) { return null }
  }

  function cleanAddr (value) {
    const s = String(value || '').trim()
    return /^0x[0-9a-fA-F]{40}$/.test(s) ? s : ''
  }

  function cleanMemo (value) {
    const s = String(value == null ? '' : value).replace(/[\u0000-\u001f]/g, '').trim()
    if (s.length > MEMO_MAX) return null
    return s
  }

  function build (opts) {
    opts = opts || {}
    const A = amountApi()
    const address = cleanAddr(opts.address)
    if (!address) return { ok: false, code: 'BAD_ADDRESS' }
    const memo = cleanMemo(opts.memo)
    if (memo == null) return { ok: false, code: 'MEMO' }
    if (!A || typeof A.guardAmount !== 'function' || typeof A.toUnits !== 'function') return { ok: false, code: 'BAD_AMOUNT' }
    const g = A.guardAmount(opts.amount, 8)
    if (!g.ok) return { ok: false, code: 'BAD_AMOUNT' }
    const units = A.toUnits(g.value, 18)
    if (units == null || units <= 0n) return { ok: false, code: 'BAD_AMOUNT' }
    const back = A.toUnits(A.plainUnits(units, 18), 18)
    if (back !== units) return { ok: false, code: 'BAD_AMOUNT' }
    const q = new URLSearchParams()
    q.set('to', address)
    q.set('amount', g.value)
    q.set('token', 'SCDO')
    if (memo) q.set('memo', memo)
    return {
      ok: true,
      href: PAGE + '?' + q.toString(),
      eip681: 'ethereum:' + address + '@' + CHAIN_ID + '?value=' + units.toString(),
      chainId: CHAIN_ID
    }
  }

  const api = { CHAIN_ID: CHAIN_ID, MEMO_MAX: MEMO_MAX, build: build }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (typeof window !== 'undefined') window.SCDOPayRequest = api
})()
