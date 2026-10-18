// No keystore account: say so, show an external payout from the chain, and drop evm.json entries on delete.
'use strict'
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const vm = require('vm')
const { forgetAccount } = require('../src/api/evmCache')
const empty = require('../src/js/emptyHome')
const chainHome = require('../src/js/chainHome')
const { fmtUnits } = require('../src/js/amount')

const root = path.join(__dirname, '..')
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8')
const PAY = '0x2d6F6ebc0000000000000000000000000000C956'
const OTHER = '0x1111111111111111111111111111111111111111'
const WEI595 = 595n * 10n ** 18n

const box = { window: {} }
vm.runInNewContext(read('src/js/i18n112.js'), box)
const CN = box.window.I18N112.CN
const EN = box.window.I18N112.EN
const t = (lang) => (k) => lang[k] || k
const esc = (s) => String(s == null ? '' : s)

assert.strictEqual(EN.emptyWallet, 'No wallet account yet: create or import')
assert.strictEqual(EN.emptyCreate, 'Create')
assert.strictEqual(EN.emptyImport, 'Import')
assert.strictEqual(EN.payoutExternal, 'Payout address (external)')
assert.strictEqual(EN.payoutNoKey, 'This wallet holds no key for it.')
assert.strictEqual(CN.emptyCreate, '建立')
assert.strictEqual(CN.emptyImport, '匯入')
assert.ok(CN.emptyWallet.includes('建立') && CN.emptyWallet.includes('匯入'))
assert.strictEqual(CN.payoutExternal, '記帳收款地址（外部）')
assert.ok(CN.payoutNoKey.includes('鑰匙'))
assert.strictEqual(CN.homeLineShard0, 'Shard0 EVM 記帳中')
assert.ok(EN.homeLineShard0.includes('Bookkeeping'))
assert.ok(!CN.homeLineShard0.includes('挖礦') && !/賬/.test(CN.homeLineShard0 + CN.emptyWallet + CN.payoutExternal))
assert.ok(!EN.homeLineShard0.toLowerCase().includes('mining'))
assert.ok(!CN.emptyWallet.includes('挖礦') && !CN.payoutExternal.includes('挖礦'))

const app = read('src/js/app112.js')
const langRow = app.slice(app.indexOf('const langNow'), app.indexOf('const resumeRow'))
assert.ok(langRow.includes('>English</button>') && langRow.includes('>華語</button>'))
assert.ok(!/中文|简体中文|簡體中文|繁體中文/.test(langRow))
assert.ok(!/selected\(\)\s*\./.test(app), 'every selected() caller must guard null before reading a field')
assert.ok(app.includes('window.SCDOEmptyHome'))
assert.ok(app.includes('refreshExternalPayout'))
assert.ok(app.includes('!st.accounts.length'))
assert.ok(read('index.html').includes('src/js/emptyHome.js'))
assert.ok(read('main.js').includes('evmCache'))
assert.ok(read('main.js').includes('forgetAccount'))
assert.ok(!/unlink|rmSync|rmdir/.test(read('src/api/evmCache.js')))

const none = chainHome.summarize({ n: 0, entries: [] })
assert.strictEqual(none.text, '\u2014')
const noneRow = chainHome.rowsHtml([{ n: 0, open: false, entries: [], txs: [] }], t(CN), esc)
assert.ok(noneRow.includes('\u2014'))
assert.ok(!noneRow.includes('0 SCDO'))

assert.strictEqual(empty.externalPayout({ minerReward: PAY, accounts: [] }).address, PAY)
assert.strictEqual(empty.externalPayout({ minerWallet: PAY, minerReward: 'nope', accounts: [] }).address, PAY)
assert.strictEqual(empty.externalPayout({ minerReward: PAY, accounts: [{ evm: PAY }] }), null)
assert.strictEqual(empty.externalPayout({ agentPayout: OTHER, minerReward: PAY, accounts: [{ evm: PAY }] }).address, OTHER)
assert.strictEqual(empty.externalPayout({ accounts: [] }), null)
assert.strictEqual(empty.balanceText(null, () => '0'), '\u2014')
assert.strictEqual(empty.balanceText(WEI595, (u) => fmtUnits(u, 18)), '595 SCDO')

const page = empty.html(t(EN), esc, { payout: { address: PAY, units: WEI595 }, fmt: (u) => fmtUnits(u, 18) })
assert.ok(page.includes('id="emptyWallet"'))
assert.ok(page.includes('No wallet account yet: create or import'))
assert.ok(page.includes('id="emptyCreate"') && page.includes('data-act="create"') && page.includes('>Create<'))
assert.ok(page.includes('id="emptyImport"') && page.includes('data-act="import"') && page.includes('>Import<'))
assert.ok(page.includes('Payout address (external)'))
assert.ok(page.includes(PAY))
assert.ok(page.includes('595 SCDO'))
assert.ok(page.includes('This wallet holds no key for it.'))
assert.ok(page.includes('data-readonly="1"'))
assert.ok(!/<input\b/.test(page))
assert.ok(!page.includes('0 SCDO'))

const waiting = empty.html(t(EN), esc, { payout: { address: PAY, units: null }, fmt: (u) => fmtUnits(u, 18) })
assert.ok(waiting.includes('\u2014'))
assert.ok(!waiting.includes('0 SCDO'))
const bare = empty.html(t(CN), esc, {})
assert.ok(bare.includes('id="emptyWallet"') && !bare.includes('id="extPayout"'))
assert.ok(!bare.includes('0 SCDO'))

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scdo-evm-'))
const cache = path.join(dir, 'evm.json')
const keyFile = path.join(dir, 'keep.me.key')
const gone = 'deleted.account.1'
const stay = 'still.here.2'
fs.writeFileSync(keyFile, 'key-bytes')
fs.writeFileSync(cache, JSON.stringify({
  [gone]: { evm: PAY, addrTail: 'aa' },
  [stay]: { evm: OTHER, addrTail: 'bb' }
}, null, 2))
const before = fs.readFileSync(cache)
const dropped = forgetAccount(cache, gone, { now: 1710000000000 })
assert.strictEqual(dropped.ok, true)
assert.strictEqual(dropped.removed, true)
assert.strictEqual(dropped.backup, cache + '.bak-1710000000000')
assert.deepStrictEqual(fs.readFileSync(dropped.backup), before)
const left = JSON.parse(fs.readFileSync(cache, 'utf8'))
assert.ok(!left[gone])
assert.strictEqual(left[stay].evm, OTHER)
assert.strictEqual(fs.readFileSync(keyFile, 'utf8'), 'key-bytes')
const again = forgetAccount(cache, gone, { now: 1710000000001 })
assert.strictEqual(again.removed, false)
assert.strictEqual(again.backup, '')
assert.ok(!fs.existsSync(cache + '.bak-1710000000001'))
const bad = forgetAccount(cache, '../evil', { now: 1 })
assert.strictEqual(bad.ok, false)
assert.strictEqual(left[stay].evm, JSON.parse(fs.readFileSync(cache, 'utf8'))[stay].evm)
fs.rmSync(dir, { recursive: true, force: true })

console.log('empty-wallet: ok')
