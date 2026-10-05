// Remittance login: challenge -> personal_sign -> session -> own ledger.
// Proves a signature from address A cannot open address B's session or ledger.
'use strict'
const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const http = require('http')
const path = require('path')
const { Wallet, verifyMessage, getAddress } = require('ethers')
const remit = require('../src/api/remit')

let n = 0
function test (name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { n++; console.log('ok ' + name) })
}

function readBody (req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) return resolve({})
      try { resolve(JSON.parse(raw)) } catch (e) { reject(e) }
    })
    req.on('error', reject)
  })
}

function send (res, status, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
  res.end(body)
}

function challengeText (address, nonce) {
  return 'SCDO Remittance\n\nSign in to your own remittance ledger.\nThis signature is not a coin transfer.\n\nAddress: ' + address + '\nNonce: ' + nonce + '\n'
}

// Local stand-in for the deployed gateway's own-address rule.
function startGateway () {
  const challenges = new Map()
  const tokens = new Map()
  const hits = { ledger: [] }
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1')
      if (req.method === 'POST' && url.pathname === '/v1/session/challenge') {
        const body = await readBody(req)
        const address = getAddress(body.address)
        const nonce = crypto.randomBytes(16).toString('hex')
        const message = challengeText(address, nonce)
        challenges.set(address.toLowerCase(), { message, address })
        return send(res, 200, { address, challenge: message, nonce })
      }
      if (req.method === 'POST' && url.pathname === '/v1/session') {
        const body = await readBody(req)
        let claimed
        try { claimed = getAddress(body.address) } catch (e) { return send(res, 403, { error: 'signature does not match address' }) }
        const ch = challenges.get(claimed.toLowerCase())
        if (!ch) return send(res, 403, { error: 'signature does not match address' })
        let recovered
        try { recovered = verifyMessage(ch.message, body.signature) } catch (e) { return send(res, 403, { error: 'signature does not match address' }) }
        if (getAddress(recovered) !== claimed) return send(res, 403, { error: 'signature does not match address' })
        const token = crypto.randomBytes(24).toString('hex')
        tokens.set(token, claimed)
        challenges.delete(claimed.toLowerCase())
        return send(res, 200, { token, address: claimed, tokenType: 'Bearer' })
      }
      if (req.method === 'GET' && url.pathname === '/v1/ledger') {
        const header = String(req.headers.authorization || '')
        const token = header.replace(/^Bearer\s+/i, '')
        const own = tokens.get(token)
        if (!own) return send(res, 401, { error: 'missing or invalid token' })
        const q = url.searchParams.get('address')
        hits.ledger.push(q)
        if (q && getAddress(q) !== getAddress(own)) return send(res, 403, { error: 'own address only' })
        return send(res, 200, { address: own, entries: [{ id: 'own', note: 'remittance ledger' }] })
      }
      return send(res, 404, { error: 'not found' })
    } catch (e) {
      send(res, 500, { error: String(e.message || e) })
    }
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, hits, base: 'http://127.0.0.1:' + server.address().port })
    })
  })
}

