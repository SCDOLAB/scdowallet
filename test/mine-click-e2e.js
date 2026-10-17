// Click the real mining page (index.html + window.SCDOMineHome), not require().
// Run: electron test/mine-click-e2e.js
//   or: node test/mine-click-e2e.js   (re-launches under electron)
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
const { GpuFleet } = require('../src/miner/zpow/manager')

const root = path.join(__dirname, '..')
const gpuDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scdo-click-'))
const exe = path.join(gpuDir, 'zminer-gpu.exe')
fs.writeFileSync(exe, '#!/bin/sh\nsleep 60\n')
fs.chmodSync(exe, 0o755)
fs.writeFileSync(path.join(gpuDir, 'zpowdet.dll'), '')
fs.writeFileSync(path.join(gpuDir, 'cudart64_12.dll'), '')

const fleet = new GpuFleet({
  platform: process.platform,
  dataRoot: path.join(gpuDir, 'data'),
  root: root,
  env: Object.assign({}, process.env, { SCDO_ZMINER_GPU_EXE: exe })
})

const starts = []
const stops = []
let win = null
const pageErrors = []

function addr (n) {
  return String(n) + 'S0' + String(n) + 'ab'.repeat(18) + 'a1'
}

function fail (msg) {
  console.error('mine-click-e2e: ' + msg)
  if (pageErrors.length) console.error(pageErrors.join('\n'))
  try { fleet.stop() } catch (e) {}
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
ipcMain.handle('miner:caps', () => fleet.capabilities(fleet.o.env))
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
ipcMain.handle('miner:start', async (e, wallet, opts) => {
  starts.push({ wallet: wallet, opts: opts || {} })
  opts = opts || {}
  if (opts.chain === 'classic' && opts.backend === 'gpu') {
    try {
      await fleet.start(wallet, Object.assign({}, opts, { chain: 'classic', backend: 'gpu' }))
      return { ok: true }
    } catch (err) {
      return { ok: false, code: err.code || 'ERROR', error: err.message }
    }
  }
  return { ok: false, code: 'UNEXPECTED' }
})
ipcMain.handle('miner:stop', async (e, src) => {
  const t0 = Date.now()
  if (!src || src === 'mine' || (src && src.chain === 'classic')) {
    try { await fleet.stop() } catch (e2) {}
  }
  const ms = Date.now() - t0
  stops.push({ src: src, ms: ms })
  return { ok: true, ms: ms }
})

fleet.on('status', (st) => {
  if (win && !win.isDestroyed()) win.webContents.send('miner:classic', st)
})

function sleep (ms) { return new Promise(r => setTimeout(r, ms)) }

async function evalJs (code) {
  return win.webContents.executeJavaScript(code)
}

async function clickSel (sel) {
  const box = await evalJs(`(() => {
    const el = document.querySelector(${JSON.stringify(sel)})
    if (!el) return null
    el.scrollIntoView({ block: 'center', inline: 'center' })
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + Math.min(r.height / 2, 20)), text: el.textContent || '', disabled: !!el.disabled }
  })()`)
  if (!box) throw new Error('no element ' + sel)
  win.focus()
  win.webContents.sendInputEvent({ type: 'mouseMove', x: box.x, y: box.y })
  win.webContents.sendInputEvent({ type: 'mouseDown', x: box.x, y: box.y, button: 'left', clickCount: 1 })
  win.webContents.sendInputEvent({ type: 'mouseUp', x: box.x, y: box.y, button: 'left', clickCount: 1 })
  return box
}

async function waitFor (code, ms) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const ok = await evalJs(code)
    if (ok) return ok
    await sleep(100)
  }
  return null
}

async function panel (device) {
  return evalJs(`(() => {
    const btn = document.getElementById(${JSON.stringify(device === 'cpu' ? 'homeMineCpu' : 'homeMineGpu')})
    const st = document.querySelector(${JSON.stringify('[data-dev-status="' + device + '"]')})
    return { btn: btn ? btn.textContent : '', status: st ? st.textContent : '', disabled: !!(btn && btn.disabled), errs: (window.__errs || []).slice() }
  })()`)
}

