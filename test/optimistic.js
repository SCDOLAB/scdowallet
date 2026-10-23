// Optimistic start and claim. The painted state changes before the background wait.
'use strict'
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const Opt = require('../src/js/optimistic')
const Join = require('../src/js/agentJoin')

const root = path.join(__dirname, '..')
const ADDR = '0x' + 'ab'.repeat(20)

assert.strictEqual(Opt.CONFIRM_MS, 14000)
assert.strictEqual(Opt.COPY.gift, 'Bonus SCDO received · agent started')
assert.strictEqual(Opt.COPY.confirming, 'Confirming…')
assert.strictEqual(Opt.COPY.starting, 'Starting…')

const started = Opt.startView()
assert.strictEqual(started.phase, 'starting')
assert.strictEqual(started.text, 'Starting…')
assert.strictEqual(started.blocking, false)
assert.strictEqual(started.spinner, false)

const gift = Opt.claimFromHttp({ status: 200, body: { ok: true } })
assert.strictEqual(gift.phase, 'confirming')
assert.strictEqual(gift.text, 'Bonus SCDO received · agent started')
assert.strictEqual(gift.badge, 'Confirming…')
assert.strictEqual(gift.blocking, false)
assert.strictEqual(gift.spinner, false)
assert.strictEqual(gift.confirmMs, 14000)

const quiet = Opt.claimFromHttp({ status: 503 })
assert.strictEqual(quiet.phase, 'retry')
assert.strictEqual(quiet.text, '')
assert.strictEqual(quiet.gentle, true)
assert.strictEqual(quiet.spinner, false)
assert.ok(!JSON.stringify(quiet).includes('Gift received'))

assert.strictEqual(Opt.claimSettled(gift, true).phase, 'confirmed')
assert.strictEqual(Opt.claimSettled(gift, true).badge, 'Confirmed')
assert.strictEqual(Opt.claimSettled(gift, true).text, 'Bonus SCDO received · agent started')
const reverted = Opt.claimSettled(gift, false)
assert.strictEqual(reverted.phase, 'retry')
assert.strictEqual(reverted.text, '')
assert.strictEqual(reverted.gentle, true)
assert.strictEqual(reverted.retry, true)
assert.strictEqual(reverted.blocking, false)
assert.strictEqual(reverted.spinner, false)

const box = { window: {} }
vm.runInNewContext(fs.readFileSync(path.join(root, 'src/js/i18n112.js'), 'utf8'), box)
const EN = box.window.I18N112.EN
const CN = box.window.I18N112.CN
assert.strictEqual(EN.claimGift, 'Bonus SCDO received · agent started')
assert.strictEqual(EN.claimConfirming, 'Confirming…')
assert.strictEqual(EN.claimConfirmed, 'Confirmed')
assert.strictEqual(EN.agentStarting, 'Starting…')
assert.strictEqual(CN.agentStarting, '啟動中…')
assert.strictEqual(CN.claimGift, '贈幣已收到 · Agent 已啟動')
assert.strictEqual(CN.claimConfirming, '確認中…')

const t = (k) => EN[k] || k
const esc = (s) => String(s)
const live = Opt.claimBannerHtml(gift, t, esc)
assert.ok(live.includes('Bonus SCDO received · agent started'))
assert.ok(live.includes('Confirming…'))
assert.ok(live.includes('id="claimBadge"'))
assert.ok(!/spinner|bspin|aria-busy/.test(live))
const done = Opt.claimBannerHtml(Opt.claimSettled(gift, true), t, esc)
assert.ok(done.includes('Confirmed'))
assert.ok(!done.includes('Confirming…'))
const again = Opt.claimBannerHtml(reverted, t, esc)
assert.ok(again.includes('data-act="claimRetry"'))
assert.ok(!again.includes('Gift received'))
assert.ok(!/spinner|bspin/.test(again))

const card = Join.agentCardHtml(t, esc, { status: 'starting', scdoAddress: ADDR, bookkeeping: 'Bookkeeping has not started', entries: [] })
assert.ok(card.includes('Starting…'))
assert.ok(card.includes('id="agentCard"'))

;(async () => {
  let opened = false
  let release
  const gate = new Promise(r => { release = r })
  const ran = await Join.runStart({
    accounts: [{ filename: 'Agent.1', evm: ADDR }],
    state: {},
    register: () => { opened = true; return gate }
  })
  assert.strictEqual(ran.starting, true)
  assert.strictEqual(ran.registered, false)
  assert.strictEqual(opened, false)
  await Promise.resolve()
  assert.strictEqual(opened, true)
  release({ ok: true })

  let slept = false
  const pending = Opt.confirmInBackground(gift, async () => true, {
    waitMs: 14000,
    sleep: (ms) => { assert.strictEqual(ms, 14000); slept = true; return new Promise(r => { release = r }) }
  })
  let settled = false
  pending.then(() => { settled = true })
  await Promise.resolve()
  assert.strictEqual(slept, true)
  assert.strictEqual(settled, false)
  release()
  const next = await pending
  assert.strictEqual(next.phase, 'confirmed')
  assert.strictEqual(next.badge, 'Confirmed')
  assert.strictEqual(next.spinner, false)

  const failed = await Opt.confirmInBackground(gift, async () => { throw new Error('rpc') }, { waitMs: 0, sleep: () => Promise.resolve() })
  assert.strictEqual(failed.phase, 'retry')
  assert.strictEqual(failed.gentle, true)
  assert.strictEqual(failed.spinner, false)
  assert.strictEqual(failed.text, '')

  const app = fs.readFileSync(path.join(root, 'src/js/app112.js'), 'utf8')
  const startFn = app.slice(app.indexOf('async function startMyAgent'), app.indexOf('async function runClaim'))
  assert.ok(startFn.indexOf('render()') < startFn.indexOf('refreshAgent()'))
  assert.ok(startFn.includes("status: 'starting'"))
  assert.ok(!startFn.includes('showBackupPage'))
  const claimFn = app.slice(app.indexOf('async function runClaim'), app.indexOf('async function boot'))
  assert.ok(claimFn.indexOf('render()') < claimFn.indexOf('confirmInBackground'))
  assert.ok(!claimFn.includes('bspin'))
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8')
  const mainStart = main.slice(main.indexOf('async function startMyAgent'), main.indexOf('function registerAgentLater'))
  assert.ok(!mainStart.includes('await opsAgent.register'))
  assert.ok(mainStart.includes('registerAgentLater()'))
  assert.ok(main.includes("send('agentJoin:settled'"))
  assert.ok(main.includes('/invite/claim') || fs.readFileSync(path.join(root, 'src/agent/agentService.js'), 'utf8').includes('/invite/claim'))
  console.log('optimistic: ok')
})().catch(e => { console.error(e); process.exit(1) })
