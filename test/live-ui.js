// Signed wallet-ui.json, renderer bundle verify/rollback, and the offline notice.
'use strict'
const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { signDoc, verifySigned, PUBKEY_B64 } = require('../src/config/uiSign')
const { PUBKEY_B64: UPDATER_KEY } = require('../src/updater')
const Ui = require('../src/js/walletUi')
const Bundle = require('../src/main/uiBundle')

assert.strictEqual(PUBKEY_B64, UPDATER_KEY)
assert.strictEqual(PUBKEY_B64, '4qt9g0KOI32agOxfEU+/W28zA8iRjt8pYSkcj/VTW5k=')
assert.deepStrictEqual(Ui.UI_URLS, [
  'https://apeccapital.org/wallet/wallet-ui.json',
  'https://scdo.com.au/wallet/wallet-ui.json'
])
assert.deepStrictEqual(Bundle.UI_LATEST_URLS, [
  'https://apeccapital.org/wallet/ui-latest.json',
  'https://scdo.com.au/wallet/ui-latest.json'
])
assert.strictEqual(Ui.REFRESH_MS, 30 * 60 * 1000)

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
const jwk = publicKey.export({ format: 'jwk' })
const pubB64 = Buffer.from(jwk.x, 'base64url').toString('base64')
const other = crypto.generateKeyPairSync('ed25519')
const otherB64 = Buffer.from(other.publicKey.export({ format: 'jwk' }).x, 'base64url').toString('base64')

function sign (doc) { return signDoc(doc, privateKey) }

const base = {
  v: 1,
  links: { hub: 'https://scdo.com.au/wallet/' },
  cards: [{ id: 'hub', en: 'Wallet hub', cn: '錢包總覽' }],
  strings: { en: { homeLead: 'Hello wallet' }, 'zh-Hant': { homeLead: '你好', relNotes: ['nope'], evil: '<b>x</b>' } },
  homeCards: [{
    id: 'news',
    title: { en: 'News', 'zh-Hant': '消息' },
    body: { en: 'This week', 'zh-Hant': '本週' },
    icon: 'news',
    cta: { en: 'Open', 'zh-Hant': '打開' },
    action: { type: 'open-page', page: 'news' }
  }],
  banner: { id: 'maint-1', en: 'Maintenance tonight.', 'zh-Hant': '今晚維護。' },
  flags: { inviteGift: false, payInvoice: true },
  minVersion: '3.1.9',
  recommendedVersion: '3.1.9'
}
const signed = sign(base)
assert.strictEqual(verifySigned(signed, { publicKey: pubB64 }).ok, true)
const accepted = Ui.acceptSigned(signed, { publicKey: pubB64 })
assert.ok(accepted)
assert.strictEqual(accepted.links.hub, 'https://scdo.com.au/wallet/')
assert.strictEqual(accepted.links.news, 'https://scdo.com.au/wallet/news/')
assert.strictEqual(accepted.strings.en.homeLead, 'Hello wallet')
assert.strictEqual(accepted.strings['zh-Hant'].homeLead, '你好')
assert.strictEqual(accepted.strings['zh-Hant'].relNotes, undefined)
assert.strictEqual(accepted.strings['zh-Hant'].evil, undefined)
assert.strictEqual(accepted.flags.inviteGift, false)
assert.strictEqual(Ui.flagOn(accepted, 'inviteGift'), false)
assert.strictEqual(Ui.flagOn(accepted, 'payInvoice'), true)
assert.strictEqual(Ui.flagOn(accepted, 'missingFlag'), true)
assert.strictEqual(accepted.banner.en, 'Maintenance tonight.')
assert.strictEqual(accepted.homeCards[0].action.type, 'open-page')
assert.strictEqual(Ui.versionNote(accepted, '3.1.8'), 'min')
assert.strictEqual(Ui.versionNote(Object.assign({}, accepted, { minVersion: '3.1.0', recommendedVersion: '9.0.0' }), '3.1.9'), 'rec')
assert.strictEqual(Ui.versionNote(accepted, '3.1.9'), '')
const html = Ui.homeCardsHtml(accepted, { lang: 'en', esc: s => String(s) })
assert.ok(html.includes('data-act="liveCard"') && html.includes('News') && !html.includes('https://'))
assert.ok(Ui.bannerHtml(accepted, { lang: 'zh-Hant', esc: s => String(s) }).includes('今晚維護'))

