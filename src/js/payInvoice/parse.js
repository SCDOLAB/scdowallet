// Pay invoice parsers. Amounts are BigInt only. Extra decimals are reported, never cut.
// Phase 1 capability: this wallet has no Base key and no TON key. The secp256k1
// account key signs SCDO Classic (shards 1-4) and Shard0 chain id 5680 only.
'use strict'
;(function () {
  const UINT256_MAX = (1n << 256n) - 1n
  const USDT_MASTER = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs'
  const TON_DECIMALS = 9
  const USDT_DECIMALS = 6
  const USDC_DECIMALS = 6

  function evmApi () {
    if (typeof window !== 'undefined' && window.SCDOPayEvm) return window.SCDOPayEvm
    return require('./evm681.js')
  }

  function fail (code, extra) {
    const out = { ok: false, code: code }
    if (extra) {
      for (const k of Object.keys(extra)) out[k] = extra[k]
    }
    return out
  }

  function formatExact (atomic, decimals) {
    if (atomic < 0n) return '-' + formatExact(-atomic, decimals)
    if (decimals == null) return atomic.toString()
    const d = decimals
    const raw = atomic.toString()
    const s = raw.length > d ? raw : raw.padStart(d + 1, '0')
    const cut = s.length - d
    const whole = s.slice(0, cut) || '0'
    let frac = d ? s.slice(cut) : ''
    frac = frac.replace(/0+$/, '')
    return whole + (frac ? '.' + frac : '')
  }

  function amountText (atomic, decimals, symbol) {
    const n = formatExact(atomic, decimals)
    return symbol ? n + ' ' + symbol : n
  }

  // Decimal or scientific text that is exactly an integer. No floats.
  function parseIntegral (raw) {
    const s = String(raw == null ? '' : raw).trim()
    if (!s) return fail('NOT_INTEGER')
    if (s[0] === '-') return fail('NEGATIVE')
    if (/[xX]/.test(s)) return fail('NOT_INTEGER')
    const m = /^(\+?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(s)
    if (!m) return fail('NOT_INTEGER')
    const intDigits = m[2] || '0'
    const fracDigits = m[3] != null ? m[3] : (m[4] || '')
    let exp = 0n
    if (m[5] != null && m[5] !== '' && m[5] !== '+') {
      try { exp = BigInt(m[5]) } catch (e) { return fail('NOT_INTEGER') }
    }
    if (exp > 200n || exp < -200n) return fail('OVERFLOW')
    let target = intDigits.length
    if (exp >= 0n) {
      for (let i = 0n; i < exp; i++) target++
    } else {
      for (let i = 0n; i < -exp; i++) target--
    }
    const all = intDigits + fracDigits
    if (target < 0) {
      if (/[1-9]/.test(all)) return fail('NOT_INTEGER')
      return { ok: true, atomic: 0n }
    }
    let body = all
    while (body.length < target) body += '0'
    if (/[1-9]/.test(body.slice(target))) return fail('NOT_INTEGER')
    const whole = body.slice(0, target).replace(/^0+/, '') || '0'
    let atomic
    try { atomic = BigInt(whole) } catch (e) { return fail('NOT_INTEGER') }
    if (atomic > UINT256_MAX) return fail('OVERFLOW')
    return { ok: true, atomic: atomic }
  }

  // Exact decimal -> atomic. More fractional digits than `decimals` is an error.
  // wouldCutAtomic is what a silent cut would have sent.
  function decimalToAtomic (text, decimals) {
    const s = String(text == null ? '' : text).trim().replace(/,/g, '').replace(/\u2212/g, '-')
    if (!s) return fail('BAD_AMOUNT')
    if (s[0] === '-') return fail('NEGATIVE')
    const body = s[0] === '+' ? s.slice(1) : s
    if (decimals == null) {
      if (!/^\d+$/.test(body)) return fail('BAD_AMOUNT')
      let atomic
      try { atomic = BigInt(body) } catch (e) { return fail('BAD_AMOUNT') }
      if (atomic > UINT256_MAX) return fail('OVERFLOW')
      return { ok: true, atomic: atomic }
    }
    if (!/^\d+(\.\d+)?$/.test(body)) return fail('BAD_AMOUNT')
    const parts = body.split('.')
    const whole = parts[0] || '0'
    const frac = parts[1] || ''
    if (frac.length > decimals) {
      const kept = frac.slice(0, decimals)
      const extra = frac.slice(decimals)
      const cutDigits = (whole + kept.padEnd(decimals, '0')).replace(/^0+/, '') || '0'
      let would = 0n
      try { would = BigInt(cutDigits) } catch (e) { return fail('BAD_AMOUNT') }
      return fail('TOO_MANY_DECIMALS', { wouldCutAtomic: would, dropsValue: /[1-9]/.test(extra) })
    }
    const digits = (whole + frac.padEnd(decimals, '0')).replace(/^0+/, '') || '0'
    let atomic
    try { atomic = BigInt(digits) } catch (e) { return fail('BAD_AMOUNT') }
    if (atomic > UINT256_MAX) return fail('OVERFLOW')
    return { ok: true, atomic: atomic }
  }

  function tonAddress (addr) {
    let s
    try { s = decodeURIComponent(String(addr == null ? '' : addr).trim()) } catch (e) { return null }
    if (/^0:[0-9a-fA-F]{64}$/.test(s)) return '0:' + s.slice(2).toLowerCase()
    if (/^[A-Za-z0-9_-]{48}$/.test(s)) return s
    return null
  }

  function single (params, key) {
    const all = params.getAll(key)
    if (all.length > 1) return { dup: true, value: null }
    return { dup: false, value: all.length ? all[0] : null }
  }

  function knownKeys (params, allow) {
    for (const key of params.keys()) {
      if (allow.indexOf(key) < 0) return false
    }
    return true
  }

  function finish (inv) {
    inv.display = formatExact(inv.atomic, inv.decimals)
    inv.amountText = amountText(inv.atomic, inv.decimals, inv.token)
    inv.memoText = inv.memo ? inv.memo : 'No memo'
    inv.expired = function (now) {
      if (inv.exp == null) return false
      return BigInt(now) >= inv.exp
    }
    return { ok: true, invoice: inv }
  }

  function buildTon (parts) {
    const addr = tonAddress(parts.address)
    if (!addr) throw new Error('bad address')
    let amt
    try { amt = BigInt(parts.amount) } catch (e) { throw new Error('bad amount') }
    if (amt < 0n) throw new Error('negative')
    if (amt > UINT256_MAX) throw new Error('overflow')
    let uri = 'ton://transfer/' + addr + '?amount=' + amt.toString()
    if (parts.jetton) {
      const jetton = tonAddress(parts.jetton)
      if (!jetton) throw new Error('bad address')
      uri += '&jetton=' + jetton
    }
    if (parts.memo) uri += '&text=' + encodeURIComponent(String(parts.memo))
    if (parts.exp != null && parts.exp !== '') uri += '&exp=' + BigInt(parts.exp).toString()
    return uri
  }

  function parseTon (raw) {
    let u
    try { u = new URL(raw) } catch (e) { return fail('BAD_URI') }
    if (u.protocol !== 'ton:' || u.hostname !== 'transfer') return fail('BAD_URI')
    const addr = tonAddress(u.pathname.replace(/^\//, ''))
    if (!addr) return fail('BAD_ADDRESS')
    const params = u.searchParams
    if (!knownKeys(params, ['amount', 'jetton', 'text', 'exp'])) return fail('BAD_URI')
    const amount = single(params, 'amount')
    const jetton = single(params, 'jetton')
    const text = single(params, 'text')
    const exp = single(params, 'exp')
    if (amount.dup || jetton.dup || text.dup || exp.dup) return fail('BAD_URI')
    if (amount.value == null || amount.value === '') return fail('MISSING')
    if (!/^\d+$/.test(amount.value)) {
      if (amount.value[0] === '-') return fail('NEGATIVE')
      return fail('NOT_INTEGER')
    }
    let atomic
    try { atomic = BigInt(amount.value) } catch (e) { return fail('NOT_INTEGER') }
    if (atomic > UINT256_MAX) return fail('OVERFLOW')
    let jettonAddr = null
    if (jetton.value != null && jetton.value !== '') {
      jettonAddr = tonAddress(jetton.value)
      if (!jettonAddr) return fail('BAD_ADDRESS')
    }
    let expAt = null
    if (exp.value != null && exp.value !== '') {
      if (exp.value[0] === '-') return fail('NEGATIVE')
      if (!/^\d+$/.test(exp.value)) return fail('NOT_INTEGER')
      try { expAt = BigInt(exp.value) } catch (e) { return fail('NOT_INTEGER') }
    }
    const memo = text.value == null || text.value === '' ? null : text.value
    const knownUsdt = jettonAddr === USDT_MASTER
    const inv = {
      scheme: 'ton',
      network: 'TON',
      chainId: null,
      token: jettonAddr ? (knownUsdt ? 'USDT' : 'Unknown token') : 'TON',
      tokenAddress: jettonAddr || '',
      known: !jettonAddr || knownUsdt,
      decimals: jettonAddr ? (knownUsdt ? USDT_DECIMALS : null) : TON_DECIMALS,
      atomic: atomic,
      to: addr,
      memo: memo,
      exp: expAt,
      data: null
    }
    inv.uri = buildTon({ address: addr, amount: atomic, jetton: jettonAddr, memo: memo, exp: expAt })
    if (inv.token === 'TON') inv.note = 'Send TON on TON only, exact amount. Native TON sending is phase 2.'
    else if (knownUsdt) inv.note = 'Send USDT on TON only, exact amount. Paying from this wallet needs a TON key (phase 2).'
    else inv.note = 'Send this jetton on TON only, exact amount. Paying from this wallet needs a TON key (phase 2).'
    return finish(inv)
  }

  function parseEip681 (raw) {
    let u
    try { u = new URL(raw) } catch (e) { return fail('BAD_URI') }
    if (u.protocol !== 'ethereum:') return fail('BAD_URI')
    const path = u.pathname
    const shape = /^(0x[0-9a-fA-F]{40})@(\d+)\/([^/?#]+)$/.exec(path)
    if (!shape) return fail('BAD_URI')
    if (shape[3] !== 'transfer') return fail('WRONG_FUNCTION')
    const E = evmApi()
    const token = E.hexAddress(shape[1])
    if (!token) return fail('BAD_CHECKSUM')
    const params = u.searchParams
    if (params.has('value')) return fail('VALUE_NOT_ALLOWED')
    if (!knownKeys(params, ['address', 'uint256'])) return fail('BAD_URI')
    const toQ = single(params, 'address')
    const uintQ = single(params, 'uint256')
    if (toQ.dup || uintQ.dup) return fail('BAD_URI')
    if (toQ.value == null || toQ.value === '' || uintQ.value == null || uintQ.value === '') return fail('MISSING')
    const to = E.hexAddress(toQ.value)
    if (!to) return /^0x[0-9a-fA-F]{40}$/.test(toQ.value) ? fail('BAD_CHECKSUM') : fail('BAD_ADDRESS')
    const amt = parseIntegral(uintQ.value)
    if (!amt.ok) return amt
    let chain
    try { chain = BigInt(shape[2]) } catch (e) { return fail('BAD_URI') }
    const usdc = token === E.USDC_BASE && chain === E.BASE_CHAIN_ID
    const inv = {
      scheme: 'ethereum',
      network: chain === E.BASE_CHAIN_ID ? 'Base' : ('Chain ' + chain.toString()),
      chainId: chain.toString(),
      token: usdc ? 'USDC' : 'Unknown token',
      tokenAddress: token,
      known: usdc,
      decimals: usdc ? USDC_DECIMALS : null,
      atomic: amt.atomic,
      to: to,
      memo: null,
      exp: null,
      data: E.erc20TransferData(to, amt.atomic)
    }
    inv.uri = E.buildEip681(token, chain, to, amt.atomic)
    inv.note = usdc
      ? 'Send USDC on Base only, exact amount.'
      : 'Send the exact amount on this network. This wallet has no key for that network.'
    return finish(inv)
  }

  function parseInvoice (text) {
    const raw = String(text == null ? '' : text).trim()
    if (!raw) return fail('BAD_URI')
    if (/^ton:/i.test(raw)) return parseTon(raw)
    if (/^ethereum:/i.test(raw)) return parseEip681(raw)
    return fail('BAD_URI')
  }

  function isHandoffUri (text) {
    const r = parseInvoice(text)
    return !!(r.ok && r.invoice && (r.invoice.scheme === 'ton' || r.invoice.scheme === 'ethereum') && r.invoice.uri === String(text).trim())
  }

  // MetaMask and Coinbase dapp links only. Other paths on those hosts are refused.
  function isWalletDeepLink (url) {
    let u
    try { u = new URL(String(url)) } catch (e) { return false }
    if (u.protocol !== 'https:' || u.username || u.password) return false
    if (u.hostname === 'metamask.app.link') return /^\/dapp\/.+/i.test(u.pathname)
    if (u.hostname === 'go.cb-w.com' && u.pathname === '/dapp') {
      const inner = u.searchParams.get('cb_url')
      if (!inner) return false
      let page
      try { page = new URL(inner) } catch (e) { return false }
      return page.protocol === 'https:' && !page.username && !page.password
    }
    return false
  }

  function tokenMeta (network, token, jetton) {
    if (network === 'base') {
      if (token !== 'USDC') return null
      return { decimals: USDC_DECIMALS, symbol: 'USDC', jetton: null }
    }
    if (network !== 'ton') return null
    if (token === 'TON') return { decimals: TON_DECIMALS, symbol: 'TON', jetton: null }
    if (token === 'USDT') return { decimals: USDT_DECIMALS, symbol: 'USDT', jetton: USDT_MASTER }
    if (token === 'other') {
      const addr = tonAddress(jetton)
      if (!addr) return null
      return { decimals: null, symbol: 'Unknown token', jetton: addr }
    }
    return null
  }

  function invoiceFromManual (fields) {
    const f = fields || {}
    const meta = tokenMeta(f.network, f.token, f.jetton)
    if (!meta) return fail('BAD_TOKEN')
    const dec = decimalToAtomic(f.amount, meta.decimals)
    if (!dec.ok) return dec
    const memo = f.memo == null ? '' : String(f.memo)
    try {
      if (f.network === 'base') {
        const E = evmApi()
        const uri = E.buildEip681(E.USDC_BASE, E.BASE_CHAIN_ID, f.to, dec.atomic)
        const parsed = parseInvoice(uri)
        if (!parsed.ok) return parsed
        if (memo) {
          parsed.invoice.memo = memo
          parsed.invoice.memoText = memo
          parsed.invoice.memoLocalOnly = true
        }
        return parsed
      }
      const uri = buildTon({
        address: f.to,
        amount: dec.atomic,
        jetton: meta.jetton,
        memo: memo,
        exp: null
      })
      return parseInvoice(uri)
    } catch (e) {
      return fail('BAD_ADDRESS')
    }
  }

  // What a local send would actually move, versus the invoice atomic amount.
  // Order: decimal cut, then raise to the payer minimum, then subtract a fee
  // taken from the amount. A smaller result is never a silent payment.
  function compareSend (opts) {
    const o = opts || {}
    const symbol = o.symbol || ''
    const decimals = o.decimals == null ? null : o.decimals
    let invoiceAtomic
    try { invoiceAtomic = BigInt(o.invoiceAtomic) } catch (e) { invoiceAtomic = 0n }
    let would = invoiceAtomic
    let cut = false
    let cutDrops = false
    let askText = amountText(invoiceAtomic, decimals, symbol)
    if (o.typedText != null && String(o.typedText).trim() !== '') {
      const d = decimalToAtomic(o.typedText, decimals)
      if (!d.ok && d.code === 'TOO_MANY_DECIMALS') {
        would = d.wouldCutAtomic
        cut = true
        cutDrops = !!d.dropsValue
        askText = String(o.typedText).trim() + (symbol ? ' ' + symbol : '')
      } else if (d.ok) would = d.atomic
    }
    let minimum = null
    if (o.payerMinimumAtomic != null && o.payerMinimumAtomic !== '') {
      try { minimum = BigInt(o.payerMinimumAtomic) } catch (e) { minimum = null }
    } else if (o.payerMinimum != null && String(o.payerMinimum).trim() !== '') {
      const m = decimalToAtomic(o.payerMinimum, decimals)
      if (m.ok) minimum = m.atomic
    }
    if (minimum != null && would < minimum) would = minimum
    let fee = 0n
    if (o.feeFromAmountAtomic != null && o.feeFromAmountAtomic !== '') {
      try { fee = BigInt(o.feeFromAmountAtomic) } catch (e) { fee = 0n }
    } else if (o.feeFromAmount != null && String(o.feeFromAmount).trim() !== '') {
      const f = decimalToAtomic(o.feeFromAmount, decimals)
      if (f.ok) fee = f.atomic
    }
    if (fee < 0n) fee = 0n
    if (fee > 0n) would = would > fee ? would - fee : 0n
    const wouldText = amountText(would, decimals, symbol)
    const differs = would !== invoiceAtomic || (cutDrops && askText !== wouldText)
    return {
      differs: differs,
      cut: cut,
      cutDrops: cutDrops,
      less: would < invoiceAtomic || cutDrops,
      matchesInvoice: would === invoiceAtomic && !cutDrops,
      allowSilentLess: false,
      invoiceAtomic: invoiceAtomic,
      wouldSendAtomic: would,
      invoiceText: askText,
      wouldSendText: wouldText,
      text: differs ? ('Amount differs: invoice asks ' + askText + ', this would send ' + wouldText) : ''
    }
  }

  // Phase 1 flags. Do not add a Base sender or a TON key type here.
  function capabilities () {
    return { baseKey: false, tonKey: false }
  }
  function hasBaseKey () { return false }
  function hasTonKey () { return false }

  function nowSec () {
    return BigInt(Date.now()) / 1000n
  }

  const api = {
    UINT256_MAX: UINT256_MAX,
    USDT_MASTER: USDT_MASTER,
    TON_DECIMALS: TON_DECIMALS,
    USDT_DECIMALS: USDT_DECIMALS,
    USDC_DECIMALS: USDC_DECIMALS,
    formatExact: formatExact,
    amountText: amountText,
    parseIntegral: parseIntegral,
    decimalToAtomic: decimalToAtomic,
    tonAddress: tonAddress,
    buildTon: buildTon,
    parseInvoice: parseInvoice,
    invoiceFromManual: invoiceFromManual,
    compareSend: compareSend,
    isHandoffUri: isHandoffUri,
    isWalletDeepLink: isWalletDeepLink,
    capabilities: capabilities,
    hasBaseKey: hasBaseKey,
    hasTonKey: hasTonKey,
    nowSec: nowSec
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (typeof window !== 'undefined') window.SCDOPayInvoice = api
})()
