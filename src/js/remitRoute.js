// One 匯款 route. A 0x or Classic address is an on-chain transfer on that shard.
// A saved remit payee, any other name, or a fiat amount is the remit gateway.
// This file never sends, signs, or logs in.
'use strict'
;(function () {
function norm (s) {
  return String(s == null ? '' : s).normalize('NFKC').replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '').trim()
}

function isFiatAmount (s) {
  const t = norm(s)
  if (!t) return false
  if (/USDT|USD|TWD|HKD|CNY|NTD|AUD/i.test(t)) return true
  if (/NT\$|HK\$|US\$|\$/.test(t)) return true
  if (/美金|美元|台幣|臺幣|港幣|人民幣|元/.test(t)) return true
  return false
}

function amountNumber (s) {
  const t = norm(s).replace(/,/g, '')
  const m = t.match(/[0-9]+(?:\.[0-9]+)?/)
  return m ? m[0] : ''
}

function useEnglish () {
  return typeof window !== 'undefined' && window.SCDOMining && window.SCDOMining.lang === 'EN'
}
function chainWord (shard) {
  const n = Number(shard)
  if (n === 0) return useEnglish() ? 'Main chain' : '主鏈'
  return 'Shard' + n
}
function chainLine (shard, fee) {
  const name = chainWord(shard)
  const cost = fee || '…'
  if (useEnglish()) return 'On-chain transfer · ' + name + ' · fee about ' + cost
  return '鏈上轉帳 · ' + name + ' · 手續費約 ' + cost
}

function gateLine (eta) {
  return '匯款 · 到帳約 ' + (eta || '…')
}

function labelOf (a) {
  return norm(a && (a.label || a.name || ''))
}

function routePay (opt) {
  opt = opt || {}
  const dest = norm(opt.to)
  const rawAmount = norm(opt.amount)
  const num = amountNumber(rawAmount)
  const fee = norm(opt.feeText)
  const eta = norm(opt.etaText)
  if (!dest || !num || !(Number(num) > 0)) return { kind: 'incomplete', line: '', to: dest, amount: rawAmount }
  if (isFiatAmount(rawAmount)) return { kind: 'gateway', line: gateLine(eta), to: dest, amount: rawAmount }
  if (/^0x[0-9a-fA-F]{40}$/.test(dest)) return { kind: 'chain', shard: 0, line: chainLine(0, fee), to: dest, amount: num }
  const classic = /^([1-4])S[0-9a-fA-F]{40}$/.exec(dest)
  if (classic) return { kind: 'chain', shard: Number(classic[1]), line: chainLine(classic[1], fee), to: dest, amount: num }
  const accounts = Array.isArray(opt.accounts) ? opt.accounts : []
  const exact = accounts.filter(a => labelOf(a) && labelOf(a) === dest)
  const hits = exact.length ? exact : accounts.filter(a => labelOf(a) && dest && labelOf(a).indexOf(dest) >= 0)
  if (hits.length > 1) return { kind: 'incomplete', line: '', many: hits.map(labelOf), to: dest, amount: num }
  if (hits.length === 1) {
    const a = hits[0]
    const classicAddr = norm(a.address || a.pubkey || '')
    const evm = norm(a.evm || '')
    const file = a.filename || a.file || ''
    if (/^[1-4]S[0-9a-fA-F]{40}$/.test(classicAddr)) {
      return { kind: 'chain', shard: Number(classicAddr[0]), line: chainLine(classicAddr[0], fee), to: classicAddr, amount: num, file: file }
    }
    if (/^0x[0-9a-fA-F]{40}$/.test(evm)) {
      return { kind: 'chain', shard: 0, line: chainLine(0, fee), to: evm, amount: num, file: file }
    }
    return { kind: 'incomplete', line: '', to: dest, amount: num }
  }
  return { kind: 'gateway', line: gateLine(eta), to: dest, amount: rawAmount }
}

const api = { routePay: routePay, isFiatAmount: isFiatAmount }
if (typeof module !== 'undefined' && module.exports) module.exports = api
if (typeof window !== 'undefined') window.SCDORemitRoute = Object.freeze(api)
})()