const tampered = JSON.parse(JSON.stringify(signed))
tampered.flags.inviteGift = true
assert.strictEqual(verifySigned(tampered, { publicKey: pubB64 }).ok, false)
assert.strictEqual(Ui.acceptSigned(tampered, { publicKey: pubB64 }), null)
assert.strictEqual(Ui.acceptSigned(signed, { publicKey: otherB64 }), null)
assert.strictEqual(Ui.acceptSigned('<!DOCTYPE html><html></html>', { publicKey: pubB64 }), null)
assert.strictEqual(Ui.acceptSigned({ v: 1, links: { hub: Ui.DEFAULT_HUB }, sig: 'nope' }, { publicKey: pubB64 }), null)
const missing = Object.assign({}, base)
delete missing.sig
assert.strictEqual(Ui.acceptSigned(missing, { publicKey: pubB64 }), null)

const evil = sign(Object.assign({}, base, { links: { hub: 'https://evil.example/wallet/' } }))
assert.strictEqual(Ui.acceptSigned(evil, { publicKey: pubB64 }), null)
const badAction = sign(Object.assign({}, base, {
  homeCards: [{
    id: 'x',
    title: { en: 'X', 'zh-Hant': '叉' },
    body: { en: 'Y', 'zh-Hant': '丫' },
    icon: 'news',
    cta: { en: 'Go', 'zh-Hant': '去' },
    action: { type: 'open-url', url: 'https://evil.example/phish' }
  }]
}))
assert.strictEqual(Ui.acceptSigned(badAction, { publicKey: pubB64 }), null)
const userinfo = sign(Object.assign({}, base, { links: { hub: 'https://user:pass@scdo.com.au/wallet/' } }))
assert.strictEqual(Ui.acceptSigned(userinfo, { publicKey: pubB64 }), null)
const plainHttp = sign(Object.assign({}, base, { links: { hub: 'http://scdo.com.au/wallet/' } }))
assert.strictEqual(Ui.acceptSigned(plainHttp, { publicKey: pubB64 }), null)

