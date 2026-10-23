// Official scdo.com.au pages stay in the panel. Installer files do not open anywhere.
'use strict'
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const Ui = require('../src/js/walletUi')
const Panel = require('../src/main/walletPanel')

const root = path.join(__dirname, '..')
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8')

assert.strictEqual(Ui.browseDecision('https://scdo.com.au/gpu-share/?lang=zh').action, 'allow')
assert.strictEqual(Ui.browseDecision('https://scdo.com.au/games/').action, 'allow')
assert.strictEqual(Ui.browseDecision('https://scdo.com.au/treasury/').action, 'allow')
assert.strictEqual(Ui.browseDecision('https://apeccapital.org/wallet/help/').action, 'allow')
assert.strictEqual(Ui.browseDecision('https://scdo.com.au/downloads/wallet/').action, 'allow')
assert.strictEqual(Ui.browseDecision('https://scdo.com.au/gpu-share/download?ref=site').action, 'suppress')
assert.strictEqual(Ui.browseDecision('https://scdo.com.au/gpu-share/download?ref=site&f=exe').action, 'suppress')
assert.strictEqual(Ui.browseDecision('https://scdo.com.au/downloads/wallet/SCDOWallet-3.1.15-win-x64-setup.exe').action, 'suppress')
assert.strictEqual(Ui.browseDecision('https://scdo.com.au/downloads/gpu-share/scdo-gpu-share-worker-1.2.4-win-x64.zip').action, 'suppress')
assert.strictEqual(Ui.browseDecision('https://scdo.com.au/downloads/wallet/mac/SCDO.dmg').action, 'suppress')
assert.strictEqual(Ui.isInstallerAsset('https://scdo.com.au/downloads/wallet/linux/SCDO.AppImage'), true)
assert.strictEqual(Ui.isInstallerAsset('/gpu-share/download?ref=site'), true)
assert.strictEqual(Ui.isInstallerAsset('https://scdo.com.au/gpu-share/'), false)
assert.strictEqual(Ui.browseDecision('https://t.me/SCDOLabor').action, 'external')
assert.strictEqual(Ui.browseDecision('https://example.com/file.exe').action, 'external')

const chrome = Panel.PANEL_CHROME_CSS
for (const sel of ['header.wnav', 'header.topbar', '#scdo-gnav', '#scdo-mnav', '.download-wrap', '#cta-zip', '#cta-exe', 'a.dl-btn', '#dl-desktop', '#scdo-wallet-download', '.fe-box', 'a.wd-back', 'a[href*="/gpu-share/download"]', 'a[href*="/downloads/"]', 'max-width:none!important']) {
  assert.ok(chrome.includes(sel), sel)
}
assert.ok(!chrome.includes('div.topbar') && !chrome.includes('header.hero') && !chrome.includes('nav.toc'))
assert.ok(Panel.PANEL_BRIDGE.includes('in-scdo-app') && Panel.PANEL_BRIDGE.includes('MutationObserver') && Panel.PANEL_BRIDGE.includes('scdoInstaller'))
assert.ok(!Panel.PANEL_BRIDGE.includes('ipc') && !Panel.PANEL_BRIDGE.includes('keystore'))

const main = read('main.js')
const app = read('src/js/app112.js')
const preload = read('preload.js')
assert.ok(main.includes('browseDecision') && main.includes("webContents.send('site:open'"))
assert.ok(!/EXTERNAL_ALLOW = \[[^\]]*scdo\\.com\\.au/.test(main))
assert.ok(!/EXTERNAL_ALLOW = \[[^\]]*apeccapital\\.org/.test(main))
assert.ok(main.includes('scdoscan\\.io') && main.includes('gitbook'))
assert.ok(preload.includes("'site:open'"))
assert.ok(app.includes('openOfficialPage') && app.includes('browseDecision'))
assert.ok(app.includes("st.tab === 'home' || st.tab === 'panel' ? '' : backHome()"))
assert.ok(app.includes("classList.toggle('on-panel', st.tab === 'panel')"))
assert.ok(read('src/css/siteHome.css').includes('body.on-panel .site-bar { display: none !important; }'))
assert.ok(read('src/css/shell310.css').includes('.page.shell-panel { max-width: none !important;'))
assert.ok(!read('src/js/index.js').includes('shell.openExternal("https://scdo.com.au'))
assert.ok(read('index.html').includes('src/js/payRequest.js'))

const events = {}
const wc = {
  on (name, fn) { (events[name] = events[name] || []).push(fn) },
  setWindowOpenHandler (fn) { wc.open = fn },
  executeJavaScript () { return Promise.resolve(true) },
  getURL () { return '' },
  insertCSS (css) { wc.css = css; return Promise.resolve('k') }
}
const seen = []
Panel.bindGuest(wc, {
  protocol () {},
  external (u) { seen.push(u) },
  navigate (u) { seen.push(['nav', u]) },
  currentUrl () { return 'https://scdo.com.au/gpu-share/?lang=zh' }
})
events['dom-ready'][0]()
assert.strictEqual(wc.css, Panel.PANEL_CHROME_CSS)
const blocked = { preventDefault () { blocked.stopped = true } }
events['will-navigate'][0](blocked, 'https://scdo.com.au/gpu-share/download?ref=site')
assert.ok(blocked.stopped)
assert.deepStrictEqual(seen, [])
assert.strictEqual(wc.open({ url: 'https://scdo.com.au/downloads/wallet/SCDO.dmg' }).action, 'deny')
assert.deepStrictEqual(seen, [])

console.log('in-app-official: ok')
