// Opt-in launch at login, Light mode, and a heartbeat that always has a code.
'use strict'
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const vm = require('vm')

const root = path.join(__dirname, '..')
const mode = require('../src/main/sessionMode')
const plan = require('../src/miner/guardPlan')
const { AgentService, heartbeatBody } = require('../src/agent/agentService')

assert.strictEqual(mode.normalizePrefs(null).loginLaunch, false)
assert.strictEqual(mode.normalizePrefs({}).loginLaunch, false)
assert.strictEqual(mode.offerLogin({}), true)
assert.strictEqual(mode.offerLogin({ loginAsked: true }), false)
assert.strictEqual(mode.offerLogin({ loginLaunch: true }), false)
assert.strictEqual(mode.resolveLight({ intent: {}, openedAtLogin: false }), false)
assert.strictEqual(mode.resolveLight({ intent: null, openedAtLogin: true }), true)
assert.strictEqual(mode.resolveLight({ intent: { lightChosen: true, lightMode: false }, openedAtLogin: true }), false)
assert.strictEqual(mode.resolveLight({ intent: { lightMode: true }, openedAtLogin: false }), true)
assert.strictEqual(mode.openedAtLogin({ argv: ['--scdo-login'], wasOpenedAtLogin: false }), true)
assert.strictEqual(mode.openedAtLogin({ argv: ['--hidden'], wasOpenedAtLogin: false }), true)
assert.strictEqual(mode.openedAtLogin({ argv: [], wasOpenedAtLogin: true }), true)
assert.strictEqual(mode.openedAtLogin({ argv: [], wasOpenedAtLogin: false }), false)
assert.strictEqual(mode.hiddenLaunch(['--hidden']), true)
assert.strictEqual(mode.hiddenLaunch(['--scdo-hidden']), true)
assert.strictEqual(mode.hiddenLaunch([]), false)

const off = mode.loginItemSettings(false)
const on = mode.loginItemSettings(true)
assert.strictEqual(off.openAtLogin, false)
assert.strictEqual(on.openAtLogin, true)
assert.deepStrictEqual(on.args, ['--hidden'])
assert.deepStrictEqual(off.args, [])
assert.strictEqual(on.openAsHidden, true)
assert.strictEqual(off.openAsHidden, false)

assert.strictEqual(mode.shouldArmLogin({}), false) // 3.1.10: opt-in only
assert.strictEqual(mode.shouldArmLogin({ keepMining: true, autoResume: true, runningShard0: true }), false)
assert.strictEqual(mode.shouldArmLogin({ loginLaunch: true }), false)
assert.strictEqual(mode.shouldArmLogin({ loginOff: true }), false)
assert.deepStrictEqual(mode.armLoginPatch(), { loginLaunch: true, loginAsked: true, loginOff: false })
assert.strictEqual(mode.rigWantsLogin({}, false), false)
assert.strictEqual(mode.rigWantsLogin({}, true), true)
assert.strictEqual(mode.rigWantsLogin({ keepMining: true }, false), true)
assert.strictEqual(mode.keepBookkeeping({ keepMining: true, autoResume: true }), true)
assert.strictEqual(mode.keepBookkeeping({ keepMining: false, autoResume: true }), false)
assert.strictEqual(mode.keepBookkeeping({ keepMining: true, runningShard0: true }), true)
assert.strictEqual(mode.resolveLight({ intent: { keepMining: true, autoResume: true }, openedAtLogin: true }), false)
assert.strictEqual(mode.resolveLight({ intent: { keepMining: true, runningCpu: true }, openedAtLogin: true }), false)
assert.strictEqual(mode.resolveLight({ intent: { lightMode: true, keepMining: true, autoResume: true }, openedAtLogin: true }), true)

