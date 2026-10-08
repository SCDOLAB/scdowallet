// Cross-check the JS keystore against the original Go `client` binary shipped in ScdoWallet 1.0.1
// (cmd/linux/client). Uses a freshly generated THROWAWAY key only.
'use strict'
const assert = require('assert')
const fs = require('fs'); const os = require('os'); const path = require('path')
const { spawn } = require('child_process')
const ks = require('../src/api/keystore')
const Scdo = require('scdo.js')

function clientBinary () {
  const root = path.join(__dirname, '..', 'cmd')
  const names = {
    win32: [path.join('windows', 'client.exe'), path.join('win32', 'client.exe')],
    darwin: [path.join('mac', 'client')],
    linux: [path.join('linux', 'client')]
  }
  for (const rel of names[process.platform] || []) {
    const file = path.join(root, rel)
    if (fs.existsSync(file)) return file
  }
  return null
}

const GO = clientBinary()
if (!GO) {
  console.log('keystore-compat: SKIP (no ' + process.platform + ' client binary; the Go savekey/deckeyfile round-trip uses cmd/<platform>/client)')
  process.exit(0)
}

function run (args, password) {
  return new Promise((resolve, reject) => {
    const p = spawn(GO, args); let out = ''
    p.stdout.on('data', d => { out += d; if (/password/i.test(String(d))) p.stdin.write(password + '\n') })
    p.stderr.on('data', d => { out += d })
    p.on('close', code => resolve({ code, out }))
    p.on('error', reject)
  })
}

;(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kscompat-'))
  const pw = 'Test#Pass123'
  for (const shard of [1, 2, 3, 4]) {
    const kp = new Scdo().keyTool.generateKeys(shard) // throwaway
    // 1) address derivation JS == scdo.js
    assert.strictEqual(ks.scdoAddressFromPriv(kp.privatekey, shard).toLowerCase(), kp.publickey.toLowerCase())
    // 2) Go savekey -> JS decrypt
    const f1 = path.join(dir, 'go-' + shard)
    const r1 = await run(['savekey', '--privatekey', kp.privatekey, '--file', f1, '--shard', String(shard)], pw)
    assert.ok(/store key successfully/.test(r1.out), r1.out)
    const d1 = await ks.decryptKey(fs.readFileSync(f1, 'utf8'), pw)
    assert.strictEqual(d1.privateKey, kp.privatekey)
    assert.strictEqual(d1.address.toLowerCase(), kp.publickey.toLowerCase())
    await assert.rejects(ks.decryptKey(fs.readFileSync(f1, 'utf8'), 'wrong'))
    // 3) JS encrypt -> Go deckeyfile
    const f2 = path.join(dir, 'js-' + shard)
    fs.writeFileSync(f2, await ks.encryptKey(kp.privatekey, pw, shard))
    const r2 = await run(['deckeyfile', '--file', f2], pw)
    assert.ok(r2.out.includes(kp.privatekey), r2.out)
    // same JSON shape as go file (keys, lengths) so old wallet's keyfileisvalid() accepts it
    const a = JSON.parse(fs.readFileSync(f1)); const b = JSON.parse(fs.readFileSync(f2))
    assert.deepStrictEqual(Object.keys(a), Object.keys(b)); assert.deepStrictEqual(Object.keys(a.crypto), Object.keys(b.crypto))
    assert.strictEqual(a.address, b.address)
    assert.ok(fs.statSync(f2).size <= 376, 'size ' + fs.statSync(f2).size + ' vs go ' + fs.statSync(f1).size)
    console.log('shard', shard, 'OK', kp.publickey, 'go-size', fs.statSync(f1).size, 'js-size', fs.statSync(f2).size)
  }
  fs.rmSync(dir, { recursive: true })
  console.log('keystore-compat: PASS')
})().catch(e => { console.error('FAIL', e); process.exit(1) })
