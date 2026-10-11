// 12-word backup for a new account. BIP39 English, empty passphrase,
// derivation path m/44'/60'/0'/0/0. The same private key is what the keystore stores.
// The phrase itself is sealed (scrypt + AES-256-GCM) until the user saves it or says they wrote it down.
'use strict'
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { HDNodeWallet, Mnemonic } = require('ethers')
const { SCRYPT } = require('./keystore')

const PATH = "m/44'/60'/0'/0/0"

function scryptKey (password, salt) {
  return new Promise((resolve, reject) => {
    if (!password || password.length < 1) return reject(new Error('NO_PASSWORD'))
    crypto.scrypt(Buffer.from(password, 'utf8'), salt, SCRYPT.dkLen,
      { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 512 * 1024 * 1024 },
      (err, dk) => err ? reject(err) : resolve(dk))
  })
}

function wordsOf (s) {
  return String(s || '').trim().toLowerCase().split(/\s+/).filter(Boolean)
}

function isPhrase (s) {
  const w = wordsOf(s)
  if (w.length !== 12 || w.some(x => !/^[a-z]+$/.test(x))) return false
  return Mnemonic.isValidMnemonic(w.join(' '))
}

function privateKeyFromPhrase (phrase) {
  const words = wordsOf(phrase).join(' ')
  if (!Mnemonic.isValidMnemonic(words)) throw new Error('BAD_PHRASE')
  return HDNodeWallet.fromPhrase(words, '', PATH).privateKey
}

function generateAccount () {
  const phrase = Mnemonic.fromEntropy(crypto.randomBytes(16)).phrase
  return { phrase, words: phrase.split(' '), privateKey: privateKeyFromPhrase(phrase), path: PATH }
}

function today (d) {
  d = d || new Date()
  const z = (n) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate())
}

async function seal (phrase, password, extra) {
  if (!password) throw new Error('NO_PASSWORD')
  const salt = crypto.randomBytes(16)
  const iv = crypto.randomBytes(12)
  const dk = await scryptKey(password, salt)
  const c = crypto.createCipheriv('aes-256-gcm', dk, iv)
  const ct = Buffer.concat([c.update(String(phrase), 'utf8'), c.final()])
  return JSON.stringify({
    v: 1,
    path: PATH,
    created: (extra && extra.created) || today(),
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    tag: c.getAuthTag().toString('hex'),
    ct: ct.toString('hex')
  })
}

async function open (json, password) {
  const k = typeof json === 'string' ? JSON.parse(json) : json
  if (!k || k.v !== 1) throw new Error('BAD_SEAL')
  try {
    const dk = await scryptKey(password, Buffer.from(k.salt, 'hex'))
    const d = crypto.createDecipheriv('aes-256-gcm', dk, Buffer.from(k.iv, 'hex'))
    d.setAuthTag(Buffer.from(k.tag, 'hex'))
    return Buffer.concat([d.update(Buffer.from(k.ct, 'hex')), d.final()]).toString('utf8')
  } catch (e) {
    if (e && e.message === 'NO_PASSWORD') throw e
    throw new Error('WRONG_PASSWORD')
  }
}

function meta (json) {
  try {
    const k = typeof json === 'string' ? JSON.parse(json) : json
    return { created: k && k.created ? String(k.created) : '', path: PATH }
  } catch (e) { return { created: '', path: PATH } }
}

function safeFile (name) {
  if (typeof name !== 'string' || !name || name !== path.basename(name) || name === '.' || name === '..' || /[\\/]/.test(name)) throw new Error('invalid keyfile name')
  return name
}

function sealPath (dir, filename) {
  return path.join(dir, safeFile(filename) + '.json')
}

function writeSeal (dir, filename, json) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const p = sealPath(dir, filename)
  const fd = fs.openSync(p, 'wx', 0o600)
  try { fs.writeSync(fd, json); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  return p
}

function readSeal (dir, filename) {
  try { return fs.readFileSync(sealPath(dir, filename), 'utf8') } catch (e) { return '' }
}

function removeSeal (dir, filename) {
  try { fs.unlinkSync(sealPath(dir, filename)) } catch (e) {}
}

function listPending (dir) {
  let names = []
  try { names = fs.readdirSync(dir) } catch (e) { return [] }
  const out = []
  for (const n of names) {
    if (!n.endsWith('.json')) continue
    const base = n.slice(0, -'.json'.length)
    try { if (safeFile(base) === base) out.push(base) } catch (e) {}
  }
  return out
}

function saveDefaultPath (documentsDir, kind, day) {
  const ext = kind === 'png' ? 'png' : 'txt'
  return path.join(documentsDir, 'ScdoWallet', 'SCDO-backup-' + (day || today()) + '.' + ext)
}

module.exports = {
  PATH, wordsOf, isPhrase, privateKeyFromPhrase, generateAccount, today, seal, open, meta,
  safeFile, sealPath, writeSeal, readSeal, removeSeal, listPending, saveDefaultPath
}
