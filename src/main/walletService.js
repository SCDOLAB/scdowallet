// Keyfile decrypt for 2.0.12 匯款 sign-in.
// This repo's renderer still decrypts keyfiles for ordinary transfers. Remittance does not:
// remitService calls decryptForRemit here, uses the private key only for one EIP-191 personal_sign,
// and never puts the key or the bearer token on the IPC result.
'use strict'
const path = require('path')
const ScdoClient = require('../api/scdoClient')

let client = null
function c () {
  if (!client) client = new ScdoClient()
  return client
}
function safeName (file) {
  if (typeof file !== 'string' || !file || file !== path.basename(file) || file === '.' || file === '..' || /[\\/]/.test(file)) {
    throw new Error('invalid keyfile name')
  }
  return file
}
function decryptForRemit (file, pw) {
  return c().decKeyFile(safeName(file), String(pw || ''))
}

module.exports = { decryptForRemit, safeName }
