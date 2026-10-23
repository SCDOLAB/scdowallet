// Home page only (3.1.15): agent card, heights, one balances area, membership open, invite card.
'use strict'
const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const root = path.join(__dirname, '..')
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const app = read('src/js/app112.js')
const main = read('main.js')
const Join = require('../src/js/agentJoin')
const siteNav = require('../src/js/siteNavMap')
const zpow = require('../src/miner/zpow/address')
const keystore = require('../src/api/keystore')
const links = require('../src/js/demoLinks')

const ADDR = '0x' + 'cd'.repeat(20)
const labels = {
  copy: 'Copy',
  agentCardTitle: 'Local SCDO bookkeeping agent',
  agentStatus: 'Status', agentOnline: 'Online', agentOffline: 'Offline', agentNotStarted: 'Not started', agentStarting: 'Starting…',
  agentHomeOnline: 'Bookkeeping agent online. Keep SCDO Wallet open so bookkeeping stays connected.',
  agentHomeOffline: 'Bookkeeping agent offline. Open SCDO Wallet so bookkeeping can connect.',
  agentScdoAddr: 'Classic shard address',
  agentX402: 'x402 prep addresses',
  agentX402Pending: 'Not assigned yet. It is filled in when the bookkeeping agent is online.',
  agentStartBook: 'Start bookkeeping',
  agentEntries: 'Latest ledger entries',
  agentEntriesEmpty: 'No ledger entries yet',
  agentAct_task_join: 'Joined',
  agentOutcome_done: 'done',
  mineShardN: 'Shard{n}'
}
const t = (k, p) => {
  let s = labels[k] || k
  if (p) s = s.replace(/\{(\w+)\}/g, (m, name) => p[name] != null ? p[name] : m)
  return s
}
const esc = (s) => String(s == null ? '' : s)

const priv = crypto.randomBytes(32).toString('hex')
const on1 = keystore.scdoAddressFromPriv(priv, 1)
for (const n of [1, 2, 3, 4]) {
  assert.strictEqual(zpow.classicOnShard(on1, n), keystore.scdoAddressFromPriv(priv, n))
  assert.strictEqual(zpow.classicOnShard(on1, n).slice(0, 4), n + 'S0' + n)
}
assert.strictEqual(zpow.classicOnShard(on1, 0), null)
assert.strictEqual(zpow.classicOnShard('not-an-address', 1), null)

const classic = '1S01' + on1.slice(4)
const card = Join.agentCardHtml(t, esc, {
  status: 'online',
  scdoAddress: classic,
  shard: 2,
  canSwitchShard: true,
  x402Reserve: '',
  entries: []
})
assert.ok(card.includes('Local SCDO bookkeeping agent'))
assert.ok(card.includes('Bookkeeping agent online. Keep SCDO Wallet open so bookkeeping stays connected.'))
assert.ok(card.includes('data-act="copy"') && card.includes('data-v="' + classic + '"'))
assert.ok(card.includes('data-act="agentShard" data-v="1"'))
assert.ok(card.includes('data-act="agentShard" data-v="4"'))
assert.ok(card.includes('class="agent-shard on"') && card.includes('data-v="2"'))
assert.ok(card.includes('Shard2'))
assert.ok(!card.includes('id="agentBook"'))
assert.ok(!card.includes('No ledger entries yet'))
assert.ok(!card.includes('agentEntriesEmpty'))
assert.ok(card.includes('id="agentBookBtn" data-act="isleStart"'))
assert.ok(card.includes('Not assigned yet. It is filled in when the bookkeeping agent is online.'))
assert.ok(!card.includes('>Base<') && !card.includes('<span>Base</span>'))

const withRows = Join.agentCardHtml(t, esc, {
  status: 'online',
  scdoAddress: classic,
  canSwitchShard: true,
  shard: 1,
  x402Reserve: ADDR,
  externalHtml: '<section class="ext-payout" id="extPayout">once</section>',
  entries: [{ text: 'Joined · done', action: 'task:join', outcome: 'done' }]
})
assert.strictEqual(withRows.split('id="extPayout"').length - 1, 1)
assert.ok(withRows.includes('<span>Base</span>'))
assert.ok(withRows.includes('class="mono" id="agentX402">' + ADDR + '<'))
assert.ok(withRows.includes('data-act="copy" data-v="' + ADDR + '"'))
assert.ok(!/BSC|BNB|Polygon/i.test(withRows))
assert.ok(withRows.includes('Latest ledger entries'))
assert.ok(withRows.includes('Joined · done'))
const first = Join.firstRunHtml(t, esc, {})
assert.ok(!first.includes('id="extPayout"'))
assert.ok(!first.includes('data-act="agentShard"'))

assert.strictEqual(links.TELEGRAM_URL, 'https://t.me/SCDOCommunity')
assert.ok(main.includes('https://t.me/SCDOLabor') && main.includes('https://t.me/SCDOCommunity'))
assert.ok(!main.includes('scdowheelledger'))
assert.ok(main.includes('/^https:\\/\\/scdo\\.com\\.au(\\/|$)/'))