const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8')
const sessionSrc = fs.readFileSync(path.join(root, 'src/main/sessionMode.js'), 'utf8')
assert.ok(!main.includes('openAtLogin: true'), 'login is never turned on by a literal')
assert.ok(!sessionSrc.includes('openAtLogin: true'))
assert.ok(main.includes('sessionMode.loginItemSettings'))
assert.ok(main.includes("code: 'LIGHT'"))
const resume = main.slice(main.indexOf("ipcMain.handle('miner:resumeCheck'"), main.indexOf("ipcMain.handle('miner:gpu'"))
assert.ok(resume.indexOf('sessionLight') < resume.indexOf('resumeOnce: false'))
assert.ok(main.includes('bootSession()'))
assert.ok(main.indexOf('bootSession()') < main.indexOf('createWindow()'))

const agent = fs.readFileSync(path.join(root, 'src/agent/agentService.js'), 'utf8')
const tick = agent.slice(agent.indexOf('async tick'), agent.indexOf('start ()'))
assert.ok(tick.indexOf('this.host.light') < tick.indexOf('this.host.snapshot'))
assert.strictEqual(heartbeatBody({ code: 'IDLE' }, '3.1.9').code, 'IDLE')

const app = fs.readFileSync(path.join(root, 'src/js/app112.js'), 'utf8')
const set = app.slice(app.indexOf('async function settingsModal'), app.indexOf('async function fillAboutHash'))
const html = set.slice(set.indexOf('const setHtml'), set.indexOf('const setHost'))
assert.ok(set.indexOf('id="setResume"') < set.indexOf('id="setSession"'))
assert.ok(set.indexOf('id="setSession"') < set.indexOf('const setHtml'))
assert.ok(html.includes('${sessionRow}') && html.indexOf('${sessionRow}') < html.indexOf("shellFold('setAdvanced'"))
assert.ok(set.includes('data-act="loginLaunch"') && set.includes('data-act="lightMode"'))
assert.ok(app.includes("T('loginAsk')") && app.includes('function offerLoginChoice'))
const startFn = app.slice(app.indexOf('async function startMyAgent'), app.indexOf('async function runClaim'))
assert.ok(startFn.indexOf('render()') < startFn.indexOf('refreshAgent()'))
assert.ok(startFn.includes("invoke('session:armLogin')"))
assert.ok(startFn.indexOf('refreshAgent()') < startFn.indexOf("invoke('session:armLogin')"))
assert.ok(main.includes('armLoginLaunch()'))
assert.ok(main.includes('keepAgentHeartbeat()'))
assert.ok(main.includes("args: open ? ['--hidden'] : []") || sessionSrc.includes("['--hidden']"))
const hide = main.slice(main.indexOf('function noteHiddenToTray'), main.indexOf('function confirmAgentQuit'))
assert.ok(hide.indexOf('keepAgentHeartbeat()') >= 0)
assert.ok(!hide.includes('opsAgent.stop'))
const close = main.slice(main.indexOf("mainWindow.on('close'"), main.indexOf("mainWindow.on('session-end'"))
assert.ok(close.includes('noteHiddenToTray()'))
assert.ok(!close.includes('opsAgent.stop'))
assert.ok(agent.includes('nudge ()'))
assert.ok(!agent.slice(agent.indexOf('start ()'), agent.indexOf('status ()')).includes('isVisible'))

const box = { window: {} }
vm.runInNewContext(fs.readFileSync(path.join(root, 'src/js/i18n112.js'), 'utf8'), box)
assert.strictEqual(box.window.I18N112.EN.loginAsk, 'Start SCDO Wallet when I log in?')
assert.strictEqual(box.window.I18N112.EN.loginYes, 'Yes')
assert.strictEqual(box.window.I18N112.EN.loginLater, 'Not now')
assert.strictEqual(box.window.I18N112.CN.loginAsk, '登入時要啟動 SCDO Wallet 嗎？')
assert.strictEqual(box.window.I18N112.EN.loginToggle, 'Launch at login (start minimised in tray)')
assert.strictEqual(box.window.I18N112.CN.loginToggle, '登入時啟動（最小化到系統匣）')
assert.strictEqual(box.window.I18N112.EN.lightToggle, 'Light mode')
assert.strictEqual(box.window.I18N112.EN.modeLight, 'Mode: Light')
assert.strictEqual(box.window.I18N112.CN.modeLight, '模式：輕量')
assert.ok(!/GPU|CPU|算力/.test(box.window.I18N112.EN.lightHint + box.window.I18N112.CN.lightHint + box.window.I18N112.EN.paceGpu))

