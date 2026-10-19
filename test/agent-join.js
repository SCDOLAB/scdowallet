// Start my agent: join URL, attribution lock, payout, register fields, referral code.
'use strict'
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { Wallet, verifyMessage } = require('ethers')
const Join = require('../src/js/agentJoin')
const { AgentService } = require('../src/agent/agentService')
const { signRefcode } = require('../src/agent/refcode')
const { messageOf } = require('../src/agent/envelope')
const { createStore } = require('../src/main/agentJoin')

const root = path.join(__dirname, '..')
const ADDR = '0x2d6f6ebc9686d0316e1f24f8588585c1f22fc956' // 3.1.11: real-looking fixtures (placeholders are refused as ledger payouts)
const OTHER = '0x52908400098527886e0f7030069857d2e4169ee7'
const THIRD = '0xe750146dffc722f231583de628696f05d694f5ed'

function tmp () { return fs.mkdtempSync(path.join(os.tmpdir(), 'scdo-join-')) }

assert.strictEqual(Join.parseJoinUrl('scdowallet://join?ref=CODE_1&src=x-promo').ref, 'CODE_1')
assert.strictEqual(Join.parseJoinUrl('scdowallet://join?ref=CODE_1&src=x-promo').src, 'x-promo')
assert.strictEqual(Join.parseJoinUrl('scdowallet://join?ref=' + ADDR).ref, ADDR)
assert.strictEqual(Join.parseJoinUrl('scdowallet://join/?ref=Ab_1.2').ref, 'Ab_1.2')
assert.strictEqual(Join.parseJoinUrl('scdowallet://join').ref, '')
assert.strictEqual(Join.parseJoinUrl('scdowallet://join?ref=' + '!'.repeat(3)).refRejected, true)
assert.strictEqual(Join.parseJoinUrl('scdowallet://join?ref=' + 'a'.repeat(65)).ref, '')
assert.strictEqual(Join.parseJoinUrl('ton://transfer/abc').ok, false)
assert.strictEqual(Join.parseJoinUrl('ethereum:0xabc@8453').ok, false)
assert.strictEqual(Join.parseJoinUrl('scdowallet://pay?ref=CODE').ok, false)
assert.deepStrictEqual(Join.urlsFromArgv(['--scdo', 'scdowallet://join?ref=A']), ['scdowallet://join?ref=A'])
assert.ok(Join.validRef(ADDR))
assert.ok(Join.validRef('a'))
assert.ok(Join.validRef('Ab_1.2-x'))
assert.ok(!Join.validRef(''))
assert.ok(!Join.validRef('has space'))
assert.ok(!Join.validRef('a'.repeat(65)))
assert.ok(Join.validSrc('wallet'))
assert.ok(!Join.validSrc('src/slash'))

const deep = Join.lockAttribution({ pendingRef: 'deep1', pendingSrc: 'x-promo' }, 'typed')
assert.strictEqual(deep.ref, 'deep1')
assert.strictEqual(deep.src, 'x-promo')
assert.strictEqual(deep.locked, true)
assert.strictEqual(Join.lockAttribution(deep, 'other').ref, 'deep1')
assert.strictEqual(Join.lockAttribution({ pendingRef: '', pendingSrc: '' }, 'typed_2').ref, 'typed_2')
const remembered = Join.rememberJoin({ locked: false }, Join.parseJoinUrl('scdowallet://join?ref=NEW&src=qr'))
assert.strictEqual(remembered.pendingRef, 'NEW')
assert.strictEqual(Join.rememberJoin({ locked: true, ref: 'keep', pendingRef: '' }, Join.parseJoinUrl('scdowallet://join?ref=NEW')).ref, 'keep')

