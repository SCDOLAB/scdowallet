// 3.0.4: one number format for every SCDO amount on screen (Home cards, Accounts page, footer, confirm window,
// history, AI小貓). Up to 8 decimals, cut (never rounded up), trailing zeros dropped, a comma every three digits,
// followed by "SCDO" where the caller adds it. All maths is on integer units (BigInt) or decimal strings; no floats.
'use strict'
;(function () {
  const MAX_DP = 8
  // integer units (BigInt | string | safe integer) + decimals -> "1,234.5678" (cut to maxDp)
  function fmtUnits (raw, decimals, maxDp) {
    let v
    try { v = typeof raw === 'bigint' ? raw : BigInt(String(raw).trim()) } catch (e) { return String(raw) }
    const dec = Math.max(0, Number(decimals) || 0)
    const dp = Math.max(0, Math.min(dec, maxDp == null ? MAX_DP : Number(maxDp)))
    const neg = v < 0n; if (neg) v = -v
    const base = 10n ** BigInt(dec)
    const whole = v / base
    let frac = dec ? (v % base).toString().padStart(dec, '0').slice(0, dp) : ''
    frac = frac.replace(/0+$/, '')
    const w = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    const s = w + (frac ? '.' + frac : '')
    return (neg && s !== '0' ? '-' : '') + s
  }
  // decimal text ("1234.567890123", "-0.5", "1e-7", 12.5) -> integer units at `decimals`, cut; null if not a number
  function toUnits (x, decimals) {
    const dec = Math.max(0, Number(decimals) || 0)
    let s
    if (typeof x === 'bigint') return x * 10n ** BigInt(dec)
    if (typeof x === 'number') { if (!isFinite(x)) return null; s = String(x) } else s = String(x == null ? '' : x).trim().replace(/,/g, '')
    let m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(s)
    if (!m || (m[2] === '' && (m[3] == null || m[3] === ''))) return null
    let int = m[2] || '0'; let frac = m[3] || ''; const e = m[4] ? parseInt(m[4], 10) : 0
    if (e > 0) { frac = frac.padEnd(e, '0'); int += frac.slice(0, e); frac = frac.slice(e) } else if (e < 0) { int = int.padStart(-e + 1, '0'); frac = int.slice(int.length + e) + frac; int = int.slice(0, int.length + e) }
    const units = BigInt(int + frac.padEnd(dec, '0').slice(0, dec))
    return m[1] === '-' ? -units : units
  }
  // decimal text or number -> display text (up to 8 decimals, cut, separators)
  function fmtDec (x, maxDp) {
    const u = toUnits(x, 18)
    if (u == null) return String(x)
    return fmtUnits(u, 18, maxDp == null ? MAX_DP : maxDp)
  }
  // plain decimal string without separators, for inputs and comparisons ("1234.5")
  function plainUnits (raw, decimals) { return fmtUnits(raw, decimals, decimals).replace(/,/g, '') }
  // Send amounts stop at 8 decimal places before any parseUnits / fromString call.
  function guardAmount (text, maxDp) {
    const dp = maxDp == null ? MAX_DP : Math.max(0, Number(maxDp) || 0)
    let s = String(text == null ? '' : text).trim().replace(/,/g, '').replace(/\u2212/g, '-')
    if (s[0] === '+') s = s.slice(1)
    if (!/^\d+(\.\d+)?$/.test(s)) return { ok: false, code: 'BAD_AMOUNT', value: s }
    const frac = s.split('.')[1] || ''
    if (frac.length > dp) return { ok: false, code: 'TOO_MANY_DECIMALS', value: s }
    return { ok: true, code: '', value: s }
  }
  // Typing: drop a 9th decimal instead of letting it reach the signer.
  function clipDecimals (text, maxDp) {
    const dp = maxDp == null ? MAX_DP : Math.max(0, Number(maxDp) || 0)
    const raw = String(text == null ? '' : text).replace(/,/g, '')
    const m = /^(\d*)(\.?)(\d*)(.*)$/.exec(raw)
    if (!m) return { value: '', blocked: false }
    const frac = m[3] || ''
    const blocked = frac.length > dp || (m[4] && /\d/.test(m[4]))
    const cut = frac.slice(0, dp)
    return { value: m[1] + (m[2] || cut ? '.' + cut : ''), blocked: blocked }
  }
  // Shard1–Shard4 Classic fee is gas × 1 unit. 21000 units is 0.00021 SCDO.
  // A missing or zero estimate uses that known fee so Max never returns the full balance.
  function classicFeeUnits (gas) {
    const n = Number(gas)
    if (Number.isFinite(n) && n > 0) return BigInt(Math.floor(n))
    return 21000n
  }
  // balance − fee, cut toward zero at 8 decimal places. Null when the balance is unknown.
  function maxAmount (balUnits, feeUnits, decimals) {
    if (balUnits == null) return null
    let bal
    let fee
    try { bal = BigInt(balUnits); fee = BigInt(feeUnits || 0) } catch (e) { return null }
    if (bal <= fee) return '0'
    const dec = Math.max(0, Number(decimals) || 0)
    const dp = Math.min(dec, MAX_DP)
    const factor = dec > dp ? 10n ** BigInt(dec - dp) : 1n
    const cut = (bal - fee) / factor * factor
    return fmtUnits(cut, dec, dp).replace(/,/g, '')
  }
  const api = { MAX_DP, fmtUnits, toUnits, fmtDec, plainUnits, guardAmount, clipDecimals, classicFeeUnits, maxAmount }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (typeof window !== 'undefined') window.SCDOAmount = Object.freeze(api)
})()