async function main () {
  let fetched = 0
  const quiet = await Ui.refresh({
    publicKey: pubB64,
    fetchImpl () { fetched++; return { v: 1, links: { hub: Ui.DEFAULT_HUB } } }
  })
  assert.strictEqual(quiet.from, 'default')
  assert.strictEqual(quiet.doc.links.hub, Ui.DEFAULT_HUB)
  assert.strictEqual(fetched, Ui.UI_URLS.length)

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-ui-'))
  const cache = path.join(dir, 'wallet-ui.json')
  const mirror = sign(Object.assign({}, base, { links: Ui.samePaths('https://apeccapital.org') }))
  const seen = []
  const live = await Ui.refresh({
    publicKey: pubB64,
    urls: Ui.UI_URLS,
    cacheFile: cache,
    fetchImpl (url) {
      seen.push(url)
      if (url.indexOf('apeccapital.org') >= 0) return '<html>wallet</html>'
      return mirror
    }
  })
  assert.deepStrictEqual(seen, Ui.UI_URLS)
  assert.strictEqual(live.from, 'https://scdo.com.au/wallet/wallet-ui.json')
  assert.strictEqual(live.doc.links.hub, 'https://apeccapital.org/wallet/hub/')
  const cached = JSON.parse(fs.readFileSync(cache, 'utf8'))
  assert.ok(cached.sig && !cached.signature)
  const again = await Ui.refresh({
    publicKey: pubB64,
    urls: ['https://down.example/wallet-ui.json'],
    cacheFile: cache,
    fetchImpl () { throw new Error('offline') }
  })
  assert.strictEqual(again.from, 'cache')
  assert.strictEqual(again.doc.links.agents, 'https://apeccapital.org/wallet/agents/')
  const raw = fs.readFileSync(cache, 'utf8').replace(cached.sig, 'AAAA')
  fs.writeFileSync(cache, raw)
  const dropped = await Ui.refresh({
    publicKey: pubB64,
    urls: ['https://down.example/wallet-ui.json'],
    cacheFile: cache,
    fetchImpl () { throw new Error('offline') }
  })
  assert.strictEqual(dropped.from, 'default')
  assert.strictEqual(dropped.doc.links.hub, Ui.DEFAULT_HUB)

  const shell = '3.1.9'
  const files = [
    { name: 'index.html', data: Buffer.from('<!doctype html><title>ui</title><script src="./app.js"></script>') },
    { name: 'app.js', data: Buffer.from('window.ok = true') },
    { name: 'manifest.json', data: Buffer.from(JSON.stringify({ version: '3.1.9-ui.1', minShellVersion: shell })) }
  ]
  const zip = Bundle.packZip(files)
  const latest = sign({
    v: 1,
    version: '3.1.9-ui.1',
    url: 'https://scdo.com.au/wallet/ui-bundle-3.1.9-ui.1.zip',
    sha256: Bundle.sha256(zip),
    minShellVersion: shell
  })
  assert.ok(Bundle.acceptLatest(latest, { publicKey: pubB64, shellVersion: shell }))
  assert.strictEqual(Bundle.acceptLatest(latest, { publicKey: pubB64, shellVersion: '3.1.8' }), null)
  const badHost = sign(Object.assign({}, latest, { url: 'https://scdoscan.io/wallet/ui-bundle-3.1.9-ui.1.zip', sig: undefined }))
  const badSigned = sign(Object.assign({}, latest, { url: 'https://scdoscan.io/wallet/ui-bundle-3.1.9-ui.1.zip' }))
  delete badHost.sig
  assert.strictEqual(Bundle.acceptLatest(badSigned, { publicKey: pubB64, shellVersion: shell }), null)
  const mismatch = sign(Object.assign({}, latest, { sha256: 'ab'.repeat(32) }))
  assert.ok(Bundle.acceptLatest(mismatch, { publicKey: pubB64, shellVersion: shell }))

  const userData = path.join(dir, 'user')
  const slipped = Bundle.packZip(files.concat([{ name: '../evil.js', data: Buffer.from('nope') }]))
  let slipThrew = false
  try { Bundle.unpackZip(slipped, path.join(dir, 'slip')) } catch (e) { slipThrew = true }
  assert.ok(slipThrew)
  assert.ok(!fs.existsSync(path.join(dir, 'evil.js')))

  const badSum = await Bundle.refresh({
    publicKey: pubB64,
    shellVersion: shell,
    userData: userData,
    urls: ['https://apeccapital.org/wallet/ui-latest.json'],
    fetchImpl () { return mismatch },
    downloadImpl () { return zip }
  })
  assert.ok(badSum.errors.some(e => e.indexOf('sha256') >= 0))
  assert.strictEqual(badSum.state.ready, false)

  const installed = await Bundle.refresh({
    publicKey: pubB64,
    shellVersion: shell,
    userData: userData,
    urls: Bundle.UI_LATEST_URLS,
    fetchImpl (url) {
      if (url.indexOf('apeccapital.org') >= 0) return '<html>'
      return latest
    },
    downloadImpl () { return zip }
  })
  assert.strictEqual(installed.state.ready, true)
  assert.strictEqual(installed.state.crashes, 0)
  assert.strictEqual(installed.from, 'https://scdo.com.au/wallet/ui-latest.json')
  assert.ok(fs.existsSync(path.join(installed.state.dir, 'index.html')))
  const skip = await Bundle.refresh({
    publicKey: pubB64,
    shellVersion: shell,
    userData: userData,
    urls: Bundle.UI_LATEST_URLS,
    fetchImpl () { return latest },
    downloadImpl () { throw new Error('should not download') }
  })
  assert.strictEqual(skip.skipped, true)

  let crashed = Bundle.noteCrash(installed.state, 'clean-exit')
  assert.strictEqual(crashed.rollback, false)
  assert.strictEqual(crashed.state.crashes, 0)
  crashed = Bundle.noteCrash(installed.state, 'crashed')
  assert.strictEqual(crashed.rollback, false)
  assert.strictEqual(crashed.state.crashes, 1)
  assert.strictEqual(crashed.state.ready, true)
  const rolled = Bundle.noteCrash(crashed.state, 'crashed')
  assert.strictEqual(rolled.rollback, true)
  assert.strictEqual(rolled.state.ready, false)
  assert.strictEqual(rolled.state.version, '')
  const failed = Bundle.noteLoadFail(installed.state)
  assert.strictEqual(failed.rollback, true)
  assert.strictEqual(failed.state.ready, false)

  const tooNew = sign({
    v: 1,
    version: '9.0.0-ui.1',
    url: 'https://apeccapital.org/wallet/ui-bundle-9.0.0-ui.1.zip',
    sha256: Bundle.sha256(zip),
    minShellVersion: '9.0.0'
  })
  const gated = await Bundle.refresh({
    publicKey: pubB64,
    shellVersion: shell,
    userData: path.join(dir, 'gated'),
    urls: ['https://apeccapital.org/wallet/ui-latest.json'],
    fetchImpl () { return tooNew },
    downloadImpl () { throw new Error('should not download') }
  })
  assert.strictEqual(gated.state.ready, false)

  const root = path.join(__dirname, '..')
  const mainSrc = fs.readFileSync(path.join(root, 'main.js'), 'utf8')
  const app = fs.readFileSync(path.join(root, 'src/js/app112.js'), 'utf8')
  const i18n = fs.readFileSync(path.join(root, 'src/js/i18n112.js'), 'utf8')
  assert.ok(mainSrc.includes('30 * 60 * 1000'))
  assert.ok(mainSrc.includes('uiHost'))
  assert.ok(mainSrc.includes('.unref()'))
  assert.ok(!mainSrc.includes('crashes = 0') || mainSrc.indexOf('did-finish-load') < 0)
  assert.ok(app.includes('offlineNotice'))
  assert.ok(app.includes('id="offlineNotice"'))
  assert.ok(app.includes('data-act="liveCard"') || app.includes('homeCardsHtml'))
  assert.ok(app.includes("typeof en[k] === 'string'") || app.includes('typeof en[k] === "string"'))
  assert.ok(i18n.includes("offlineNotice: '現在連不上網路。你可以繼續使用，餘額可能不是最新的。'"))
  assert.ok(i18n.includes("offlineNotice: 'The wallet cannot reach the network right now. You can keep using it. Balances may be out of date.'"))
  assert.ok(i18n.includes('uiMinNote:') && i18n.includes('uiRecNote:'))
  assert.ok(!/GPU|CPU|算力|mining/.test("現在連不上網路。你可以繼續使用，餘額可能不是最新的。The wallet cannot reach the network right now."))
  const tools = fs.readFileSync(path.join(root, 'tools/sign-ui-config.js'), 'utf8')
  assert.ok(tools.includes('refusing to sign with a key inside the repository'))
  assert.ok(!/BEGIN [A-Z ]*PRIVATE KEY/.test(tools + fs.readFileSync(path.join(root, 'tools/build-ui-bundle.js'), 'utf8')))
  console.log('live-ui: ok')
}

main().catch(e => { console.error(e); process.exit(1) })
