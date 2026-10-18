// Shared Base USDC request builder.
// The stake-wheel repo branch feature/wheel-tip-fix-20261017 @ 8b81167 was not
// available (no public repo). This matches the live builder in
// https://wheel.apeccapital.org/games/stakewheel/cat-tip.js?v=2 (2026-10-17):
// plain ERC-20 transfer, selector 0xa9059cbb, lowercase 32-byte pads, value 0.
// No approval and no typed data.
'use strict'
;(function () {
  const MASK = (1n << 64n) - 1n
  const ROTC = [1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 2, 14, 27, 41, 56, 8, 25, 43, 62, 18, 39, 61, 20, 44]
  const PILN = [10, 7, 11, 17, 18, 3, 5, 16, 8, 21, 24, 4, 15, 23, 19, 13, 12, 2, 20, 14, 22, 9, 6, 1]
  const RC = [
    0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
    0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
    0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
    0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
    0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
    0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n
  ]

  function rotl (x, n) {
    const s = BigInt(n) & 63n
    x &= MASK
    if (s === 0n) return x
    return ((x << s) | (x >> (64n - s))) & MASK
  }

  function keccakF (a) {
    for (let round = 0; round < 24; round++) {
      const c = [0n, 0n, 0n, 0n, 0n]
      for (let x = 0; x < 5; x++) c[x] = a[x] ^ a[x + 5] ^ a[x + 10] ^ a[x + 15] ^ a[x + 20]
      for (let x = 0; x < 5; x++) {
        const d = c[(x + 4) % 5] ^ rotl(c[(x + 1) % 5], 1)
        for (let y = 0; y < 25; y += 5) a[x + y] = (a[x + y] ^ d) & MASK
      }
      let t = a[1]
      for (let i = 0; i < 24; i++) {
        const j = PILN[i]
        const tmp = a[j]
        a[j] = rotl(t, ROTC[i])
        t = tmp
      }
      for (let y = 0; y < 25; y += 5) {
        const row = [a[y], a[y + 1], a[y + 2], a[y + 3], a[y + 4]]
        for (let x = 0; x < 5; x++) a[y + x] = (row[x] ^ ((~row[(x + 1) % 5]) & row[(x + 2) % 5])) & MASK
      }
      a[0] = (a[0] ^ RC[round]) & MASK
    }
  }

  function u8 (v) {
    let n = 0
    let bit = 1
    let x = v
    for (let i = 0; i < 8; i++) {
      if ((x & 1n) === 1n) n += bit
      x >>= 1n
      bit += bit
    }
    return n
  }

  function keccak256 (bytes) {
    const rate = 136
    const a = []
    for (let i = 0; i < 25; i++) a.push(0n)
    const msg = bytes.slice()
    const n = rate - (msg.length % rate)
    if (n === 1) msg.push(0x81)
    else {
      msg.push(0x01)
      for (let i = 0; i < n - 2; i++) msg.push(0)
      msg.push(0x80)
    }
    for (let off = 0; off < msg.length; off += rate) {
      for (let i = 0; i < rate; i += 8) {
        let lane = 0n
        for (let b = 0; b < 8; b++) lane |= BigInt(msg[off + i + b]) << BigInt(8 * b)
        const laneIndex = i >> 3
        a[laneIndex] = (a[laneIndex] ^ lane) & MASK
      }
      keccakF(a)
    }
    const out = []
    for (let i = 0; i < 4; i++) {
      let lane = a[i]
      for (let b = 0; b < 8; b++) {
        out.push(u8(lane & 255n))
        lane >>= 8n
      }
    }
    return out
  }

  function keccak256Text (str) {
    const bytes = []
    const s = String(str)
    for (let i = 0; i < s.length; i++) bytes.push(s.charCodeAt(i) & 255)
    return keccak256(bytes)
  }

  function hexOf (bytes) {
    const h = '0123456789abcdef'
    let s = ''
    for (let i = 0; i < bytes.length; i++) s += h[(bytes[i] >> 4) & 15] + h[bytes[i] & 15]
    return s
  }

  function nibble (ch) {
    const i = '0123456789abcdef'.indexOf(ch)
    return i
  }

  // EIP-55. Mixed-case input must match; all-lower and all-upper are accepted by the parser.
  function checksumAddress (hexBody) {
    const h = String(hexBody).toLowerCase()
    const hash = hexOf(keccak256Text(h))
    let out = '0x'
    for (let i = 0; i < 40; i++) out += nibble(hash[i]) >= 8 ? h[i].toUpperCase() : h[i]
    return out
  }

  function hexAddress (addr) {
    const s = String(addr == null ? '' : addr).trim()
    const m = /^0x([0-9a-fA-F]{40})$/.exec(s)
    if (!m) return null
    const body = m[1]
    if (body !== body.toLowerCase() && body !== body.toUpperCase()) {
      if (checksumAddress(body) !== '0x' + body) return null
    }
    return '0x' + body.toLowerCase()
  }

  function pad32 (hex) {
    const h = String(hex == null ? '' : hex).replace(/^0x/i, '').toLowerCase()
    if (!/^[0-9a-f]*$/.test(h) || h.length > 64) return null
    return h.padStart(64, '0')
  }

  // Byte-identical to cat-tip.js: '0xa9059cbb' + pad(to) + pad(hex(atomic)).
  function erc20TransferData (to, atomic) {
    const dest = hexAddress(to)
    if (!dest) throw new Error('bad address')
    let amt
    try { amt = BigInt(atomic) } catch (e) { throw new Error('bad amount') }
    if (amt < 0n) throw new Error('negative')
    const hexAmt = amt.toString(16)
    if (hexAmt.length > 64) throw new Error('overflow')
    return '0xa9059cbb' + pad32(dest) + pad32(hexAmt)
  }

  function buildEip681 (token, chainId, to, atomic) {
    const t = hexAddress(token)
    const dest = hexAddress(to)
    if (!t || !dest) throw new Error('bad address')
    let chain
    let amt
    try {
      chain = BigInt(chainId)
      amt = BigInt(atomic)
    } catch (e) { throw new Error('bad amount') }
    if (chain < 0n || amt < 0n) throw new Error('negative')
    if (amt.toString(16).length > 64) throw new Error('overflow')
    return 'ethereum:' + t + '@' + chain.toString() + '/transfer?address=' + dest + '&uint256=' + amt.toString()
  }

  // Same shape as cat-tip.js: metamask.app.link/dapp/<page-without-scheme>
  // and go.cb-w.com/dapp?cb_url=<encoded page>.
  function baseDappLinks (pageUrl) {
    const page = String(pageUrl == null ? '' : pageUrl)
    if (!/^https:\/\//i.test(page)) return null
    return {
      metamask: 'https://metamask.app.link/dapp/' + page.replace(/^https?:\/\//i, ''),
      coinbase: 'https://go.cb-w.com/dapp?cb_url=' + encodeURIComponent(page)
    }
  }

  const api = {
    keccak256: keccak256,
    keccak256Text: keccak256Text,
    hexOf: hexOf,
    checksumAddress: checksumAddress,
    hexAddress: hexAddress,
    pad32: pad32,
    erc20TransferData: erc20TransferData,
    buildEip681: buildEip681,
    baseDappLinks: baseDappLinks,
    USDC_BASE: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    BASE_CHAIN_ID: 8453n
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (typeof window !== 'undefined') window.SCDOPayEvm = api
})()
