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
  const api = { MAX_DP, fmtUnits, toUnits, fmtDec, plainUnits }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (typeof window !== 'undefined') window.SCDOAmount = Object.freeze(api)
})()