const accounts = [{ filename: 'a', evm: OTHER }, { filename: 'b', evm: THIRD }]
assert.strictEqual(Join.choosePayout(accounts, 'b', '').payout, THIRD)
assert.strictEqual(Join.choosePayout(accounts, 'b', '').file, 'b')
assert.strictEqual(Join.choosePayout(accounts, 'missing', ADDR).changed, false)
assert.strictEqual(Join.choosePayout([], 'a', '').payout, '')
const filled = Join.bookkeepingPatch({ reward: OTHER }, THIRD)
assert.strictEqual(filled.reward, undefined)
assert.strictEqual(filled.payout, THIRD)
assert.deepStrictEqual(Join.bookkeepingPatch({ reward: OTHER, payout: OTHER }, THIRD), {})
assert.strictEqual(Join.bookkeepingPatch({}, THIRD).reward, THIRD)

const install = 'install-secret-not-sent'
const hash = Join.deviceHash(install)
assert.strictEqual(hash.length, 64)
assert.ok(!hash.includes(install))
assert.deepStrictEqual(Join.joinBodyFields({ ref: 'ok', src: 'x-promo', device: hash, usdcWallet: ADDR }), {
  ref: 'ok', src: 'x-promo', device: hash, usdcWallet: ADDR, x402Support: true
})
assert.deepStrictEqual(Join.joinBodyFields({ ref: 'bad ref', device: 'short' }), {})
assert.ok(!JSON.stringify(Join.joinBodyFields({ device: hash, ref: 'ok' })).includes(install))

const pw = Join.generatePassword(Buffer.alloc(12, 7))
assert.ok(/(?=.*[0-9])(?=.*[A-Z])(?=.*[a-z])(?=.*[^a-zA-Z0-9]).{8,15}/.test(pw))

assert.strictEqual(Join.x402Reserve({ services: [{ endpoint: 'eip155:8453:' + ADDR }] }), ADDR)
assert.strictEqual(Join.x402Reserve({}), '')
// 3.1.12: one online state drives the card.
assert.strictEqual(Join.cardStatus({ registered: true, online: true }), 'online')
assert.strictEqual(Join.cardStatus({ registered: true, online: false }), 'offline')
assert.strictEqual(Join.cardStatus({ started: true, online: false, settled: false }), 'starting')
assert.strictEqual(Join.cardStatus({ started: true, online: false, settled: true }), 'offline')
assert.strictEqual(Join.cardStatus({ registered: false }), 'pending')
assert.strictEqual(Join.showBackupCard({ phrasePending: 1, registered: false, entries: [] }), false)
assert.strictEqual(Join.showBackupCard({ phrasePending: 1, registered: true, dismissed: false }), true)
assert.strictEqual(Join.showBackupCard({ phrasePending: 1, registered: true, dismissed: true }), false)
assert.strictEqual(Join.showBackupCard({ phrasePending: 1, entries: [{ text: 'a' }] }), true)
assert.strictEqual(Join.claimBlocked(true), true)
assert.strictEqual(Join.claimBlocked(false), false)
assert.strictEqual(Join.fallbackShareUrl(ADDR), 'https://scdo.com.au/join?ref=' + ADDR + '&src=wallet')
assert.strictEqual(Join.useFake({ SCDO_AGENT_FAKE: '1' }), true)
assert.strictEqual(Join.useFake({}), false)
assert.strictEqual(Join.fakeRefcode().code, 'abc1234567')
assert.ok(!fs.readFileSync(path.join(root, 'src/js/agentJoin.js'), 'utf8').includes('/agent-ledger/api/join'))

