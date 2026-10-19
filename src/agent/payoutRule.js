'use strict'
// 3.1.11: same payout rule as the SCDO Agent Ledger (2026-10-19). The ledger lists and counts only agents with a
// valid payout address; zero, placeholder, repeated-digit, burn and public test addresses are refused.
const KNOWN_BAD = new Set([
  '000000000000000000000000000000000000dead', 'dead000000000000000042069420694206942069', 'deaddeaddeaddeaddeaddeaddeaddeaddeaddead',
  'f39fd6e51aad88f6f4ce6ab8827279cfffb92266', '70997970c51812dc3a010c7d01b50e0d17dc79c8', '3c44cdddb6a900fa2b585dd299e03d12fa4293bc',
  '90f79bf6eb2c4f870365e785982e1f101e93b906', '15d34aaf54267db7d7c367839aaf71a00a2c6a65', '9965507d1a55bcc2695c58ba16fb37d819b0a4dc',
  '976ea74026e726554db657fa54763abd0c3a0aa9', '14dc79964da2c08b23698b3d3cc7ca32193d9955', '23618e81e3f5cdf7f54c3d65f7fbc0abf5b21e8f',
  'a0ee7a142d267c1f36714e4a8f75612f20a79720'
])

function payoutProblem (value) {
  const s = String(value || '').trim()
  if (!/^0x[0-9a-fA-F]{40}$/.test(s)) return 'payout_invalid'
  const lower = s.slice(2).toLowerCase()
  if (KNOWN_BAD.has(lower)) return 'payout_placeholder'
  if (new Set(lower).size < 4) return 'payout_placeholder'
  if (/(.)\1{19,}/.test(lower)) return 'payout_placeholder'
  for (let p = 2; p <= 8; p++) {
    if (lower.slice(0, p).repeat(Math.ceil(40 / p)).slice(0, 40) === lower) return 'payout_placeholder'
  }
  return null
}

/** A Shard0/EVM address the ledger accepts as payout, or ''. Classic 1S01… addresses are not ledger payouts. */
function ledgerPayout (value) {
  const s = String(value || '').trim()
  return payoutProblem(s) ? '' : s
}

module.exports = { payoutProblem, ledgerPayout }
