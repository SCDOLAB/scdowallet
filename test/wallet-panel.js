// In-app panel: allowlist, signed wallet-ui.json, and scdowallet:// interception.
'use strict'
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const vm = require('vm')
const Module = require('module')
const crypto = require('crypto')
const { signDoc } = require('../src/config/uiSign')
const Ui = require('../src/js/walletUi')
const Panel = require('../src/main/walletPanel')

const root = path.join(__dirname, '..')
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8')
const HUB = 'https://scdo.com.au/wallet/hub/'

assert.strictEqual(Ui.DEFAULT_HUB, HUB)
assert.strictEqual(Ui.defaults().links.hub, HUB)
for (const [id, p] of Object.entries(Ui.PAGE_PATHS)) {
  assert.strictEqual(Ui.defaults().links[id], 'https://scdo.com.au' + p, id)
}
assert.deepStrictEqual(Ui.samePaths('https://apeccapital.org'), {
  hub: 'https://apeccapital.org/wallet/hub/',
  news: 'https://apeccapital.org/wallet/news/',
  events: 'https://apeccapital.org/wallet/events/',
  invite: 'https://apeccapital.org/wallet/invite/',
  agents: 'https://apeccapital.org/wallet/agents/',
  pool: 'https://apeccapital.org/wallet/pool/',
  help: 'https://apeccapital.org/wallet/help/',
  connect: 'https://apeccapital.org/wallet/connect/'
})
assert.deepStrictEqual(Ui.UI_URLS, [
  'https://apeccapital.org/wallet/wallet-ui.json',
  'https://scdo.com.au/wallet/wallet-ui.json'
])
assert.deepStrictEqual(Ui.HOSTS, ['scdo.com.au', 'apeccapital.org'])

assert.strictEqual(Ui.classifyNavigation('https://scdo.com.au/wallet/news/').action, 'allow')
assert.strictEqual(Ui.classifyNavigation('https://apeccapital.org/wallet/help/').action, 'allow')
assert.strictEqual(Ui.classifyNavigation('https://scdo.com.au/wallet/').action, 'allow')
assert.strictEqual(Ui.classifyNavigation('scdowallet://agent/start').action, 'protocol')
assert.strictEqual(Ui.classifyNavigation('scdowallet://invite/create').action, 'protocol')
assert.strictEqual(Ui.classifyNavigation('scdowallet://join?ref=ab&src=wallet').action, 'protocol')
assert.strictEqual(Ui.classifyNavigation('scdowallet://invite?s=abc&c=0x1&n=5680').action, 'protocol')
assert.strictEqual(Ui.classifyNavigation('https://example.com/out').action, 'external')
assert.strictEqual(Ui.classifyNavigation('https://scdo.com.au.evil.com/wallet/').action, 'external')
assert.strictEqual(Ui.classifyNavigation('https://www.scdo.com.au/wallet/').action, 'external')
assert.strictEqual(Ui.classifyNavigation('https://user:pass@scdo.com.au/wallet/').action, 'drop')
assert.strictEqual(Ui.classifyNavigation('http://scdo.com.au/wallet/hub/').action, 'drop')
assert.strictEqual(Ui.classifyNavigation('https://scdo.com.au:444/wallet/').action, 'drop')
assert.strictEqual(Ui.classifyNavigation('javascript:alert(1)').action, 'drop')
assert.strictEqual(Ui.classifyNavigation('file:///etc/passwd').action, 'drop')
assert.strictEqual(Ui.classifyNavigation('tg://resolve?domain=scdowallet').action, 'external')
assert.strictEqual(Ui.classifyNavigation('tg://resolve?domain=scdowallet').href, 'tg://resolve?domain=scdowallet')
assert.strictEqual(Ui.classifyNavigation('TG://msg?text=hi').href, 'tg://msg?text=hi')
assert.strictEqual(Ui.classifyNavigation('tg:resolve?domain=x').action, 'drop')
assert.strictEqual(Ui.classifyNavigation('tg://user:pass@resolve').action, 'drop')
assert.strictEqual(Ui.classifyNavigation('tg://').action, 'drop')
assert.strictEqual(Ui.classifyNavigation('ton://transfer/EQ').action, 'drop')
assert.strictEqual(Ui.withPanelLang(Ui.defaults().links.connect, 'EN'), 'https://scdo.com.au/wallet/connect/?lang=en')
assert.strictEqual(Ui.withPanelLang(Ui.samePaths('https://apeccapital.org').connect, 'zh-Hant'), 'https://apeccapital.org/wallet/connect/?lang=zh')
assert.ok(!Ui.defaults().cards.some(c => c.id === 'connect'))