function alive (over) {
  return Object.assign({
    platform: 'win32', active: true, userRunning: true,
    inputAgeMs: 100000, cpuPct: 10, fullscreen: false,
    onBattery: false, batteryPct: 90, ramFreePct: 40, commitPct: 40,
    gpuTempC: 40, childAlive: true, shares: 0, hashrate: 1000
  }, over || {})
}
const base = plan.freshGuard({ baseThreads: 8, threads: 8, lastMemCheck: 1e15, lastProgressAt: 0 })
let busy = plan.stepGuard(base, alive({ idleOnly: true, inputAgeMs: 1000 }), 1000)
assert.strictEqual(busy.state.reason, '使用中')
assert.ok(busy.actions.some(a => a.type === 'pause' && a.reason === '使用中'))
const unknown = plan.stepGuard(base, alive({ idleOnly: true, inputAgeMs: null }), 1000)
assert.strictEqual(unknown.state.reason, '')
const idle = plan.stepGuard(busy.state, alive({ idleOnly: true, inputAgeMs: 60000 }), 5000)
assert.strictEqual(idle.state.paused, false)
const low = plan.stepGuard(base, alive({ gpuLow: true, gpuTempC: 40 }), 1000)
assert.strictEqual(low.state.intensity, 'low')
assert.strictEqual(plan.plannedThreads(low.state), 4)

const tray = fs.readFileSync(path.join(root, 'src/main/trayStatus.js'), 'utf8')
assert.ok(tray.includes('Mode: Light') && tray.includes('模式：輕量') && tray.includes('Launch at login (start minimised in tray)'))
assert.ok(tray.includes('Online · keep app running') && tray.includes('在線 · 請保持程式執行'))
assert.ok(tray.includes("mode !== 'light' && mode !== 'full'"))

;(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scdo-light-'))
  let snapped = false
  const bodies = []
  const svc = new AgentService(dir, {
    version: '3.1.9',
    platform: 'linux',
    light: () => true,
    snapshot: async () => { snapped = true; return { code: 'MINING', gpuTempC: 70 } },
    payoutAddress: async () => '',
    enabled: () => true
  }, {
    ledgerUrl: 'http://127.0.0.1:9/agent-ledger/api',
    attempts: 1,
    now: () => 1e12,
    sleep: async () => {},
    post: async (url, env) => {
      bodies.push({ url, body: env.payload.body })
      return { ok: true, status: 200, body: { ok: true } }
    }
  })
  const out = await svc.tick()
  assert.strictEqual(out.light, true)
  assert.strictEqual(snapped, false)
  const beat = bodies.find(b => b.url.endsWith('/heartbeat'))
  assert.ok(beat)
  assert.strictEqual(beat.body.code, 'ONLINE')
  assert.ok(!bodies.some(b => b.url.endsWith('/heal')))

  const hiddenDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scdo-hidden-beat-'))
  const hiddenBodies = []
  const hidden = new AgentService(hiddenDir, {
    version: '3.1.9',
    platform: 'win32',
    light: () => false,
    snapshot: async () => ({ code: 'ONLINE', running: true, hashrate: 1 }),
    payoutAddress: async () => '',
    enabled: () => true
  }, {
    ledgerUrl: 'http://127.0.0.1:9/agent-ledger/api',
    attempts: 1,
    now: () => 2e12,
    sleep: async () => {},
    post: async (url, env) => {
      hiddenBodies.push({ url, body: env.payload.body })
      return { ok: true, status: 200, body: { ok: true } }
    }
  })
  await hidden.nudge()
  assert.ok(hidden.timer, 'heartbeat timer stays up with no window')
  const hiddenBeat = hiddenBodies.find(b => String(b.url).endsWith('/heartbeat'))
  assert.ok(hiddenBeat)
  assert.strictEqual(hiddenBeat.body.code, 'ONLINE')
  hidden.stop()
  console.log('session-mode: ok')
})().catch(e => { console.error(e); process.exit(1) })
