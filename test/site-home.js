// Marketing home matches scdo.com.au: five equal chain cards, live height text, no download row.
'use strict'
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const root = path.join(__dirname, '..')
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const home = require('../src/js/siteHome')
const siteNav = require('../src/js/siteNavMap')

const box = { window: {} }
vm.runInNewContext(read('src/js/i18n112.js'), box)
const CN = box.window.I18N112.CN
const EN = box.window.I18N112.EN
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const t = (pack) => (k) => pack[k] || k

const html = home.html({
  cells: [
    { n: 0, height: '181252', live: true },
    { n: 1, height: '9322209', live: true },
    { n: 2, height: '', live: false },
    { n: 3, height: '9306009', live: true },
    { n: 4, height: '9317127', live: true }
  ]
}, t(CN), esc)

assert.strictEqual((html.match(/class="mkt-shard"/g) || []).length, 5)
assert.ok(html.indexOf('data-chain="0"') < html.indexOf('data-chain="1"'))
assert.ok(html.indexOf('data-chain="1"') < html.indexOf('data-chain="2"'))
assert.ok(html.indexOf('data-chain="2"') < html.indexOf('data-chain="3"'))
assert.ok(html.indexOf('data-chain="3"') < html.indexOf('data-chain="4"'))
assert.ok(html.includes('#181,252'))
assert.ok(html.includes('#9,322,209'))
assert.ok(html.includes('#9,306,009'))
assert.ok(html.includes('#9,317,127'))
assert.ok(html.includes('\u2014'))
assert.ok(html.includes('mkt-dot on'))
assert.ok(html.includes(CN.mktH1a) && html.includes(CN.mktH1b))
assert.ok(html.includes(CN.mktChainsH))
assert.ok(html.includes('data-act="nav" data-v="wallet"'))
assert.ok(html.includes('data-act="nav" data-v="remit"'))
assert.ok(html.includes('data-act="site" data-v="membership"'))
assert.ok(html.includes('data-act="site" data-v="games"'))
assert.ok(html.includes('data-act="site" data-v="explorer"'))
assert.ok(html.includes('./assets/site/cat-mascot-680.webp'))
assert.ok(html.includes('./assets/site/cat-avatar.png'))
assert.ok(!/Windows|Mac |Android|Linux |下載/.test(html))
assert.ok(!html.includes('btn-row'))
assert.strictEqual(home.formatHeight('181252').text, '#181,252')
assert.strictEqual(home.formatHeight(null).dash, true)
assert.strictEqual(home.formatHeight('0').dash, true)
assert.strictEqual(home.formatHeight('\u2014').dash, true)
assert.strictEqual((home.shardsHtml([{ n: 0, height: '10', live: true }], t(EN), esc).match(/class="mkt-shard"/g) || []).length, 5)
assert.ok(home.shardsHtml([], t(EN), esc).includes(EN.mktLatest))
assert.ok(!/[\u3400-\u9fff]/.test(EN.mktH1a + EN.mktH1b + EN.mktSub + EN.mktChainsH + EN.mktDesk))

const app = read('src/js/app112.js')
const page = app.slice(app.indexOf('function pageHome'), app.indexOf('function renderFooter'))
const ret = page.slice(page.lastIndexOf('return `'))
assert.ok(ret.indexOf('siteMarketingHtml()') < ret.indexOf('id="homeDesk"'))
assert.ok(ret.indexOf('id="homeDesk"') < ret.indexOf('home-lead'))
assert.ok(!ret.includes('<details class="shell-fold" id="homeDesk" open'))
assert.ok(app.includes('opensOfficial'))
assert.ok(app.includes("a.indexOf('site:') === 0"))
assert.ok(read('src/js/menu.js').includes("act('site:' + it.id)"))
assert.ok(read('index.html').includes('src/js/siteHome.js'))
assert.ok(read('index.html').includes('src/css/siteHome.css'))

const official = ['gpu', 'wallets', 'games', 'treasury', 'explorer', 'blocks', 'txs', 'tokens', 'gas', 'mine', 'pool', 'nodes', 'launch', 'enterprise', 'membership', 'api', 'verify', 'start', 'blog', 'papers', 'docs', 'ip', 'bounty', 'agents', 'team', 'roadmap', 'partners', 'transparency', 'compliance', 'investors', 'walletSite']
for (const id of official) assert.strictEqual(siteNav.opensOfficial(siteNav.byId(id)), true, id)
for (const id of ['wallet', 'settings', 'create', 'import', 'connect', 'payInvoice', 'localNode']) {
  assert.strictEqual(siteNav.opensOfficial(siteNav.byId(id)), false, id)
}

console.log('site-home: ok')
