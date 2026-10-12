// SCDO Wallet 2.0.12 匯款 (remittance) sign-in, main process.
// The renderer is sandboxed, so keyfile decryption, the EIP-191 personal_sign of the gateway challenge and the
// bearer token all stay here. The renderer only sees the signed-in address and that address's own ledger.
// Gateway: https://scdoscan.io/remit-api (override SCDO_REMIT_URL; mirror https://apeccapital.org/remit-api).
'use strict'
const Remit = require('../api/remit')

let session = null // { address, token } for the one signed-in address

function base () {
  const env = String(process.env.SCDO_REMIT_URL || '').trim().replace(/\/+$/, '')
  return env || Remit.DEFAULT_BASE
}
function errOut (e) {
  const foreign = !!(e && (e.code === 'FOREIGN_ADDRESS' || e instanceof Remit.ForeignAddressError))
  const down = !!(e && (e.status === 404 || /HTTP 404|no \/v1\/session/i.test(String(e.message || ''))))
  const wrongPw = !!(e && /could not decrypt key|BAD_PW/i.test(String(e.message || '')))
  const net = !!(e && /ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|fetch failed|network/i.test(String(e.message || '')))
  return { ok: false, foreign, down, wrongPw, net, error: String((e && e.message) || e || 'failed').slice(0, 200) }
}

// decrypt(file, pw) -> 0x private key (provided by walletService; the key never leaves this process)
function register (ipcMain, decrypt) {
  ipcMain.handle('remit:info', () => ({ base: base(), address: session ? session.address : '' }))
  ipcMain.handle('remit:login', async (e, file, pw) => {
    let priv = null
    const step = (p) => { try { if (!e.sender.isDestroyed()) e.sender.send('remit:step', p) } catch (x) {} }
    try {
      session = null
      priv = await decrypt(file, String(pw || ''))
      const own = Remit.addressFromPrivateKey(priv)
      const s = await Remit.login({ privateKey: priv, address: own, base: base(), onStep: step })
      priv = null
      if (!Remit.sameAddress(s.address, own)) throw new Remit.ForeignAddressError('session address does not match the signing key')
      session = { address: s.address, token: s.token }
      return { ok: true, address: s.address, ledger: s.ledger == null ? null : s.ledger }
    } catch (err) {
      priv = null
      session = null
      return errOut(err)
    }
  })
  ipcMain.handle('remit:ledger', async (e, address) => {
    if (!session || !Remit.sameAddress(address, session.address)) { return { ok: false, foreign: true, error: 'no session for this address' } }
    try {
      const ledger = await Remit.fetchLedger(base(), session.token, session.address, session.address)
      return { ok: true, address: session.address, ledger }
    } catch (err) {
      const o = errOut(err)
      if (o.foreign) session = null
      return o
    }
  })
  ipcMain.handle('remit:logout', () => { session = null; return true })
}

module.exports = { register, base, _test: { get session () { return session }, reset () { session = null } } }