const labels = {
  startAgent: 'Start my agent', importShort: 'Import', inviteCodeAsk: 'Have an invite code?',
  agentRewards: 'Rewards unlock after your agent has been active',
  agentStayOpen: 'Your agent is online only while SCDO Wallet is running. Keep it open or in the tray.',
  agentOnlineLine: 'Online · keep app running',
  agentOfflineLine: 'Offline · goes online when the wallet is open',
  agentNoReward: 'Your agent has no reward address - tap to use this wallet',
  agentCardTitle: 'Agent', agentStatus: 'Status', agentRegistered: 'Registered', agentPending: 'Waiting', agentOffline: 'Offline', agentOnline: 'Online', agentNotStarted: 'Not started',
  agentStarting: 'Starting…', agentX402Pending: 'Not yet assigned (assigned when the agent goes online)',
  agentAct_report: 'Reported', agentAct_task_join: 'Joined', agentOutcome_done: 'done', agentReason_payout_balance_stale: 'payout balance not updated for a long time',
  agentScdoAddr: 'SCDO address', agentX402: 'x402 Base USDC reserve address', agentBook: 'Bookkeeping',
  agentStartBook: 'Start bookkeeping', agentEntries: 'Latest ledger entries', agentEntriesEmpty: 'No ledger entries yet',
  dismiss: 'Dismiss', homeLineIdle: 'Bookkeeping has not started'
}
const t = (k) => labels[k] || k
const first = Join.firstRunHtml(t, (s) => s, {})
assert.ok(first.includes('Start my agent'))
assert.ok(first.includes('Have an invite code?'))
assert.ok(first.includes('Rewards unlock after your agent has been active'))
assert.ok(first.includes('Your agent is online only while SCDO Wallet is running. Keep it open or in the tray.'))
assert.ok(first.includes('id="agentStayOpen"'))
assert.ok(first.includes('Offline · goes online when the wallet is open'))
assert.ok(first.includes('Your agent has no reward address - tap to use this wallet'))
assert.ok(first.includes('id="startAgentBtn"'))
assert.ok(first.includes('data-act="import"'))
assert.ok(first.includes('data-act="agentRewardDismiss"'))
assert.ok(!/\$\d|\d+\s*SCDO/.test(first))
assert.ok(first.includes('data-act="pasteJoinRef"'))
assert.ok(first.includes('id="joinRefPaste"'))
assert.ok(!first.includes('readonly'))
assert.ok(!first.includes('data-act="copy"'))
assert.strictEqual(Join.refFromPaste('  good_code  '), 'good_code')
assert.strictEqual(Join.refFromPaste('https://scdo.com.au/join?ref=abc_1&src=wallet'), 'abc_1')
assert.strictEqual(Join.refFromPaste('https://apeccapital.org/join?ref=ok.2'), 'ok.2')
assert.strictEqual(Join.refFromPaste('scdowallet://join?ref=deep-3&src=x'), 'deep-3')
assert.strictEqual(Join.refFromPaste('scdo.com.au/join?ref=abc_1'), 'abc_1')
assert.strictEqual(Join.refFromPaste('https://SCDO.com.au/join?ref=Ab_1'), 'Ab_1')
assert.strictEqual(Join.refFromPaste('http://scdo.com.au/join?ref=abc'), '')
assert.strictEqual(Join.refFromPaste('https://evil.example/join?ref=abc'), '')
assert.strictEqual(Join.refFromPaste('https://scdo.com.au.evil.com/join?ref=abc'), '')
assert.strictEqual(Join.refFromPaste('https://user:pass@scdo.com.au/join?ref=abc'), '')
assert.strictEqual(Join.refFromPaste('https://scdo.com.au:8443/join?ref=abc'), '')
assert.strictEqual(Join.refFromPaste('https://scdo.com.au/join?ref=bad ref'), '')
assert.strictEqual(Join.refFromPaste('scdowallet://pay?ref=abc'), '')
assert.strictEqual(Join.refFromPaste('has space'), '')
const locked = Join.firstRunHtml(t, (s) => s, { pendingRef: 'deep-3' })
assert.ok(locked.includes('readonly'))
assert.ok(!locked.includes('disabled'))
assert.ok(locked.includes('data-act="copy"'))
assert.ok(locked.includes('data-v="deep-3"'))
assert.ok(locked.includes('id="joinRefCopy"'))
assert.ok(!locked.includes('pasteJoinRef'))
assert.ok(!locked.includes('id="joinRefPaste"'))
const appSrc = fs.readFileSync(path.join(root, 'src/js/app112.js'), 'utf8')
const pasteAt = appSrc.indexOf("t.id !== 'joinRef'")
assert.ok(pasteAt > 0)
const pasteSlice = appSrc.slice(pasteAt, pasteAt + 280)
assert.ok(pasteSlice.includes('preventDefault()'))
assert.ok(pasteSlice.includes('applyJoinPaste'))
const applyAt = appSrc.indexOf('function applyJoinPaste')
assert.ok(applyAt > 0)
assert.ok(appSrc.slice(applyAt, applyAt + 220).includes('refFromPaste'))
assert.ok(appSrc.includes("case 'pasteJoinRef'"))
const mainSrc = fs.readFileSync(path.join(root, 'main.js'), 'utf8')
assert.ok(mainSrc.includes("perm === 'clipboard-read'"))
const css = fs.readFileSync(path.join(root, 'src/css/shell310.css'), 'utf8')
assert.ok(css.includes('#joinRef { -webkit-user-select: text; user-select: text; }'))
const card = Join.agentCardHtml(t, (s) => s, {
  status: 'online', scdoAddress: '1S01abc', x402Reserve: '', bookkeeping: 'Bookkeeping has not started',
  entries: [{ text: 'task:join · done', action: 'task:join', outcome: 'done' }, { text: 'report · reported', action: 'report', outcome: 'reported', reason: 'payout balance stale' }]
})
assert.ok(card.includes('<b id="agentStatus">Online</b>'))
assert.ok(card.includes('Online · keep app running'))
assert.ok(card.includes('agent-presence online'))
assert.ok(card.includes('1S01abc'))
assert.ok(!card.includes('pending'))
assert.ok(card.includes('Not yet assigned (assigned when the agent goes online)'))
assert.ok(card.includes('Start bookkeeping'))
assert.ok(card.includes('data-act="isleStart"'))
assert.ok(card.includes('Joined · done'))
assert.ok(card.includes('Reported · payout balance not updated for a long time'))
assert.ok(!card.includes('task:join'))
const withReserve = Join.agentCardHtml(t, (s) => s, { status: 'online', x402Reserve: ADDR })
assert.ok(withReserve.includes('class="mono" id="agentX402">' + ADDR + '<'))
assert.strictEqual(Join.agentPresence({ status: 'online' }), 'online')
assert.strictEqual(Join.agentPresence({ status: 'registered' }), 'online')
assert.strictEqual(Join.agentPresence({ status: 'starting' }), 'starting')
assert.strictEqual(Join.agentPresence({ status: 'offline', started: true }), 'offline')
assert.strictEqual(Join.agentPresence({ status: 'offline' }), 'offline')
assert.strictEqual(Join.agentPresence({ status: 'pending' }), 'offline')
assert.strictEqual(Join.agentPresence({ noWallet: true, status: 'online', started: true }), 'offline')
// presence and Status never disagree
for (const status of ['online', 'offline', 'starting', 'pending']) {
  const html = Join.agentCardHtml(t, (s) => s, { status })
  const green = html.includes('agent-presence online')
  const statusOnline = html.includes('<b id="agentStatus">Online</b>')
  assert.strictEqual(green, statusOnline, status)
}
const off = Join.agentCardHtml(t, (s) => s, { status: 'offline' })
assert.ok(off.includes('agent-presence offline') && off.includes('<b id="agentStatus">Offline</b>') && off.includes('Offline · goes online when the wallet is open'))
const idle = Join.agentCardHtml(t, (s) => s, { status: 'pending' })
assert.ok(idle.includes('agent-presence offline'))
assert.ok(idle.includes('Offline · goes online when the wallet is open'))
assert.ok(idle.includes('<b id="agentStatus">Not started</b>'))

