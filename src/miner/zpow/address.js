// Classic (1S01 / 2S02 / 3S03 / 4S04) and Shard0 (0x) mining addresses.
// Numeric and address fields are NFKC-normalised and forced to half-width
// before they are checked, so a full-width paste still validates.
'use strict'

const PREFIX = { 1: '1S01', 2: '2S02', 3: '3S03', 4: '4S04' }

function normalizeMiningInput (value) {
  let s = String(value == null ? '' : value).normalize('NFKC')
  // NFKC maps most full-width ASCII; this covers the rest (and ideographic space).
  s = s.replace(/[\uFF01-\uFF5E]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
  s = s.replace(/\u3000/g, ' ').replace(/\s+/g, '')
  return s
}

function classicShardOf (address) {
  const a = parseClassicAddress(address)
  return a ? a.shard : null
}

// Wallet rule (scdoClient.callContract / keyfiles): 4-char shard prefix, 37 hex, version digit 1 or 2.
function parseClassicAddress (value) {
  const address = normalizeMiningInput(value)
  const m = /^((1S01|2S02|3S03|4S04)[a-fA-F0-9]{37}[1-2])$/.exec(address)
  if (!m) return null
  const prefix = address.slice(0, 4).toUpperCase()
  const shard = Number(prefix[0])
  if (PREFIX[shard] !== prefix) return null
  return { kind: 'classic', shard, address: prefix + address.slice(4) }
}

function parseShard0Address (value) {
  const address = normalizeMiningInput(value)
  if (!/^0x[0-9a-fA-F]{40}$/.test(address) || /^0x0{40}$/i.test(address)) return null
  return { kind: 'shard0', shard: 0, address }
}

function parseMiningAddress (value, expect) {
  const classic = parseClassicAddress(value)
  const shard0 = parseShard0Address(value)
  if (expect === 'classic') return classic
  if (expect === 'shard0') return shard0
  return classic || shard0
}

module.exports = {
  PREFIX,
  normalizeMiningInput,
  classicShardOf,
  parseClassicAddress,
  parseShard0Address,
  parseMiningAddress
}
