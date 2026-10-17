// Referral-code lookup signature. Read-only: no seq, no body.
// Payload is { v, chainId, type:'refcode', agent, ts } signed the same way as a register
// envelope: EIP-191 over 'SCDO Agent Ledger v1\n' + canonical JSON.
// This file is wallet-only. The shared ledger envelope stays register/heartbeat/heal/report.
'use strict'
const { getAddress } = require('ethers')
const { VERSION, CHAIN_ID, messageOf } = require('./envelope')

function signRefcode (signer, ts) {
  const payload = {
    v: VERSION,
    chainId: CHAIN_ID,
    type: 'refcode',
    agent: getAddress(signer.address),
    ts: Number(ts || Date.now())
  }
  return { payload, sig: signer.signMessageSync(messageOf(payload)) }
}

module.exports = { signRefcode }
