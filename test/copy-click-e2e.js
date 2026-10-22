// Click the real Copy buttons (index.html + window.SCDOMineHome), not require().
// Run: electron test/copy-click-e2e.js
//   or: node test/copy-click-e2e.js   (re-launches under electron)
'use strict'
// 3.1.6: the wallet has no built-in Classic pool host; this run names a test pool.
process.env.SCDO_ZPOW_POOLS = process.env.SCDO_ZPOW_POOLS || JSON.stringify({ 1: { host: 'pool.test' }, 2: { host: 'pool.test' }, 3: { host: 'pool.test' }, 4: { host: 'pool.test' } })
if (!process.versions.electron) {
  const { spawnSync } = require('child_process')
  const electron = require('electron')
  const r = spawnSync(electron, [__filename], { stdio: 'inherit', env: process.env })
  process.exit(r.status == null ? 1 : r.status)
}

const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('fs')
const os = require('os')
const path = require('path')

const root = path.join(__dirname, '..')
const gpuDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scdo-click-'))
const exe = path.join(gpuDir, 'zminer-gpu.exe')
fs.writeFileSync(exe, '#!/bin/sh\nsleep 60\n')
fs.chmodSync(exe, 0o755)
fs.writeFileSync(path.join(gpuDir, 'zpowdet.dll'), '')
fs.writeFileSync(path.join(gpuDir, 'cudart64_12.dll'), '')

const starts = []
const stops = []
let win = null
const pageErrors = []

function addr (n) {
  return String(n) + 'S0' + String(n) + 'ab'.repeat(18) + 'a1'
}

function fail (msg) {
  console.error('copy-click-e2e: ' + msg)
  if (pageErrors.length) console.error(pageErrors.join('\n'))
  app.exit(1)
}

function idleClassic (mode) {
  return { chain: 'classic', mode: mode, running: false, code: 'IDLE', phase: 'idle', procs: [], shards: [] }
}

app.setPath('userData', path.join(gpuDir, 'user'))
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-dev-shm-usage')
app.commandLine.appendSwitch('no-sandbox')

ipcMain.handle('wallet:boot', () => ({
  config: { lang: 'CN', connect: [], allowCrossShard: false },
  shard0: { chainId: 5680, explorer: '', tokens: [] },
  ui: {},
  accounts: [1, 2, 3, 4].map(n => ({ filename: 'a' + n, pubkey: addr(n), shard: n, evm: '' }))
}))
ipcMain.handle('wallet:accounts', () => [1, 2, 3, 4].map(n => ({ filename: 'a' + n, pubkey: addr(n), shard: n, evm: '' })))
ipcMain.handle('wallet:saveUi', () => ({ ok: true }))
ipcMain.handle('app:info', () => ({ version: '3.1.0', displayVersion: '3.1.0' }))
ipcMain.handle('miner:status', () => ({ chain: 'shard0', running: false, code: 'IDLE', procs: [] }))
ipcMain.handle('miner:classicStatus', () => ({ classicCpu: idleClassic('cpu'), classicGpu: idleClassic('gpu') }))
ipcMain.handle('miner:intent', () => ({ miningMode: 'pool', keepMining: false }))
ipcMain.handle('miner:intentMigrate', () => ({ miningMode: 'pool', keepMining: false }))
ipcMain.handle('miner:resumeCheck', () => ({ autoResume: false, mode: 'mine', resume: { cpu: false, classicGpu: false, shard0: false }, running: false, gpuOk: true, otherRigels: [] }))
ipcMain.handle('miner:caps', () => ({}))
ipcMain.handle('app:mem', () => ({ total: 1, free: 1 }))
ipcMain.handle('miner:gpu', () => ({ nvidia: true, names: ['stub'] }))
ipcMain.handle('miner:clearRunning', () => ({ ok: true }))
ipcMain.handle('miner:otherRigels', () => [])
ipcMain.handle('mining:poolStatus', () => ({ 1: { online: false }, 2: { online: false }, 3: { online: false }, 4: { online: false } }))
ipcMain.handle('mining:localSync', () => ({}))
ipcMain.handle('mining:gpuTemp', () => ({ ok: true, gpus: [] }))
ipcMain.handle('mining:gpuPreflight', () => ({ ok: true, gpus: [{ status: 'ready' }] }))
ipcMain.handle('s0:chainInfo', () => ({ chainId: 5680, block: 1 }))
ipcMain.handle('s0:balances', () => ({ nativeWei: '0', tokens: [] }))
ipcMain.handle('s0:activity', () => [])
ipcMain.handle('s0:refreshPending', () => [])
ipcMain.handle('old:balance', () => '0')
ipcMain.handle('old:records', () => [])
ipcMain.handle('old:activity', () => ({ rows: [] }))
ipcMain.handle('notify:get', () => ({}))

const { clipboard, session } = require('electron')
function sleep (ms) { return new Promise(r => setTimeout(r, ms)) }
async function evalJs (code) { return win.webContents.executeJavaScript(code) }
async function clickSel (sel) {
  const box = await evalJs(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`)
  if (!box) throw new Error('no element ' + sel)
  win.focus(); win.webContents.focus()
  win.webContents.sendInputEvent({ type: 'mouseMove', x: box.x, y: box.y })
  win.webContents.sendInputEvent({ type: 'mouseDown', x: box.x, y: box.y, button: 'left', clickCount: 1 })
  win.webContents.sendInputEvent({ type: 'mouseUp', x: box.x, y: box.y, button: 'left', clickCount: 1 })
}
async function waitFor (code, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const ok = await evalJs(code); if (ok) return ok; await sleep(100) } return null }
app.whenReady().then(async () => {
  ipcMain.handle('clip:write', (e, t) => require('../src/main/clipWrite').clipWrite(clipboard, t))
  const allowClip = (perm) => perm === 'clipboard-sanitized-write' || perm === 'clipboard-read'
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(allowClip(perm)))
  session.defaultSession.setPermissionCheckHandler((wc, perm) => allowClip(perm))
  win = new BrowserWindow({ width: 1280, height: 900, show: true, webPreferences: { preload: path.join(root, 'preload.js'), nodeIntegration: false, contextIsolation: true, sandbox: false } })
  await win.loadFile(path.join(root, 'index.html'))
  if (!await waitFor(`!!document.getElementById('homePage')`, 20000)) return fail('home did not render')
  const results = []
  for (const n of [1, 2, 3, 4]) {
    clipboard.writeText('sentinel')
    await evalJs(`document.querySelector('[data-act="nav"][data-v="recv"]').click()`)
    await waitFor(`!!document.querySelector('[data-act="recvShard"][data-v="${n}"]')`, 5000)
    await clickSel(`[data-act="recvShard"][data-v="${n}"]`)
    await sleep(300)
    await evalJs(`navigator.clipboard.writeText = () => Promise.reject(new Error('blocked')); 1`)
    await clickSel('.recv-line [data-act="copy"]')
    await sleep(600)
    const toast = await evalJs(`(document.getElementById('toast') || {}).textContent || ''`)
    results.push({ n, clip: await clipboard.readText(), toast })
  }
  console.log(JSON.stringify(results, null, 1))
  const bad = results.filter(r => r.clip !== addr(r.n) || r.toast.indexOf(addr(r.n)) < 0)
  if (bad.length) return fail('copy wrong: ' + JSON.stringify(bad))
  console.log('copy-click-e2e: ok'); app.exit(0)
}).catch((err) => fail(err && err.stack || String(err)))
app.on('window-all-closed', () => {})
