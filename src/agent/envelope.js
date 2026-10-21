// AI Agent Ledger v1: signed envelopes. Shared byte-for-byte with server/agent-ledger/envelope.js.
// Each machine signs with its own secp256k1 key (an EVM address on SCDO Shard0, chainId 5680), the
// same identity type as AgentLedger v0.1 (0x377a…a2aa) and ComputeLedger registerBySig, so the agent
// can later be registered/anchored on chain. The server only ever sees signatures and addresses.
'use strict'
const { Wallet, verifyMessage, getAddress } = require('ethers')

const VERSION = 1
const CHAIN_ID = 5680
const PREFIX = 'SCDO Agent Ledger v1\n'
const TYPES = ['register', 'heartbeat', 'heal', 'report', 'gas_drip']

function canonical (v) {
  if (v === null || typeof v !== 'object') {
    if (typeof v === 'number' && !Number.isFinite(v)) return 'null'
    return JSON.stringify(v === undefined ? null : v)
  }
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']'
  return '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}'
}

function messageOf (payload) { return PREFIX + canonical(payload) }

// signer: ethers Wallet (or anything with address + signMessageSync)
function signEnvelope (signer, type, seq, body, ts) {
  if (TYPES.indexOf(type) < 0) throw new Error('bad type')
  const payload = { v: VERSION, chainId: CHAIN_ID, type, agent: getAddress(signer.address), seq: Number(seq), ts: Number(ts || Date.now()), body: body || {} }
  return { payload, sig: signer.signMessageSync(messageOf(payload)) }
}

// Returns { ok, error }. Shape + EIP-191 signature recovery; freshness/seq are the caller's job.
function verifyEnvelope (env) {
  try {
    if (!env || typeof env !== 'object' || !env.payload || typeof env.sig !== 'string') return { ok: false, error: 'malformed' }
    const p = env.payload
    if (p.v !== VERSION) return { ok: false, error: 'version' }
    if (p.chainId !== CHAIN_ID) return { ok: false, error: 'chainId' }
    if (TYPES.indexOf(p.type) < 0) return { ok: false, error: 'type' }
    if (!Number.isSafeInteger(p.seq) || p.seq < 1) return { ok: false, error: 'seq' }
    if (!Number.isSafeInteger(p.ts)) return { ok: false, error: 'ts' }
    if (!p.body || typeof p.body !== 'object' || Array.isArray(p.body)) return { ok: false, error: 'body' }
    if (typeof p.agent !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(p.agent)) return { ok: false, error: 'agent' }
    if (!/^0x[0-9a-fA-F]{130}$/.test(env.sig)) return { ok: false, error: 'signature' }
    const rec = verifyMessage(messageOf(p), env.sig)
    if (rec.toLowerCase() !== p.agent.toLowerCase()) return { ok: false, error: 'signature' }
    return { ok: true, agent: getAddress(p.agent) }
  } catch (e) { return { ok: false, error: 'signature' } }
}

function newSigner () { return Wallet.createRandom() }

module.exports = { VERSION, CHAIN_ID, PREFIX, TYPES, canonical, messageOf, signEnvelope, verifyEnvelope, newSigner }
