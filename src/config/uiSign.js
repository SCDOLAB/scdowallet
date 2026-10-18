// Ed25519 signatures for wallet-ui.json and ui-latest.json.
// Same canonical JSON as the update feed (src/updater.js / sign-latest.js):
// drop the signature field, sort keys recursively, compact JSON, UTF-8.
// Live wallet-ui.json uses "signature" (updater.js). ui-latest.json may use "sig".
'use strict'
const crypto = require('crypto')
const { PUBKEY_B64 } = require('../updater')

function sortKeys (v) {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (v !== null && typeof v === 'object') {
    const out = {}
    for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k])
    return out
  }
  return v
}

function canonicalSigned (obj) {
  const payload = Object.assign({}, obj || {})
  // wallet-ui.json on the update feed uses "signature", the same field updater.js drops.
  // ui-latest.json still uses "sig". Drop both so either document verifies.
  delete payload.sig
  delete payload.signature
  return JSON.stringify(sortKeys(payload))
}

function signatureOf (doc) {
  if (!doc || typeof doc !== 'object') return ''
  if (typeof doc.signature === 'string' && doc.signature) return doc.signature
  if (typeof doc.sig === 'string' && doc.sig) return doc.sig
  return ''
}

function publicKeyFromB64 (b64) {
  const raw = Buffer.from(String(b64 || ''), 'base64')
  if (raw.length !== 32) throw new Error('invalid public key')
  return crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: raw.toString('base64url') }, format: 'jwk' })
}

function verifySigned (doc, opts) {
  opts = opts || {}
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { ok: false, error: 'not an object' }
  const sig = signatureOf(doc)
  if (!sig) return { ok: false, error: 'missing sig' }
  let pub
  try { pub = publicKeyFromB64(opts.publicKey || PUBKEY_B64) } catch (e) { return { ok: false, error: 'bad public key' } }
  let ok = false
  try {
    ok = crypto.verify(null, Buffer.from(canonicalSigned(doc), 'utf8'), pub, Buffer.from(sig, 'base64'))
  } catch (e) { return { ok: false, error: 'bad signature' } }
  return ok ? { ok: true } : { ok: false, error: 'signature mismatch' }
}

function signDoc (doc, privateKey, field) {
  const name = field === 'signature' ? 'signature' : 'sig'
  const payload = Object.assign({}, doc || {})
  delete payload.sig
  delete payload.signature
  const sig = crypto.sign(null, Buffer.from(canonicalSigned(payload), 'utf8'), privateKey).toString('base64')
  const out = Object.assign({}, payload)
  out[name] = sig
  return out
}

module.exports = { canonicalSigned, verifySigned, signDoc, signatureOf, publicKeyFromB64, sortKeys, PUBKEY_B64 }