const ban = /挖礦|算力|mining|GPU|CPU|主鏈|RPC|cuda/i
for (const c of Ui.defaults().cards) {
  assert.ok(!ban.test(c.en + c.cn), c.id)
  assert.ok(c.en !== 'Pool' && c.cn !== '挖礦')
}
assert.ok(Ui.defaults().cards.some(c => c.en === 'Bookkeeping pool' && c.cn === '記帳池'))
const html = Ui.cardsHtml(Ui.defaults(), { title: 'Wallet hub', lang: 'en', esc: (s) => String(s) })
assert.ok(html.includes('data-act="panelOpen" data-v="hub"'))
assert.ok(html.includes('data-v="news"') && html.includes('Bookkeeping pool') && html.includes('Help'))
assert.ok(!html.includes('https://') && !ban.test(html))
const cnHtml = Ui.cardsHtml(Ui.defaults(), { title: '錢包總覽', lang: 'cn', esc: (s) => String(s) })
assert.ok(cnHtml.includes('記帳池') && cnHtml.includes('消息') && cnHtml.includes('說明'))

assert.strictEqual(Panel.GUEST_PREFS.sandbox, true)
assert.strictEqual(Panel.GUEST_PREFS.contextIsolation, true)
assert.strictEqual(Panel.GUEST_PREFS.nodeIntegration, false)
assert.strictEqual(Panel.GUEST_PREFS.nodeIntegrationInSubFrames, false)
assert.ok(!Object.prototype.hasOwnProperty.call(Panel.GUEST_PREFS, 'preload'))
assert.ok(!read('src/main/walletPanel.js').includes('preload:'))
const bridge = Panel.PANEL_BRIDGE
assert.ok(bridge.includes('data-s') && bridge.includes('scdowallet:') && bridge.includes('location.href'))
assert.ok(!bridge.includes('ipc') && !bridge.includes('keystore'))

const events = {}
const wc = {
  on (name, fn) { (events[name] = events[name] || []).push(fn) },
  setWindowOpenHandler (fn) { wc.open = fn },
  executeJavaScript (code) { wc.code = code; return Promise.resolve(true) }
}
const seen = []
Panel.bindGuest(wc, {
  protocol (u) { seen.push(['protocol', u]) },
  external (u) { seen.push(['external', u]) },
  navigate (u) { seen.push(['navigate', u]) }
})
function fire (url) {
  const ev = { preventDefault () { ev.stopped = true } }
  events['will-navigate'][0](ev, url)
  return ev
}
const start = fire('scdowallet://agent/start')
assert.ok(start.stopped)
assert.deepStrictEqual(seen[0], ['protocol', 'scdowallet://agent/start'])
const again = fire('scdowallet://agent/start')
assert.ok(again.stopped)
assert.strictEqual(seen.length, 1)
const out = fire('https://t.me/SCDOLabor')
assert.ok(out.stopped)
assert.deepStrictEqual(seen[1], ['external', 'https://t.me/SCDOLabor'])
const stay = fire('https://scdo.com.au/wallet/events/')
assert.ok(stay.stopped)
assert.deepStrictEqual(seen[2], ['navigate', 'https://scdo.com.au/wallet/events/?lang=zh'])
const tagged = fire('https://scdo.com.au/wallet/events/?lang=zh')
assert.ok(!tagged.stopped)
const kept = Ui.withPanelLang('https://scdo.com.au/wallet/news/?a=1#top', 'zh-Hant')
assert.strictEqual(kept, 'https://scdo.com.au/wallet/news/?a=1&lang=zh#top')
assert.strictEqual(Ui.withPanelLang('https://scdo.com.au/wallet/hub/?lang=en#x', 'EN'), 'https://scdo.com.au/wallet/hub/?lang=en#x')
assert.strictEqual(Ui.withPanelLang('https://apeccapital.org/wallet/help/?lang=en#x', 'CN'), 'https://apeccapital.org/wallet/help/?lang=zh#x')
assert.strictEqual(Ui.panelQueryLang('zh-TW'), 'zh')
assert.strictEqual(Ui.panelQueryLang('zh-CN'), 'zh')
assert.strictEqual(Ui.panelQueryLang('zh-Hant'), 'zh')
assert.strictEqual(Ui.panelQueryLang('en-US'), 'en')
const frame = { isMainFrame: false, url: 'https://evil.example/x', preventDefault () { frame.stopped = true } }
events['will-frame-navigate'][0](frame)
assert.ok(frame.stopped)
assert.strictEqual(wc.open({ url: 'scdowallet://invite/create' }).action, 'deny')
assert.ok(seen.some(row => row[0] === 'protocol' && row[1] === 'scdowallet://invite/create'))
assert.strictEqual(wc.open({ url: 'https://scdo.com.au/wallet/pool/' }).action, 'deny')
assert.ok(seen.some(row => row[0] === 'navigate' && row[1] === 'https://scdo.com.au/wallet/pool/?lang=zh'))
events['dom-ready'][0]()
assert.strictEqual(wc.code, Panel.PANEL_BRIDGE)