app.whenReady().then(async () => {
  win = new BrowserWindow({
    width: 1280,
    height: 900,
    show: true,
    webPreferences: {
      preload: path.join(root, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  })
  win.webContents.on('console-message', (event, details) => {
    const msg = details && details.message ? details.message : String(details || '')
    if (/TypeError|devicePhase|Unhandled/.test(msg)) pageErrors.push(msg)
  })
  win.webContents.on('preload-error', (e, p, err) => pageErrors.push(String(err)))
  await win.loadFile(path.join(root, 'index.html'))
  await evalJs(`window.__errs = []; window.addEventListener('unhandledrejection', (e) => { window.__errs.push(String(e.reason && (e.reason.stack || e.reason.message) || e.reason)) })`)
  const booted = await waitFor(`!!document.getElementById('homePage')`, 20000)
  if (!booted) return fail('home page did not render')
  const exported = await evalJs(`typeof window.SCDOMineHome.devicePhase`)
  if (exported !== 'function') return fail('window.SCDOMineHome.devicePhase is ' + exported)

  await evalJs(`(() => {
    localStorage.setItem('mineChainsCpu310', '[]')
    localStorage.setItem('mineChainsGpu310', '[1,2,3,4]')
    const pays = ${JSON.stringify([1, 2, 3, 4].map(addr))}
    pays.forEach((a, i) => localStorage.setItem('minerPayout310-' + (i + 1), a))
  })()`)
  await clickSel('[data-act="nav"][data-v="mine"]')
  const mine = await waitFor(`!!document.getElementById('homeMineCpu') && !!document.getElementById('homeMineGpu')`, 10000)
  if (!mine) return fail('bookkeeping page did not open')

  const cpuBefore = await clickSel('#homeMineCpu')
  await sleep(400)
  const cpu = await panel('cpu')
  if (cpu.errs.length || pageErrors.length) return fail('CPU click threw: ' + (cpu.errs.concat(pageErrors)).join(' | '))
  if (!cpu.status.includes('請先選擇要記帳的鏈')) return fail('CPU hint missing: ' + JSON.stringify(cpu) + ' before=' + cpuBefore.text)
  if (!cpu.btn.includes('開始記帳')) return fail('CPU button changed: ' + cpu.btn)
  if (cpu.btn.includes('正在停止') || cpu.status.includes('正在停止')) return fail('CPU stuck stopping: ' + JSON.stringify(cpu))
  if (starts.length) return fail('CPU start with no chain invoked bookkeeping node:start')

  win.webContents.send('miner:classic', {
    chain: 'classic', mode: 'gpu', running: true, phase: 'syncing', code: 'CLASSIC_SYNCING',
    backend: 'classic-node', procs: ['zminer-gpu'], shards: []
  })
  const stopBtn = await waitFor(`(document.getElementById('homeMineGpu') || {}).textContent && document.getElementById('homeMineGpu').textContent.indexOf('停止記帳') >= 0`, 4000)
  if (!stopBtn) return fail('GPU did not offer stop while status still listed a process: ' + JSON.stringify(await panel('gpu')))
  await clickSel('#homeMineGpu')
  const yes = await waitFor(`!!document.getElementById('cbYes')`, 3000)
  if (!yes) return fail('stop confirm did not open: ' + JSON.stringify(await panel('gpu')))
  const stopClick = Date.now()
  await clickSel('#cbYes')
  const stopped = await waitFor(`(() => {
    const b = document.getElementById('homeMineGpu')
    const s = document.querySelector('[data-dev-status="gpu"]')
    return b && b.textContent.indexOf('開始記帳') >= 0 && s && s.textContent.indexOf('已停止') >= 0 && b.textContent.indexOf('正在停止') < 0
  })()`, 2500)
  const idleMs = Date.now() - stopClick
  if (!stopped) return fail('idle GPU stop did not reach 已停止 in ' + idleMs + 'ms: ' + JSON.stringify(await panel('gpu')) + ' stops=' + JSON.stringify(stops))
  if (idleMs > 2000) return fail('idle GPU stop took ' + idleMs + 'ms')
  if (!stops.length || stops[0].ms > 500) return fail('main stop with no child took ' + JSON.stringify(stops))
  if (fleet.childPids().length) return fail('taskkill/stop left a child')

  const gpuErrs = await evalJs(`(window.__errs || []).slice()`)
  if (gpuErrs.length || pageErrors.length) return fail('GPU stop threw: ' + gpuErrs.concat(pageErrors).join(' | '))

  await clickSel('#homeMineGpu')
  await sleep(1500)
  const pids = fleet.childPids()
  if (!starts.length) {
    const info = await evalJs(`JSON.stringify({
      toast: (document.getElementById('toast') || {}).textContent || '',
      chains: localStorage.getItem('mineChainsGpu310'),
      pay: localStorage.getItem('minerPayout310-1'),
      html: (document.getElementById('homeMineGpu') || {}).outerHTML || ''
    })`)
    return fail('GPU start did not call bookkeeping node:start. panel=' + JSON.stringify(await panel('gpu')) + ' ' + info)
  }
  const bad = starts.filter(s => !s.opts || s.opts.gpuMiner !== 'zminer-gpu' || s.opts.backend !== 'gpu')
  if (bad.length) return fail('GPU start was not pool zminer-gpu: ' + JSON.stringify(starts))
  if (pids.length < 4) return fail('expected 4 pool bookkeeping nodes while the node is unsynced, got ' + pids.length + ' starts=' + JSON.stringify(starts.map(s => s.opts && s.opts.shard)))
  const livePanel = await panel('gpu')
  if (livePanel.btn.includes('正在停止')) return fail('GPU showed stopping during start: ' + JSON.stringify(livePanel))

  await clickSel('#homeMineGpu')
  const yes2 = await waitFor(`!!document.getElementById('cbYes')`, 3000)
  if (!yes2) return fail('live stop confirm missing: ' + JSON.stringify(await panel('gpu')))
  const killAt = Date.now()
  await clickSel('#cbYes')
  const done = await waitFor(`(() => {
    const b = document.getElementById('homeMineGpu')
    return b && b.textContent.indexOf('開始記帳') >= 0 && b.textContent.indexOf('正在停止') < 0
  })()`, 2500)
  const killMs = Date.now() - killAt
  if (!done) return fail('live GPU stop stuck: ' + JSON.stringify(await panel('gpu')) + ' ms=' + killMs)
  if (killMs > 2000) return fail('live GPU stop took ' + killMs + 'ms')
  if (fleet.childPids().length) return fail('pool bookkeeping nodes still alive after stop')
  const finalErrs = await evalJs(`(window.__errs || []).slice()`)
  if (finalErrs.length || pageErrors.length) return fail(finalErrs.concat(pageErrors).join(' | '))
  console.log('mine-click-e2e: ok')
  try { await fleet.stop() } catch (e) {}
  app.exit(0)
}).catch((err) => fail(err && err.stack || String(err)))

app.on('window-all-closed', () => {})
