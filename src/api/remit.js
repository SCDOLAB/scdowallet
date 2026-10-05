// SCDO remittance gateway client (desktop wallet).
//
// Contract (scdo-remit-gateway, session login, no KYC):
//   POST {base}/v1/session/challenge   { address }  -> { challenge, address, nonce }
//   wallet personal_sign(challenge)                 EIP-191, ethers signMessage
//   POST {base}/v1/session             { address, signature } -> { token, address }
//   GET  {base}/v1/ledger?address=     Authorization: Bearer <token>
// The ledger route accepts the bearer token's own address only. This client
// refuses to request any other address, and treats a session or ledger bound
// to a different address as a rejection.
//
// Base URL: https://apeccapital.org (public SCDO host). PS2023 / the .88
// server override with SCDO_REMIT_URL (for example https://82.223.19.88 or a
// path prefix on that host). As of 2026-10-05 the public explorer hosts answer
// 404 for /v1/session/challenge; the wallet still calls this contract and
// surfaces that error instead of asking for identity data.
'use strict'
const { Wallet, verifyMessage, getAddress } = require('ethers')

const DEFAULT_BASE = 'https://apeccapital.org'
// Documented SCDO host whose address ends in .88 (bootnode / explorer).
// Use it via SCDO_REMIT_URL when the gateway is published there.
const SERVER_88 = 'https://82.223.19.88'

class ForeignAddressError extends Error {
  constructor (message) {
    super(message || 'foreign address rejected')
    this.name = 'ForeignAddressError'
    this.code = 'FOREIGN_ADDRESS'
  }
}

class RemitHttpError extends Error {
  constructor (message, status, body) {
    super(message)
    this.name = 'RemitHttpError'
    this.code = 'REMIT_HTTP'
    this.status = status
    this.body = body
  }
}

function sameAddress (a, b) {
  try { return getAddress(a) === getAddress(b) } catch (e) { return false }
}

function addressFromPrivateKey (privateKey) {
  return new Wallet(privateKey).address
}

function joinUrl (base, path) {
  return String(base || '').replace(/\/+$/, '') + path
}

function challengeMessage (body) {
  if (!body || typeof body !== 'object') throw new RemitHttpError('challenge response was not JSON', 200, body)
  const msg = body.challenge || body.message || body.signMessage || body.sign_message
  if (typeof msg !== 'string' || !msg.trim()) throw new RemitHttpError('challenge response has no message to sign', 200, body)
  return msg
}

// If the gateway named an address in the challenge, it must be the signer.
function assertChallengeFor (message, own) {
  const labeled = String(message).match(/address\s*[:：]\s*(0x[0-9a-fA-F]{40})/i)
  if (labeled && !sameAddress(labeled[1], own)) {
    throw new ForeignAddressError('challenge is for a different address')
  }
}

function bearerToken (session) {
  if (!session || typeof session !== 'object') return ''
  const token = session.token || session.accessToken || session.access_token || session.bearer
  return typeof token === 'string' ? token : ''
}

function isForeignRejection (status, body) {
  if (status !== 401 && status !== 403) return false
  const s = JSON.stringify(body || {}).toLowerCase()
  return /own address|foreign|mismatch|does not match|not the signer|別人|signature/.test(s)
}

async function requestJson (base, path, opts, fetchImpl) {
  opts = opts || {}
  const headers = Object.assign({ accept: 'application/json' }, opts.headers || {})
  let body
  if (opts.body != null) {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(opts.body)
  }
  const res = await (fetchImpl || fetch)(joinUrl(base, path), { method: opts.method || 'GET', headers, body })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch (e) { json = { raw: text.slice(0, 180) } }
  if (!res.ok) {
    const detail = (json && (json.error || json.message)) || ('HTTP ' + res.status)
    const err = new RemitHttpError(String(detail), res.status, json)
    if (isForeignRejection(res.status, json)) {
      const foreign = new ForeignAddressError(String(detail))
      foreign.status = res.status
      foreign.body = json
      throw foreign
    }
    throw err
  }
  return json
}

async function personalSign (privateKey, message) {
  const wallet = new Wallet(privateKey)
  const signature = await wallet.signMessage(message)
  const recovered = verifyMessage(message, signature)
  return { address: wallet.address, signature, recovered }
}

// GET /v1/ledger for sessionAddress only. A different address never hits the network.
async function fetchLedger (base, token, address, sessionAddress, fetchImpl) {
  if (!token) throw new RemitHttpError('missing bearer token', 401, null)
  if (!sameAddress(address, sessionAddress)) {
    throw new ForeignAddressError('refusing to open another address ledger')
  }
  const own = getAddress(sessionAddress)
  const q = '/v1/ledger?address=' + encodeURIComponent(own)
  const ledger = await requestJson(base, q, {
    method: 'GET',
    headers: { authorization: 'Bearer ' + token }
  }, fetchImpl)
  const bound = ledger && (ledger.address || ledger.account)
  if (bound && !sameAddress(bound, own)) throw new ForeignAddressError('ledger belongs to a different address')
  return ledger
}

// Full zero-KYC login: challenge -> personal_sign -> session -> own ledger.
// opts.address, when set, must be the key's own address.
async function login (opts) {
  opts = opts || {}
  if (!opts.privateKey) throw new Error('missing private key')
  const base = String(opts.base || DEFAULT_BASE).replace(/\/+$/, '')
  const fetchImpl = opts.fetchImpl
  const own = addressFromPrivateKey(opts.privateKey)
  if (opts.address && !sameAddress(opts.address, own)) {
    throw new ForeignAddressError('signing key does not match the requested address')
  }
  const step = (name) => { if (typeof opts.onStep === 'function') opts.onStep(name) }
  step('challenge')
  const issued = await requestJson(base, '/v1/session/challenge', { method: 'POST', body: { address: own } }, fetchImpl)
  const issuedAddress = issued && (issued.address || issued.account)
  if (issuedAddress && !sameAddress(issuedAddress, own)) throw new ForeignAddressError('challenge was issued for a different address')
  const message = challengeMessage(issued)
  assertChallengeFor(message, own)
  step('sign')
  const signed = await personalSign(opts.privateKey, message)
  if (!sameAddress(signed.recovered, own)) throw new ForeignAddressError('personal_sign recovered a different address')
  step('session')
  const session = await requestJson(base, '/v1/session', {
    method: 'POST',
    body: { address: own, signature: signed.signature }
  }, fetchImpl)
  const token = bearerToken(session)
  if (!token) throw new RemitHttpError('session response missing bearer token', 200, session)
  const sessionAddress = (session && (session.address || session.account)) || own
  if (!sameAddress(sessionAddress, own)) throw new ForeignAddressError('session was issued for a different address')
  step('ledger')
  const ledger = await fetchLedger(base, token, own, own, fetchImpl)
  return { address: getAddress(own), token, ledger, challenge: message, signature: signed.signature, base }
}

module.exports = {
  DEFAULT_BASE,
  SERVER_88,
  ForeignAddressError,
  RemitHttpError,
  sameAddress,
  addressFromPrivateKey,
  challengeMessage,
  assertChallengeFor,
  personalSign,
  fetchLedger,
  login,
  joinUrl
}