;(async () => {
  const ran = await Join.runStart({
    accounts: [],
    password: pw,
    typedRef: 'code1',
    device: hash,
    state: { pendingRef: '', pendingSrc: 'qr' },
    create: async (p) => {
      assert.strictEqual(p.shard, '0')
      assert.ok(!String(p.password).includes('mnemonic'))
      return { ok: true, file: 'Agent.1', evm: ADDR, phrase: 'one two three four five six seven eight nine ten eleven twelve' }
    },
    register: async () => { throw new Error('down') }
  })
  assert.strictEqual(ran.ok, true)
  assert.strictEqual(ran.registered, false)
  assert.strictEqual(ran.wallet.evm, ADDR)
  assert.strictEqual(ran.locked.ref, 'code1')
  assert.strictEqual(ran.locked.src, 'qr')
  assert.strictEqual(ran.choice.payout, ADDR)
  assert.strictEqual(ran.book.reward, ADDR)
  assert.ok(ran.phrase.split(' ').length === 12)

  const seen = []
  const svc = new AgentService(tmp(), {
    version: '3.1.9', platform: 'linux',
    payoutAddress: async () => ADDR,
    joinExtra: () => ({ ref: 'deep1', src: 'x-promo', device: hash, usdcWallet: OTHER })
  }, {
    ledgerUrl: 'http://127.0.0.1:9/agent-ledger/api',
    attempts: 1,
    retryDelayMs: 1,
    post: async (url, env) => {
      seen.push({ url, env })
      if (String(url).endsWith('/refcode') && seen.filter(x => x.url.endsWith('/refcode')).length === 1) {
        return { ok: false, status: 409, body: { ok: false, error: 'not registered' } }
      }
      if (String(url).endsWith('/refcode')) {
        return { ok: true, status: 200, body: { ok: true, code: 'abc1234567', shareUrl: 'https://scdo.com.au/join?ref=abc1234567' } }
      }
      return { ok: true, status: 200, body: { ok: true } }
    }
  })
  const reg = await svc.register()
  assert.strictEqual(reg.ok, true)
  const body = seen[0].env.payload.body
  assert.strictEqual(body.role, 'wallet-miner')
  assert.strictEqual(body.payout, ADDR)
  assert.strictEqual(body.ref, 'deep1')
  assert.strictEqual(body.src, 'x-promo')
  assert.strictEqual(body.device, hash)
  assert.strictEqual(body.usdcWallet, OTHER)
  assert.strictEqual(body.x402Support, true)
  assert.ok(!JSON.stringify(body).includes(install))
  assert.ok(seen[0].url.indexOf('/agent-ledger/api/register') > 0)
  const looked = await svc.refcode()
  assert.strictEqual(looked.body.code, 'abc1234567')
  assert.ok(seen.some(x => x.url.endsWith('/register')))
  assert.strictEqual(seen.filter(x => x.url.endsWith('/refcode')).length, 2)
  const refEnv = seen.find(x => x.url.endsWith('/refcode')).env
  assert.strictEqual(refEnv.payload.type, 'refcode')
  assert.ok(refEnv.payload.seq == null)
  assert.strictEqual(verifyMessage(messageOf(refEnv.payload), refEnv.sig), svc.id.agentId)

  const w = Wallet.createRandom()
  const signed = signRefcode(w, 1700000000000)
  assert.strictEqual(signed.payload.seq, undefined)
  assert.strictEqual(verifyMessage(messageOf(signed.payload), signed.sig), w.address)

  const file = path.join(tmp(), 'agent-join.json')
  const store = createStore(file)
  store.remember(Join.parseJoinUrl('scdowallet://join?ref=deep9&src=x-promo'))
  assert.strictEqual(store.lock('typed').ref, 'deep9')
  assert.strictEqual(store.lock('nope').ref, 'deep9')
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.ok(raw.installId)
  assert.ok(!store.publicView().installId)
  assert.ok(!JSON.stringify(store.joinExtra()).includes(raw.installId))
  const pay = store.currentPayout('', [{ filename: 'w', evm: ADDR }], {})
  assert.strictEqual(pay.payout, ADDR)
  assert.strictEqual(pay.intentPatch.reward, ADDR)
  assert.strictEqual(pay.intentPatch.payout, ADDR)
  const kept = store.currentPayout(THIRD, [{ filename: 'w', evm: ADDR }], { reward: ADDR, payout: ADDR })
  assert.strictEqual(kept.payout, ADDR)
  assert.deepStrictEqual(kept.intentPatch, {})
  const moved = store.useSelection([{ filename: 'z', evm: OTHER }], 'z', { reward: ADDR, payout: ADDR })
  assert.strictEqual(moved.view.payout, OTHER)
  assert.strictEqual(moved.changed, true)
  store.setPayout(THIRD, 'z', 'settings')
  const stuck = store.useSelection([{ filename: 'z', evm: OTHER }], 'z', { reward: THIRD, payout: THIRD })
  assert.strictEqual(stuck.view.payout, THIRD)
  assert.strictEqual(stuck.changed, false)

  const app = fs.readFileSync(path.join(root, 'src/js/app112.js'), 'utf8')
  const startFn = app.slice(app.indexOf('async function startMyAgent'), app.indexOf('async function boot'))
  assert.ok(startFn.includes('agentJoin:start'))
  assert.ok(!startFn.includes('showBackupPage'))
  const i18nBox = { window: {} }
  require('vm').runInNewContext(fs.readFileSync(path.join(root, 'src/js/i18n112.js'), 'utf8'), i18nBox)
  assert.strictEqual(i18nBox.window.I18N112.EN.agentRewards, 'Rewards unlock after your agent has been active')
  assert.strictEqual(i18nBox.window.I18N112.EN.agentNoReward, 'Your agent has no reward address - tap to use this wallet')
  assert.strictEqual(i18nBox.window.I18N112.EN.startAgent, 'Start my agent')
  assert.strictEqual(i18nBox.window.I18N112.CN.startAgent, '啟動我的 Agent')
  assert.ok(fs.readFileSync(path.join(root, 'main.js'), 'utf8').includes("setAsDefaultProtocolClient('scdowallet')"))
  assert.strictEqual(Join.parseWalletUrl('scdowallet://agent/start').kind, 'agent-start')
  assert.strictEqual(Join.parseWalletUrl('scdowallet://agent/start/').kind, 'agent-start')
  assert.strictEqual(Join.parseWalletUrl('SCDOWALLET://AGENT/START').kind, 'agent-start')
  assert.strictEqual(Join.parseWalletUrl('scdowallet://invite/create').kind, 'invite-create')
  assert.strictEqual(Join.parseWalletUrl('scdowallet://join?ref=CODE&src=wallet').kind, 'join')
  assert.strictEqual(Join.parseJoinUrl('scdowallet://pay?ref=CODE').ok, false)
  const secret = 'ab'.repeat(32)
  const claim = Join.parseWalletUrl('scdowallet://invite?s=' + secret + '&c=0x458F974CcC4F1DB16Fe9F57489b134D7013bAD0d&n=5680')
  assert.strictEqual(claim.ok, true)
  assert.strictEqual(claim.secret, secret)
  assert.strictEqual(claim.chainId, 5680)
  const badChain = Join.parseWalletUrl('scdowallet://invite?s=' + secret + '&c=0x458F974CcC4F1DB16Fe9F57489b134D7013bAD0d&n=1')
  assert.strictEqual(badChain.ok, false)
  assert.ok(!JSON.stringify(badChain).includes(secret))
  const badContract = Join.parseWalletUrl('scdowallet://invite?s=' + secret + '&c=' + OTHER + '&n=5680')
  assert.strictEqual(badContract.ok, false)
  assert.ok(!JSON.stringify(badContract).includes(secret))
  assert.strictEqual(i18nBox.window.I18N112.EN.inviteGiftOwn, 'You are giving {n} SCDO of your own')
  assert.ok(Join.inviteGiftHtml(function (k, p) { return k === 'inviteGiftOwn' ? 'You are giving ' + p.n + ' SCDO of your own' : k }, function (s) { return s }, { gift: 1 }).includes('You are giving 1 SCDO of your own'))
  assert.ok(!Join.inviteClaimHtml(function (k) { return k }, function (s) { return s }).includes(secret))
  assert.ok(app.includes("msg.route === 'agent-start'"))
  assert.ok(app.includes("msg.route === 'invite-create'"))
  assert.ok(app.includes("msg.route === 'invite-claim'"))
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8')
  assert.ok(main.includes('Join.parseWalletUrl'))
  console.log('agent-join: ok')
})().catch(e => { console.error(e); process.exit(1) })
