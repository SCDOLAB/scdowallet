// 3.1.12: Agent card. One online state for presence and Status; the x402 Base reserve is asked for when the
// agent goes online and retried until the ledger returns it; the 華語 strings use Traditional characters only.
'use strict'
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const vm = require('vm')
const { AgentService, ONLINE_MS, RESERVE_RETRY_MS } = require('../src/agent/agentService')
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ag3112-'))
const OWN = '0x2d6F6ebc9686d0316e1f24F8588585C1f22fC956'
const root = path.join(__dirname, '..')

function body (env) {
  const p = env.payload ? (typeof env.payload === 'string' ? JSON.parse(env.payload) : env.payload) : env
  return p.body || p
}

function make (reply) {
  const clock = { now: 1_800_000_000_000 }
  const sent = []
  const reserves = []
  const svc = new AgentService(tmp(), { version: '3.1.12', platform: 'win32', light: () => true, snapshot: async () => ({}), handlers: {}, payoutAddress: () => OWN, onReserve: (a) => reserves.push(a) },
    { ledgerUrl: 'http://127.0.0.1:9/agent-ledger/api', now: () => clock.now, sleep: async () => {}, post: async (url, env) => { sent.push({ url, body: body(env) }); return reply(url, body(env)) } })
  return { svc, sent, clock, reserves }
}

