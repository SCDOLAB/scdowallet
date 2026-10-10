// Plain-language send errors. The raw ethers / RPC text stays behind a collapsed disclosure.
'use strict'
;(function () {
  const CN = {
    TOO_MANY_DECIMALS: '最多小數點後 8 位。',
    NUMERIC_FAULT: '這個金額的小數位數太多。最多小數點後 8 位。',
    INSUFFICIENT_FUNDS: '餘額不夠付這筆金額和手續費。',
    NONCE_EXPIRED: '這筆交易的序號已經過期，請再試一次。',
    NETWORK: '網路暫時連不上，請稍後再試。',
    BAD_ADDRESS: '這個地址格式不對。',
    BAD_AMOUNT: '請輸入大於 0 的金額。',
    UNKNOWN: '這一步沒有完成，請再試一次。'
  }
  const EN = {
    TOO_MANY_DECIMALS: 'At most 8 digits after the decimal point.',
    NUMERIC_FAULT: 'This amount has too many decimal places. Use at most 8.',
    INSUFFICIENT_FUNDS: 'The balance does not cover this amount and the fee.',
    NONCE_EXPIRED: 'This transaction number has expired. Please try again.',
    NETWORK: 'The network cannot be reached right now. Please try again later.',
    BAD_ADDRESS: 'This address is not in the right form.',
    BAD_AMOUNT: 'Enter an amount greater than 0.',
    UNKNOWN: 'This step did not finish. Please try again.'
  }

  function rawOf (err) {
    if (err == null) return ''
    if (typeof err === 'string') return err
    return String(err.message || err.reason || err.code || err)
  }

  function classify (err) {
    const code = err && err.code ? String(err.code) : ''
    const msg = rawOf(err)
    const blob = (code + ' ' + msg).toLowerCase()
    if (code === 'TOO_MANY_DECIMALS' || /too many decimals|too_many_decimals/.test(blob)) return 'TOO_MANY_DECIMALS'
    if (code === 'NUMERIC_FAULT' || /numeric_fault|fault=.?underflow|too many decimals for format/.test(blob)) return 'NUMERIC_FAULT'
    if (code === 'INSUFFICIENT_FUNDS' || /insufficient funds|insufficient_funds/.test(blob)) return 'INSUFFICIENT_FUNDS'
    if (code === 'NONCE_EXPIRED' || /nonce_expired|nonce too low|nonce has already been used/.test(blob)) return 'NONCE_EXPIRED'
    if (/timeout|etimedout|enotfound|econnrefused|network|fetch failed|failed to fetch/.test(blob)) return 'NETWORK'
    if (code === 'BAD_ADDRESS' || /invalid address|invalid shard0 address|bad_address/.test(blob)) return 'BAD_ADDRESS'
    if (code === 'BAD_AMOUNT' || /bad_amount/.test(blob)) return 'BAD_AMOUNT'
    return 'UNKNOWN'
  }

  function present (err, lang) {
    const kind = classify(err)
    const table = lang === 'EN' ? EN : CN
    return { kind: kind, message: table[kind] || table.UNKNOWN, detail: rawOf(err) }
  }

  function html (err, lang, esc) {
    const p = present(err, lang)
    const safe = esc || function (s) { return String(s == null ? '' : s) }
    const label = lang === 'EN' ? 'Technical details' : '技術細節'
    return safe(p.message) + '<details class="shell-fold"><summary><span class="fold-shut">\u25B8</span><span class="fold-open">\u25BE</span> ' + safe(label) + '</summary><div class="mono">' + safe(p.detail) + '</div></details>'
  }

  const api = { classify: classify, present: present, html: html, CN: CN, EN: EN }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (typeof window !== 'undefined') window.SCDOSendError = Object.freeze(api)
})()
