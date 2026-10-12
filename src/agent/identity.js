// Agent key: generated on this machine, stored in the wallet's data dir (file 0600), never sent or logged.
// It is NOT a wallet account: it holds no funds and is separate from the user's keystore.
'use strict'
const fs = require('fs')
const path = require('path')
const { Wallet } = require('ethers')
const { signEnvelope, newSigner } = require('./envelope')

function loadOrCreate (dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const file = path.join(dir, 'agent-key.json')
  let rec = null
  try { rec = JSON.parse(fs.readFileSync(file, 'utf8')) } catch (e) {}
  let w = null
  if (rec && typeof rec.key === 'string') { try { w = new Wallet(rec.key) } catch (e) { w = null } }
  if (!w) {
    const fresh = newSigner()
    w = new Wallet(fresh.privateKey)
    rec = { createdAt: new Date().toISOString(), key: fresh.privateKey, seq: 0 }
    const tmp = file + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(rec), { mode: 0o600 })
    fs.renameSync(tmp, file)
  }
  let seq = Number(rec.seq) || 0
  const save = () => { try { rec.seq = seq; fs.writeFileSync(file, JSON.stringify(rec), { mode: 0o600 }) } catch (e) {} }
  return {
    address: w.address,
    agentId: w.address,
    // Only signed envelopes leave this object; the key itself is never returned.
    sign (type, body, ts) { seq += 1; save(); return signEnvelope(w, type, seq, body, ts) },
    toJSON () { return { agentId: w.address } }
  }
}

module.exports = { loadOrCreate }