;(async () => {
  // register asks for the agent's own address as the x402 reserve; the ledger's answer is kept
  let m = make((url, b) => ({ ok: true, status: 200, body: url.endsWith('/register') ? { ok: true, usdcWallet: b.usdcWallet, usdcWalletProof: 'self' } : { ok: true } }))
  assert.strictEqual(m.svc.status().online, false)
  assert.strictEqual(m.svc.status().settled, false)
  await m.svc.tick()
  const reg = m.sent.find(s => s.url.endsWith('/register')).body
  assert.strictEqual(reg.usdcWallet, m.svc.id.agentId)
  assert.strictEqual(reg.x402Support, true)
  assert.strictEqual(reg.payout, OWN)
  let st = m.svc.status()
  assert.strictEqual(st.online, true)
  assert.strictEqual(st.settled, true)
  assert.strictEqual(st.usdcWallet, m.svc.id.agentId)
  assert.deepStrictEqual(m.reserves, [m.svc.id.agentId])
  // online follows the ledger's window: no accepted post for ONLINE_MS -> offline
  m.clock.now += ONLINE_MS + 1
  assert.strictEqual(m.svc.online(), false)

  // an old ledger that does not return the reserve: retry register on a backoff until it does
  let give = false
  m = make((url, b) => ({ ok: true, status: 200, body: url.endsWith('/register') && give ? { ok: true, usdcWallet: b.usdcWallet } : { ok: true } }))
  await m.svc.tick()
  const regs = () => m.sent.filter(s => s.url.endsWith('/register')).length
  assert.strictEqual(regs(), 1)
  assert.strictEqual(m.svc.status().usdcWallet, '')
  await m.svc.tick()
  assert.strictEqual(regs(), 1, 'no retry before the backoff')
  m.clock.now += RESERVE_RETRY_MS[0]
  await m.svc.tick()
  assert.strictEqual(regs(), 2, 'retried after the first backoff')
  give = true
  m.clock.now += RESERVE_RETRY_MS[1]
  await m.svc.tick()
  assert.strictEqual(regs(), 3)
  assert.strictEqual(m.svc.status().usdcWallet, m.svc.id.agentId)
  m.clock.now += RESERVE_RETRY_MS[4] * 2
  await m.svc.tick()
  assert.strictEqual(regs(), 3, 'no more retries once the reserve is known')
  // going online fires the reserve request: offline gap, then an accepted heartbeat -> register in the same tick
  give = false
  m = make((url, b) => ({ ok: true, status: 200, body: url.endsWith('/register') && give ? { ok: true, usdcWallet: b.usdcWallet } : { ok: true } }))
  await m.svc.tick()
  assert.strictEqual(regs(), 1)
  m.clock.now += ONLINE_MS + 1
  assert.strictEqual(m.svc.online(), false, 'offline after the gap')
  m.svc.nextReserveAt = m.clock.now + 100 * ONLINE_MS // backoff far away: only the online trigger can fire
  give = true
  await m.svc.tick()
  assert.ok(m.sent.slice(-2)[0].url.endsWith('/heartbeat'), 'heartbeat first')
  assert.strictEqual(regs(), 2, 'register fired when the agent came back online')
  assert.strictEqual(m.svc.online(), true)
  assert.strictEqual(m.svc.status().usdcWallet, m.svc.id.agentId)
  // a heartbeat answer that carries the reserve fills it too
  m = make((url) => ({ ok: true, status: 200, body: url.endsWith('/heartbeat') ? { ok: true, usdcWallet: OWN } : { ok: true } }))
  await m.svc.tick()
  m.clock.now += 5 * 60 * 1000
  m.svc.nextReserveAt = m.clock.now + 100 * ONLINE_MS
  await m.svc.tick()
  assert.strictEqual(m.svc.status().usdcWallet, OWN)
  // the card's ledger read can also fill it
  m = make(() => ({ ok: true, status: 200, body: { ok: true } }))
  await m.svc.tick()
  assert.strictEqual(m.svc.noteReserve(OWN), true)
  assert.strictEqual(m.svc.status().usdcWallet, OWN)

  // a failed register: not online, settled (so the card leaves Starting)
  m = make(() => ({ ok: false, status: 400, body: { ok: false, error: 'payout_required' } }))
  await m.svc.tick()
  st = m.svc.status()
  assert.strictEqual(st.online, false)
  assert.strictEqual(st.settled, true)

  // no payout: the reserve is not requested (it must never stand in for a payout)
  const noPay = make(() => ({ ok: false, status: 400 }))
  noPay.svc.host.payoutAddress = () => ''
  await noPay.svc.tick()
  assert.ok(!('usdcWallet' in noPay.sent.find(s => s.url.endsWith('/register')).body))

  // main's snapshot builds the card status from that one state
  const { createStore, createController } = require('../src/main/agentJoin')
  const store = createStore(path.join(tmp(), 'join.json'))
  const ctl = createController({ store, env: { SCDO_AGENT_FAKE: '1' } })
  const on = await ctl.snapshot({ agentId: OWN, registered: true, online: true, settled: true, started: true, usdcWallet: OWN })
  assert.strictEqual(on.status, 'online')
  assert.strictEqual(on.online, true)
  const off = await ctl.snapshot({ agentId: OWN, registered: true, online: false, settled: true, started: true })
  assert.strictEqual(off.status, 'offline')
  const boot = await ctl.snapshot({ agentId: OWN, registered: false, online: false, settled: false, started: true })
  assert.strictEqual(boot.status, 'starting')

  // strings
  const box = { window: {} }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'src/js/i18n112.js'), 'utf8'), box)
  const CN = box.window.I18N112.CN
  const EN = box.window.I18N112.EN
  assert.strictEqual(CN.agentX402Pending, '待生成（Agent 上線後自動分配）')
  assert.strictEqual(EN.agentX402Pending, 'Not yet assigned (assigned when the agent goes online)')
  assert.strictEqual(CN.agentOnlineLine, '在線·請保持程式執行')
  assert.strictEqual(CN.agentOfflineLine, '離線·開啟錢包後自動上線')
  assert.strictEqual(CN.agentOnline, '在線')
  assert.strictEqual(CN.agentOffline, '離線')
  // no Simplified-only characters in the 華語 strings, the tray or the main-process dialogs
  const SIMPLIFIED = '线设离关启动时间问题这个们来为对从发现应该还没过进选择请显网络连钱账号户删确认复输错误码锁块链节点记录详细说帮语简体务计费币种转汇额预备证钥签验级页图标载传览获总状态则让给经营创导数据库样实际产单价资护卫读写变换钮开头广听见'
  const traditionalOnly = (txt) => [...txt].filter(c => SIMPLIFIED.includes(c))
  const cnText = JSON.stringify(CN)
  assert.deepStrictEqual(traditionalOnly(cnText), [], 'simplified characters in CN strings')
  const tray = fs.readFileSync(path.join(root, 'src/main/trayStatus.js'), 'utf8')
  const trayCn = tray.slice(tray.indexOf('  CN: {'), tray.indexOf('}', tray.indexOf('  CN: {')))
  assert.deepStrictEqual(traditionalOnly(trayCn), [])
  // language labels and wording rules
  assert.ok(!/中文/.test(cnText))
  const noMine = cnText.replace(/免費記帳（挖礦）/g, '')
  assert.ok(!/挖礦|礦機/.test(noMine))
  // the in-app notes do not claim a native Mac look
  assert.ok(!JSON.stringify(EN.relNotes).includes('closer to native'))
  assert.ok(!cnText.includes('更接近原生'))
  console.log('agent-3112: ok')
})().catch(e => { console.error(e); process.exit(1) })