const box = { window: {}, document: { addEventListener (type, fn) { box.fn = fn } } }
box.window = box
let href = ''
Object.defineProperty(box, 'location', { value: { set href (v) { href = v }, get href () { return href } } })
vm.runInNewContext(Panel.PANEL_BRIDGE, box)
const node = { getAttribute (n) { return n === 'data-s' ? 'scdowallet://invite/create' : '' }, parentNode: null }
const click = { target: node, preventDefault () { click.stopped = true }, stopImmediatePropagation () { click.cut = true } }
box.fn(click)
assert.strictEqual(href, 'scdowallet://invite/create')
assert.ok(click.stopped && click.cut)
href = ''
const plain = { getAttribute () { return '' }, parentNode: null }
box.fn({ target: plain, preventDefault () { plain.stopped = true }, stopImmediatePropagation () {} })
assert.strictEqual(href, '')

const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')
const pubB64 = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url').toString('base64')
const otherKey = crypto.generateKeyPairSync('ed25519').publicKey
const otherB64 = Buffer.from(otherKey.export({ format: 'jwk' }).x, 'base64url').toString('base64')
function sign (doc) { return signDoc(doc, privateKey) }

async function main () {
  const moved = sign({ v: 1, links: { hub: 'https://scdo.com.au/wallet/' }, cards: [{ id: 'hub', en: 'Wallet hub', cn: '錢包總覽' }] })
  const accepted = Ui.acceptSigned(moved, { publicKey: pubB64 })
  assert.ok(accepted)
  assert.strictEqual(accepted.links.hub, 'https://scdo.com.au/wallet/')
  assert.strictEqual(accepted.links.news, 'https://scdo.com.au/wallet/news/')
  assert.strictEqual(accepted.links.pool, 'https://scdo.com.au/wallet/pool/')
  assert.strictEqual(Ui.acceptSigned(moved, { publicKey: otherB64 }), null)
  assert.strictEqual(Ui.acceptSigned('<!DOCTYPE html><html></html>', { publicKey: pubB64 }), null)
  assert.strictEqual(Ui.acceptSigned({ v: 1, links: { hub: HUB }, cards: [], sig: 'nope' }, { publicKey: pubB64 }), null)
  const evil = sign({ v: 1, links: { hub: 'https://evil.example/wallet/' }, cards: [{ id: 'hub', en: 'Wallet hub', cn: '錢包總覽' }] })
  assert.strictEqual(Ui.acceptSigned(evil, { publicKey: pubB64 }), null)
  const mirror = sign({ v: 1, links: Ui.samePaths('https://apeccapital.org'), cards: Ui.defaults().cards })
  const mirrored = Ui.acceptSigned(mirror, { publicKey: pubB64 })
  assert.strictEqual(mirrored.links.hub, 'https://apeccapital.org/wallet/hub/')
  assert.strictEqual(mirrored.links.help, 'https://apeccapital.org/wallet/help/')
  assert.strictEqual(mirrored.links.connect, 'https://apeccapital.org/wallet/connect/')
  const bare = sign({ v: 1, links: { hub: HUB }, cards: [{ id: 'hub', en: 'Wallet hub', cn: '錢包總覽' }] })
  const bareDoc = Ui.acceptSigned(bare, { publicKey: pubB64 })
  assert.strictEqual(bareDoc.links.connect, 'https://scdo.com.au/wallet/connect/')
  const custom = sign({ v: 1, links: { hub: HUB, connect: 'https://apeccapital.org/wallet/connect/' }, cards: [{ id: 'hub', en: 'Wallet hub', cn: '錢包總覽' }] })
  const customDoc = Ui.acceptSigned(custom, { publicKey: pubB64 })
  assert.strictEqual(customDoc.links.connect, 'https://apeccapital.org/wallet/connect/')
  const offHost = sign({ v: 1, links: { hub: HUB, connect: 'https://evil.example/wallet/connect/' }, cards: [{ id: 'hub', en: 'Wallet hub', cn: '錢包總覽' }] })
  assert.strictEqual(Ui.acceptSigned(offHost, { publicKey: pubB64 }), null)

  let fetched = 0
  const quiet = await Ui.refresh({ publicKey: pubB64, fetchImpl () { fetched++; return '' } })
  assert.strictEqual(quiet.from, 'default')
  assert.strictEqual(quiet.doc.links.hub, HUB)
  assert.strictEqual(fetched, Ui.UI_URLS.length)

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wallet-ui-'))
  const cache = path.join(dir, 'wallet-ui.json')
  const live = await Ui.refresh({
    publicKey: pubB64,
    urls: Ui.UI_URLS,
    cacheFile: cache,
    fetchImpl (url) {
      if (url.indexOf('apeccapital.org') >= 0) return '<html>wallet</html>'
      return mirror
    }
  })
  assert.strictEqual(live.from, 'https://scdo.com.au/wallet/wallet-ui.json')
  assert.strictEqual(live.doc.links.hub, 'https://apeccapital.org/wallet/hub/')
  const cached = JSON.parse(fs.readFileSync(cache, 'utf8'))
  assert.ok(cached.sig)
  const againDoc = await Ui.refresh({
    publicKey: pubB64,
    urls: ['https://down.example/wallet-ui.json'],
    cacheFile: cache,
    fetchImpl () { throw new Error('offline') }
  })
  assert.strictEqual(againDoc.from, 'cache')
  assert.strictEqual(againDoc.doc.links.agents, 'https://apeccapital.org/wallet/agents/')

  const realLoad = Module._load
  Module._load = function (req, parent, ...rest) {
    if (req === 'electron') return { Menu: { buildFromTemplate: (t) => t, setApplicationMenu () {} }, shell: {} }
    return realLoad.call(this, req, parent, ...rest)
  }
  const menu = require('../src/js/menu.js')
  Module._load = realLoad
  const sent = []
  const win = { isDestroyed () { return false }, webContents: { send (ch, a) { sent.push([ch, a]) } } }
  Ui.setCurrent(Ui.defaults())
  const template = menu.buildTemplate(win, 'EN')
  const hub = template.find(m => m.label === 'Wallet hub')
  assert.ok(hub && hub.submenu)
  const pool = hub.submenu.find(m => m.label === 'Bookkeeping pool')
  assert.ok(pool)
  pool.click()
  assert.deepStrictEqual(sent, [['menu:action', 'panel:pool']])
  const cn = menu.buildTemplate(win, 'CN')
  assert.ok(cn.some(m => m.label === '錢包總覽'))

  const mainSrc = read('main.js')
  const app = read('src/js/app112.js')
  const preload = read('preload.js')
  const index = read('index.html')
  assert.ok(mainSrc.includes('startWalletPanel'))
  assert.ok(mainSrc.includes('wallet-panel'))
  assert.ok(app.includes('panel:show') && app.includes("data-act=\"panelOpen\"") === false)
  assert.ok(app.includes('openPanel(') && app.includes('panelCardsHtml'))
  assert.ok(preload.includes("'panel:show'") && preload.includes("'panel:close'") && preload.includes("'panel:doc'"))
  assert.ok(index.includes('src/js/walletUi.js'))
  assert.ok(read('src/js/i18n112.js').includes("panelSection: 'Wallet hub'"))
  assert.ok(read('src/js/i18n112.js').includes("panelSection: '錢包總覽'"))
  assert.ok(read('src/js/i18n112.js').includes("navConnect: 'Connected wallets & agents'"))
  assert.ok(read('src/js/i18n112.js').includes("navConnect: '連接錢包與 Agent'"))
  assert.ok(app.includes("['connect', 'navConnect']") && app.includes("openPanel('connect')") && app.includes("T('navConnect')"))
  const native = ['src/js/app112.js', 'src/js/i18n112.js', 'src/js/walletUi.js', 'src/js/menu.js', 'src/js/siteNavMap.js', 'src/main/walletPanel.js', 'index.html'].map(read).join('\n')
  for (const name of ['Telegram Wallet', 'X Money', 'Grok']) assert.ok(!native.includes(name), name)

  const opened = []
  const handlers = {}
  const contents = {
    on (name, fn) { (handlers[name] = handlers[name] || []).push(fn) },
    setWindowOpenHandler (fn) { contents.open = fn },
    executeJavaScript () { return Promise.resolve(true) },
    loadURL (url) { contents.loaded = url },
    isDestroyed () { return false },
    session: { setPermissionRequestHandler () {} }
  }
  function View () {
    return { webContents: contents, setVisible () {}, setBounds () {} }
  }
  const panelWin = {
    isDestroyed () { return false },
    getContentSize () { return [1280, 900] },
    contentView: { addChildView () {}, removeChildView () {} },
    setBrowserView () {}
  }
  let panelLang = 'EN'
  Module._load = function (req, parent, ...rest) {
    if (req === 'electron') return { shell: { openExternal (u) { opened.push(u) } }, WebContentsView: View, BrowserView: View }
    return realLoad.call(this, req, parent, ...rest)
  }
  const panel = Panel.create({
    shell: { openExternal (u) { opened.push(u) } },
    getWindow () { return panelWin },
    getLang () { return panelLang }
  })
  Module._load = realLoad
  Ui.setCurrent(Ui.defaults())
  const shown = panel.show({ id: 'connect', x: 12, y: 24, width: 640, height: 480 })
  assert.strictEqual(shown.ok, true)
  assert.strictEqual(shown.url, 'https://scdo.com.au/wallet/connect/?lang=en')
  assert.strictEqual(contents.loaded, shown.url)
  panelLang = 'CN'
  const fallback = Ui.defaults()
  fallback.links = Object.assign({}, fallback.links, { connect: 'https://apeccapital.org/wallet/connect/' })
  Ui.setCurrent(fallback)
  const mirroredShow = panel.show({ id: 'connect', x: 12, y: 24, width: 640, height: 480 })
  assert.strictEqual(mirroredShow.url, 'https://apeccapital.org/wallet/connect/?lang=zh')
  function navigate (url) {
    const ev = { preventDefault () { ev.stopped = true } }
    handlers['will-navigate'][0](ev, url)
    return ev
  }
  navigate('https://example.com/out')
  navigate('tg://resolve?domain=scdowallet')
  assert.deepStrictEqual(opened, ['https://example.com/out', 'tg://resolve?domain=scdowallet'])
  const before = opened.length
  navigate('javascript:alert(1)')
  navigate('file:///etc/passwd')
  navigate('http://example.com/x')
  navigate('ton://transfer/EQ')
  navigate('tg:resolve?domain=x')
  navigate('https://scdo.com.au/wallet/connect/')
  assert.strictEqual(opened.length, before)
  assert.strictEqual(contents.open({ url: 'tg://msg?text=hi' }).action, 'deny')
  assert.ok(opened.includes('tg://msg?text=hi'))
  assert.strictEqual(contents.open({ url: 'ton://transfer/EQ' }).action, 'deny')
  assert.ok(!opened.includes('ton://transfer/EQ'))
  console.log('wallet-panel: ok')
}

main().catch(e => { console.error(e); process.exit(1) })
