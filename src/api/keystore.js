// Pure-JS implementation of the go-scdo keystore (version 1), byte-compatible with
// go-scdo common/keystore (scrypt N=2^18,r=8,p=1,dkLen=32 + AES-128-CTR,
// mac = keccak256(dk[16:32] || ciphertext)). Replaces the bundled Go `client`
// binary (savekey / deckeyfile) that ScdoWallet <= 1.0.1 shelled out to.
'use strict'
const crypto = require('crypto')
const { keccak256, SigningKey, getBytes, hexlify } = require('ethers')
const rlp = require('rlp')

const SCRYPT = { N: 1 << 18, r: 8, p: 1, dkLen: 32 }
const SCRYPT_MAXMEM = 512 * 1024 * 1024

function scryptKey (password, salt) {
  return new Promise((resolve, reject) => {
    if (!password || password.length < 1) return reject(new Error('password could not be empty'))
    crypto.scrypt(Buffer.from(password, 'utf8'), salt, SCRYPT.dkLen,
      { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT_MAXMEM },
      (err, dk) => err ? reject(err) : resolve(dk))
  })
}

function aesCtr (key16, data, iv) {
  const c = crypto.createCipheriv('aes-128-ctr', key16, iv)
  return Buffer.concat([c.update(data), c.final()])
}

function macOf (dk, cipherText) {
  return keccak256(Buffer.concat([dk.slice(16, 32), cipherText])) // 0x-prefixed lower-case hex
}

function normPriv (privHex) {
  let h = String(privHex).trim()
  if (h.startsWith('0x') || h.startsWith('0X')) h = h.slice(2)
  if (!/^[0-9a-fA-F]{64}$/.test(h)) throw new Error('invalid private key')
  const b = Buffer.from(h, 'hex')
  // validity check (0 < k < n) via SigningKey
  new SigningKey('0x' + h) // eslint-disable-line no-new
  return b
}

// Old-shard address, go-scdo crypto.GetAddress: keccak256(rlp(pub64))[12:], byte0 = shard, last nibble = 1
function scdoAddressFromPriv (privHex, shard) {
  shard = parseInt(shard, 10)
  if (!(shard >= 1 && shard <= 4)) throw new Error('shard must be 1-4')
  const pk = normPriv(privHex)
  const pub = Buffer.from(getBytes(new SigningKey('0x' + pk.toString('hex')).publicKey)).slice(1) // 64 bytes
  const a = Buffer.from(getBytes(keccak256(rlp.encode(pub)))).slice(-20)
  a[0] = shard
  a[19] = (a[19] & 0xF0) | 1
  return shard + 'S' + a.toString('hex')
}

async function encryptKey (privHex, password, shard) {
  const pk = normPriv(privHex)
  const address = scdoAddressFromPriv(privHex, shard)
  const salt = crypto.randomBytes(32)
  const iv = crypto.randomBytes(16)
  const dk = await scryptKey(password, salt)
  const ct = aesCtr(dk.slice(0, 16), pk, iv)
  const obj = {
    version: 1,
    address: address,
    crypto: {
      ciphertext: ct.toString('hex'),
      iv: iv.toString('hex'),
      salt: salt.toString('hex'),
      mac: macOf(dk, ct)
    }
  }
  // same layout as Go json.MarshalIndent(v, "", "\t")
  return JSON.stringify(obj, null, '\t')
}

// returns { privateKey: '0x..', address: '1S01..' }; throws on wrong password
async function decryptKey (json, password) {
  const k = typeof json === 'string' ? JSON.parse(json) : json
  if (k.version !== 1) throw new Error('keystore version mismatch: ' + k.version)
  const c = k.crypto || {}
  const salt = Buffer.from(c.salt, 'hex')
  const iv = Buffer.from(c.iv, 'hex')
  const ct = Buffer.from(c.ciphertext, 'hex')
  const dk = await scryptKey(password, salt)
  const mac = macOf(dk, ct)
  if (String(c.mac).toLowerCase() !== mac) throw new Error('could not decrypt key with given passphrase')
  const pk = aesCtr(dk.slice(0, 16), ct, iv)
  const privateKey = hexlify(pk)
  const shard = parseInt(String(k.address).charAt(0), 10) || 1
  return { privateKey, address: scdoAddressFromPriv(privateKey, shard) }
}

module.exports = { encryptKey, decryptKey, scdoAddressFromPriv, SCRYPT }