async function main () {
  const keyA = Wallet.createRandom()
  const keyB = Wallet.createRandom()
  const addrA = keyA.address
  const addrB = keyB.address
  assert.notStrictEqual(addrA.toLowerCase(), addrB.toLowerCase())

  await test('personal_sign from A does not recover as B', async () => {
    const message = challengeText(addrA, 'nonce-a')
    const sig = await keyA.signMessage(message)
    assert.strictEqual(getAddress(verifyMessage(message, sig)), addrA)
    assert.notStrictEqual(getAddress(verifyMessage(message, sig)), addrB)
  })

  const gw = await startGateway()
  try {
    await test('A challenge, A signature, A session, A ledger', async () => {
      const steps = []
      const session = await remit.login({ privateKey: keyA.privateKey, base: gw.base, onStep: (s) => steps.push(s) })
      assert.deepStrictEqual(steps, ['challenge', 'sign', 'session', 'ledger'])
      assert.strictEqual(session.address, addrA)
      assert.ok(session.token)
      assert.strictEqual(session.ledger.address, addrA)
      assert.strictEqual(session.ledger.entries[0].id, 'own')
      assert.ok(session.challenge.includes(addrA))
    })

    await test('client refuses to log key A in as address B before any session', async () => {
      let calls = 0
      const fetchImpl = async () => { calls++; throw new Error('network should not be used') }
      await assert.rejects(
        () => remit.login({ privateKey: keyA.privateKey, address: addrB, base: gw.base, fetchImpl }),
        (err) => err instanceof remit.ForeignAddressError && err.code === 'FOREIGN_ADDRESS'
      )
      assert.strictEqual(calls, 0)
    })

    await test('signing A against B\'s challenge cannot open B\'s session', async () => {
      const issued = await fetch(gw.base + '/v1/session/challenge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address: addrB })
      }).then(r => r.json())
      assert.ok(issued.challenge.includes(addrB))
      const signature = await keyA.signMessage(issued.challenge)
      assert.strictEqual(getAddress(verifyMessage(issued.challenge, signature)), addrA)
      const res = await fetch(gw.base + '/v1/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address: addrB, signature })
      })
      const body = await res.json()
      assert.strictEqual(res.status, 403)
      assert.strictEqual(body.error, 'signature does not match address')
      assert.ok(!body.token)
    })

    await test('A\'s bearer token cannot read B\'s ledger', async () => {
      const session = await remit.login({ privateKey: keyA.privateKey, base: gw.base })
      const res = await fetch(gw.base + '/v1/ledger?address=' + encodeURIComponent(addrB), {
        headers: { authorization: 'Bearer ' + session.token }
      })
      const body = await res.json()
      assert.strictEqual(res.status, 403)
      assert.strictEqual(body.error, 'own address only')
      await assert.rejects(
        () => remit.fetchLedger(gw.base, session.token, addrB, addrA, async () => { throw new Error('must not request B') }),
        (err) => err instanceof remit.ForeignAddressError
      )
    })

    await test('a ledger payload bound to B is rejected for A', async () => {
      const session = await remit.login({ privateKey: keyA.privateKey, base: gw.base })
      const fetchImpl = async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ address: addrB, entries: [{ id: 'stolen' }] })
      })
      await assert.rejects(
        () => remit.fetchLedger(gw.base, session.token, addrA, addrA, fetchImpl),
        (err) => err instanceof remit.ForeignAddressError && /different address/.test(err.message)
      )
    })

    await test('challenge that names B is not signed for A', async () => {
      assert.throws(
        () => remit.assertChallengeFor(challengeText(addrB, 'x'), addrA),
        (err) => err instanceof remit.ForeignAddressError
      )
    })
  } finally {
    await new Promise((resolve) => gw.server.close(resolve))
  }

  await test('home and menu expose 匯款 and the sign-in path', async () => {
    const root = path.join(__dirname, '..')
    const app = fs.readFileSync(path.join(root, 'src/js/app112.js'), 'utf8')
    const menu = fs.readFileSync(path.join(root, 'src/js/menu.js'), 'utf8')
    const cn = JSON.parse(fs.readFileSync(path.join(root, 'translations/CN.json'), 'utf8'))
    global.window = {}
    require(path.join(root, 'src/js/i18n112.js'))
    assert.ok(app.includes("['remit', 'tabRemit']"))
    assert.ok(app.includes('id="btnRemit"'))
    assert.ok(app.includes('id="btnRemitSign"'))
    assert.ok(app.includes('Remit.login'))
    assert.ok(app.includes('openRemittance'))
    assert.ok(!/kyc|passport|idNumber|身份證號/i.test(app.slice(app.indexOf('pageRemit'), app.indexOf('async function remitLogin'))))
    assert.ok(menu.includes('openRemittance()'))
    assert.strictEqual(cn.Remittance, '匯款')
    assert.strictEqual(global.window.I18N112.CN.tabRemit, '匯款')
    assert.ok(global.window.I18N112.CN.remitZero.includes('不需要填寫'))
    assert.ok(global.window.I18N112.CN.remitLead.includes('不是幣幣交易'))
  })

  await test('Windows NSIS build still ships the miner', async () => {
    const pkg = require('../package.json')
    const targets = pkg.build.win.target.map(t => t.target)
    assert.ok(targets.includes('nsis'), 'nsis target missing')
    const extra = pkg.build.win.extraResources
    assert.ok(extra.some(x => x.from === 'miner-bin/win32' && x.to === 'miner/bin'))
    assert.ok(extra.some(x => x.from === 'miner-bin/scdo-shard0-genesis.json'))
  })

  console.log(n + ' remit tests passed')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