function hostAllowed (raw) {
  let u
  try { u = new URL(raw) } catch (e) { return false }
  if (u.protocol !== 'https:' || u.username || u.password) return false
  return /^https:\/\/scdo\.com\.au(\/|$)/.test(u.href)
}
assert.strictEqual(hostAllowed('https://scdo.com.au/membership/'), true)
assert.strictEqual(hostAllowed('https://scdo.com.au/membership/?lang=en'), true)
assert.strictEqual(hostAllowed('https://scdo.com.au.evil.com/membership/'), false)
assert.strictEqual(hostAllowed('https://user:pass@scdo.com.au/membership/'), false)
assert.strictEqual(hostAllowed('https://scdo.com.au:8443/membership/'), false)
assert.strictEqual(hostAllowed('http://scdo.com.au/membership/'), false)

assert.strictEqual(siteNav.referral('abc_1'), 'https://scdo.com.au/wallet/?ref=abc_1&src=wallet')
assert.strictEqual(siteNav.referralFrom('https://scdo.com.au/join?ref=abc1234567'), 'https://scdo.com.au/wallet/?ref=abc1234567&src=wallet')
assert.strictEqual(siteNav.referralFrom('https://scdo.com.au/wallet/?ref=CODE'), 'https://scdo.com.au/wallet/?ref=CODE&src=wallet')
assert.strictEqual(siteNav.referralFrom('https://scdo.com.au.evil.com/join?ref=abc'), 'https://scdo.com.au/wallet/?src=wallet')
assert.strictEqual(siteNav.referralFrom('https://user:pass@scdo.com.au/join?ref=abc'), 'https://scdo.com.au/wallet/?src=wallet')
assert.strictEqual(Join.JOIN.joinPage, 'https://scdo.com.au/join')

const page = app.slice(app.indexOf('function pageHome'), app.indexOf('function renderFooter'))
const ret = page.slice(page.lastIndexOf('return `'))
assert.ok(ret.indexOf('${heights}') < ret.indexOf('${card}'))
assert.ok(ret.indexOf('${card}') < ret.indexOf('home-lead'))
assert.ok(ret.indexOf('home-lead') < ret.indexOf('id="homeChains"'))
assert.ok(ret.includes('id="homeHeights"') && ret.includes('id="homeHeightLine"'))
assert.ok(ret.includes('id="chainRows"') && ret.includes('homeSnapHtml()'))
assert.ok(!ret.includes('home-chain-fold'))
assert.ok(!ret.includes('externalCardHtml'))
assert.ok(page.includes("mineIdle ? ' hidden'"))
assert.ok(app.includes("case 'agentShard'"))
assert.ok(app.includes('st.agentShard = n'))
assert.ok(app.includes('classicOnShard'))

const recv = app.slice(app.indexOf('function pageRecv'), app.indexOf('function paintRecvQr'))
assert.ok(recv.includes("shellFold('recvChains'"))

const share = app.slice(app.indexOf('async function shareReferral'), app.indexOf('async function setMineMode'))
assert.ok(share.includes("toast(T('homeInviteShareFail'))"))
assert.ok(share.includes('clip:write'))
assert.ok(share.includes("toast(ok ? T('homeInviteShared') : T('homeInviteShareFail'))"))
assert.ok(share.includes('/Electron/i.test(navigator.userAgent'))
const openExt = app.slice(app.indexOf('async function openExternal'), app.indexOf('const CONTACT'))
assert.ok(openExt.includes("toast(T('openExternalFail'))") && openExt.includes('return ok'))
const buy = app.slice(app.indexOf('async function openAccountSite'), app.indexOf('function memberAddress'))
assert.ok(buy.includes('await openExternal(target)') && buy.includes('if (ok && (id === \'membership\' || id === \'otc\')) watchMember()'))

const box = { window: {} }
vm.runInNewContext(read('src/js/i18n112.js'), box)
const EN = box.window.I18N112.EN
const CN = box.window.I18N112.CN
assert.strictEqual(EN.agentCardTitle, 'Local SCDO bookkeeping agent')
assert.strictEqual(CN.agentCardTitle, '本機 SCDO 記帳代理')
assert.strictEqual(EN.inviteGiftTitle, 'Invite with attached SCDO')
assert.strictEqual(CN.inviteGiftTitle, '附上贈幣的邀請')
assert.strictEqual(EN.inviteGiftAsk, 'Attached SCDO amount (1 to 1000)')
assert.strictEqual(CN.inviteGiftAsk, '贈幣數量（1 到 1000）')
assert.strictEqual(EN.inviteGiftOwn, 'You are giving {n} SCDO of your own')
assert.strictEqual(CN.homeInviteShared, '連結已複製。貼到訊息裡就能分享給朋友。')
assert.ok(!/Gift/.test(EN.inviteGiftTitle + EN.inviteGiftAsk + EN.claimGift))

console.log('home-agent-3115: ok')
