// SCDO Wallet main process (2.0.9: narrow-window header no-wrap; was 2.0.8: light green theme; 2.0.7: mining notifications, pool payout card, stable/beta update channel + installer SHA-256 in About.
// 2.0.6: no black window - software rendering on Windows, window shown on its first painted frame;
// X hides to the tray, Quit only from the tray with a confirmation while mining; stop-mining confirmation; titled windows after an update.
// 2.0.0 rename; 2026-09 upgrade: Electron 44, no `remote`, shard0 EVM + built-in GPU miner)
// 2.0.1 security release: sandboxed renderer (nodeIntegration off, contextIsolation + sandbox on, preload allowlist),
// wallet/keyfile/signing moved to the main process (src/main/walletService.js), shard0 confirm step with address checks,
// external-URL allowlist, miner never restarts itself unless "Keep mining" is on, tray + taskbar overlay badge.
require('./src/main/safeLog') // 2.0.2: EPIPE-safe logging + crash guards, must load first
const { shell, BrowserWindow, app, ipcMain, dialog, session, Notification } = require('electron')
const path = require('path')
const fs = require('fs')
const mineResume = require('./src/main/mineResume')
// 2.0.0 rename: the product is now "SCDO Wallet" (package.json productName), but the Electron user-data folder must stay
// %APPDATA%\ScdoWalletBeta (miner-intent.json, update-state/pending, updater log, miner chain data, Local Storage).
// Electron derives it from productName, so pin it before anything reads it (single-instance lock, updater, miner).
try { app.setPath('userData', path.join(app.getPath('appData'), 'ScdoWalletBeta')) } catch (e) { console.error('userData pin failed', e) }

// 2.0.6 (black window after upgrade/startup): on Windows the page is composited by the same NVIDIA GPU that the built-in
// miner keeps at 100 % (and that builds a ~1 GB DAG right after an update resumes mining). Chromium's GPU process can then
// present nothing for a long time or crash, and Windows shows the window as a black rectangle. The wallet is a plain 2D
// page, so on Windows it now renders in software by default (no GPU use at all). On other platforms hardware rendering stays
// on, but a GPU-process crash or a first paint that never arrives switches the next launches to software rendering.
// Overrides: --scdo-gpu (force hardware) / --scdo-safe-gpu (force software).
const GPU_MODE_FILE = path.join(app.getPath('userData'), 'gpu-mode.json')
function readGpuMode () { try { return JSON.parse(fs.readFileSync(GPU_MODE_FILE, 'utf8')) || {} } catch (e) { return {} } }
function writeGpuMode (patch) {
  try { fs.mkdirSync(path.dirname(GPU_MODE_FILE), { recursive: true }); fs.writeFileSync(GPU_MODE_FILE, JSON.stringify(Object.assign(readGpuMode(), patch, { updatedAt: new Date().toISOString() }), null, 2)) } catch (e) { console.error('gpu-mode write failed', e) }
}
const GPU_SOFTWARE = (() => {
  if (process.argv.includes('--scdo-gpu')) return false
  if (process.argv.includes('--scdo-safe-gpu')) return true
  if (process.platform === 'win32') return true
  return readGpuMode().software === true
})()
if (GPU_SOFTWARE) { try { app.disableHardwareAcceleration() } catch (e) {} }
console.log('startup: rendering mode ' + (GPU_SOFTWARE ? 'software (hardware acceleration off)' : 'hardware'))
app.on('child-process-gone', (e, d) => {
  try {
    console.error('child process gone: type=' + d.type + ' reason=' + d.reason + ' exitCode=' + d.exitCode + (d.name ? ' name=' + d.name : ''))
    if (d.type === 'GPU' && d.reason !== 'clean-exit' && !GPU_SOFTWARE) writeGpuMode({ software: true, reason: 'GPU process ' + d.reason })
  } catch (err) {}
})

// 2.0.1: every ipcMain.handle only answers the wallet's own page (file:// index.html in the main window).
// (2.0.0's 'compileContract' handler, used only by the unused legacy contract page, was removed.)
const APP_INDEX_URL = require('url').pathToFileURL(path.join(__dirname, 'index.html')).href
function trustedSender (e) {
  try {
    const f = e.senderFrame
    return !!(mainWindow && !mainWindow.isDestroyed() && e.sender === mainWindow.webContents && f && f === e.sender.mainFrame && f.url.split('#')[0] === APP_INDEX_URL)
  } catch (err) { return false }
}
const ipcHandleRaw = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel, fn) => ipcHandleRaw(channel, (e, ...args) => {
  if (!trustedSender(e)) { console.error('blocked IPC from untrusted sender', channel); throw new Error('untrusted IPC sender') }
  return fn(e, ...args)
})

// replaces require('electron').remote.dialog used by the 2020 renderer code
// Miner data dir: <userData>/miner, except on Windows when that path has spaces or non-ASCII
// characters (e.g. a Chinese user name) – GPU miners/geth are fragile there, so use
// C:\ProgramData\ScdoWalletBeta\miner (users may create folders there) instead. 2.0.0: path kept on purpose (upgrade compatibility).
function minerDataRoot () {
  const def = path.join(app.getPath('userData'), 'miner')
  if (process.platform !== 'win32' || /^[\x21-\x7e]+$/.test(def)) return def
  const alt = path.join(process.env.ProgramData || 'C:\\ProgramData', 'ScdoWalletBeta', 'miner')
  try { require('fs').mkdirSync(alt, { recursive: true }); return alt } catch (e) { return def }
}

const DISPLAY_VERSION = (() => { try { return require('./package.json').displayVersion || app.getVersion() } catch (e) { return app.getVersion() } })() // 1.1.5b/1.1.6: optional display label from package.json
const BUILD_COMMIT = (() => { try { const b = require('./build-info.json'); return /^[0-9a-f]{7,40}$/.test(String(b.commit || '')) ? String(b.commit) : '' } catch (e) { return '' } })() // 3.0.2: written by scripts/build-info.js before packing
ipcMain.handle('app:info', () => ({ version: app.getVersion(), displayVersion: DISPLAY_VERSION, commit: BUILD_COMMIT, platform: process.platform, arch: process.arch, userData: app.getPath('userData'), updated: justUpdated, lang: uiLang(), softwareRendering: GPU_SOFTWARE }))
ipcMain.handle('app:mem', () => ({ free: os.freemem(), total: os.totalmem() }))
ipcMain.handle('app:titles', () => { refreshTitles(); return true }) // 2.0.6: re-title windows after a language switch
ipcMain.handle('app:updatedSeen', () => { justUpdated = null; refreshTitles(); return true })
// external links: https only, allowlisted hosts only, opened in the system browser (never inside the wallet)
// 3.0.4: plus the official Telegram channel and group, and the support email (exact addresses only)
const EXTERNAL_ALLOW = [/^https:\/\/scdoscan\.io(\/|$)/, /^https:\/\/github\.com\/(rigelminer|SCDOLAB)(\/|$)/, /^https:\/\/t\.me\/(SCDOLabor|SCDOCommunity)$/]
const MAIL_ALLOW = ['mailto:admin@apeccapital.org']
function openExternalSafe (url) {
  let u
  try { u = new URL(String(url)) } catch (e) { return false }
  if (u.protocol === 'mailto:') { if (!MAIL_ALLOW.includes(u.href)) { console.warn('blocked external URL', u.href); return false } shell.openExternal(u.href); return true }
  if (u.protocol !== 'https:' || u.username || u.password) return false
  const href = u.href
  if (!EXTERNAL_ALLOW.some(re => re.test(href))) { console.warn('blocked external URL', href); return false }
  shell.openExternal(href)
  return true
}
ipcMain.handle('shell:openExternal', (e, url) => openExternalSafe(url))

const ScdoClient = require('./src/api/scdoClient')
const createMenu = require('./src/js/menu.js').createMenu
const walletService = require('./src/main/walletService')
const miningService = require('./src/main/miningService')
const { TrayStatus } = require('./src/main/trayStatus')
walletService.register(ipcMain, () => mainWindow)
require('./src/main/remitService').register(ipcMain, walletService.decryptForRemit) // 2.0.12 匯款 sign-in
// 2.0.6: main-process dialogs, window titles and the tray follow the wallet language ('CN' = 繁體中文, 'EN')
function uiLang () { try { return walletService.currentLang() === 'EN' ? 'EN' : 'CN' } catch (e) { return 'CN' } }
const MT = {
  CN: {
    stopTitle: '停止挖礦 — SCDO Wallet', stopMsg: '確定要停止挖礦嗎？停止後將不再獲得出塊獎勵。', stopBtns: ['取消', '停止挖礦'],
    quitTitle: '結束 SCDO Wallet', quitMsg: '挖礦正在進行。確定要結束 SCDO Wallet 嗎？結束後挖礦會停止，將不再獲得出塊獎勵。', quitBtns: ['取消', '結束'],
    updated: '已更新', stopping: '正在停止挖礦 — SCDO Wallet',
    trayHidden: 'SCDO Wallet 仍在背景執行', trayHiddenMsg: '挖礦和節點會繼續執行。要結束錢包，請在系統匣圖示上按右鍵，選「結束」。'
  },
  EN: {
    stopTitle: 'Stop mining — SCDO Wallet', stopMsg: 'Stop mining? You will no longer earn block rewards.', stopBtns: ['Cancel', 'Stop mining'],
    quitTitle: 'Quit SCDO Wallet', quitMsg: 'Mining is running. Quit SCDO Wallet? Mining will stop and you will no longer earn block rewards.', quitBtns: ['Cancel', 'Quit'],
    updated: 'updated', stopping: 'Stopping miner — SCDO Wallet',
    trayHidden: 'SCDO Wallet is still running', trayHiddenMsg: 'Mining and the node keep running. To quit the wallet, right-click the tray icon and choose Quit.'
  }
}
function mt (k) { return (MT[uiLang()] || MT.CN)[k] }
// 2.0.6: Stop-mining confirmation (Mining tab button and tray item). Cancel is the default and the Esc answer.
async function confirmStopMining () {
  const opts = { type: 'question', title: mt('stopTitle'), message: mt('stopMsg'), buttons: mt('stopBtns'), defaultId: 0, cancelId: 0, noLink: true }
  const w = mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() ? mainWindow : null
  const r = w ? await dialog.showMessageBox(w, opts) : await dialog.showMessageBox(opts)
  return r.response === 1
}
function miningNow () {
  const st = miner ? miner.status() : null
  if (st && st.running && (st.mode === 'mine' || st.mode === 'pool')) return true
  return !!((zpowCpu && zpowCpu.wantRunning) || (zpowGpu && zpowGpu.wantRunning))
}
// 2.0.6: window title; after an update it says so ("SCDO Wallet 2.0.6 — 已更新")
let justUpdated = null
function windowTitle () { const name = uiLang() === 'CN' ? 'SCDO 錢包' : 'SCDO Wallet'; return name + ' ' + DISPLAY_VERSION + (justUpdated ? ' — ' + mt('updated') : '') }
function refreshTitles () {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setTitle(windowTitle())
  if (stopWin && !stopWin.isDestroyed()) stopWin.setTitle(mt('stopping'))
  if (tray) { try { tray.setLang(uiLang()) } catch (e) {} }
  // 2.0.10/2.0.11: rebuild native menu bar when language changes (and at startup via createMenu)
  if (mainWindow && !mainWindow.isDestroyed()) createMenu(mainWindow, uiLang())
}
const ASSETS = path.join(__dirname, 'assets')

// ---------------- 1.1.6 auto-update ----------------
const { Updater, CHECK_DELAY_MS, CHECK_INTERVAL_MS } = require('./src/updater')
let updater = null
function getUpdater () {
  if (!updater) updater = new Updater({ currentVersion: app.getVersion(), windowProvider: () => mainWindow, quit: () => requestQuit({ confirm: false, reason: 'update' }), urlProvider: () => updateChannel.manifestUrls(updateChannel.getChannel(settingsStore)) })
  return updater
}
function scheduleAutoCheck () {
  setTimeout(() => { getUpdater().check(false).then(r => { if (r.ok && (r.state === 'available' || r.state === 'required')) getUpdater().send('update:available', { manifest: r.manifest, required: r.state === 'required' }) }) }, CHECK_DELAY_MS)
  setInterval(() => { getUpdater().check(false).then(r => { if (r.ok && (r.state === 'available' || r.state === 'required')) getUpdater().send('update:available', { manifest: r.manifest, required: r.state === 'required' }) }) }, CHECK_INTERVAL_MS)
}
ipcMain.handle('update:check', async (e, manual) => {
  const r = await getUpdater().check(!!manual)
  if (manual) getUpdater().log('check (manual): state=' + r.state)
  return r
})
ipcMain.handle('update:download', async (e, manifest) => {
  const r = await getUpdater().download(manifest, p => getUpdater().send('update:progress', p))
  if (r.ok) getUpdater().send('update:done', { ok: true, file: r.file })
  else getUpdater().send('update:done', { ok: false, error: r.error, errorKind: require('./src/updater').errorKind(r.error) })
  return r
})
ipcMain.handle('update:install', async (e, manifest) => {
  try {
    const r = await getUpdater().download(manifest, p => getUpdater().send('update:progress', p))
    if (!r.ok) return { ok: false, error: r.error, errorKind: require('./src/updater').errorKind(r.error) }
    // 2.0.7: the update (not the user) stops mining -> the 'mining stopped' notification says it is for an update
    return await getUpdater().install(r.file, manifest, { miner: getMiner(), stopMinerVisibly: (p) => { getNotifier().markStopReason('update'); return stopMinerVisibly(p) } })
  } catch (err) { return { ok: false, error: err.message } }
})
ipcMain.handle('update:skip', (e, version) => { if (typeof version !== 'string' || !/^[0-9A-Za-z.-]{1,40}$/.test(version)) return { ok: false }; getUpdater().state.skipVersion = version; getUpdater()._saveState(); getUpdater().log('user skipped version ' + version); return { ok: true } })

// ---------------- 2.0.7 settings store, update channel (P3), mining notifications (P1), pool payouts (P2) ----------------
// The wallet's main-process settings file is <userData>/miner-intent.json (mining mode, pool, Keep mining; fsync'd writes).
// 2.0.7 keeps the notification toggles ("miningNotifications") and the update channel ("updateChannel") there as well.
const settingsStore = {
  get: (k, d) => { const it = readIntent() || {}; return it[k] === undefined ? d : it[k] },
  set: (k, v) => { writeIntent({ [k]: v }); return true }
}
const updateChannel = require('./src/main/updateChannel')
ipcMain.handle('update:getChannel', () => ({ channel: updateChannel.getChannel(settingsStore), channels: updateChannel.CHANNELS }))
ipcMain.handle('update:setChannel', (e, ch) => {
  const r = updateChannel.setChannel(settingsStore, ch)
  if (r.ok) { getUpdater().lastManifest = null; getUpdater().log('update channel set to ' + r.channel + ' (' + updateChannel.manifestUrls(r.channel).join(', ') + ')') }
  return r
})
ipcMain.handle('about:buildHash', async () => {
  try {
    return await updateChannel.buildHashInfo({ version: app.getVersion(), platform: process.platform, userData: app.getPath('userData'), manifest: getUpdater().lastManifest, fetchText: (u) => miningService.httpsGetText(u, 10000, 64 * 1024) })
  } catch (err) { return { version: app.getVersion(), sha256: null, source: null, error: err.message } }
})
const { MiningNotifier } = require('./src/main/miningNotifier')
let notifier = null
const liveNotes = new Set() // keep shown notifications referenced until closed (click handler)
function getNotifier () {
  if (!notifier) {
    notifier = new MiningNotifier({
      store: settingsStore,
      lang: () => uiLang(),
      notify: (n) => {
        try { getMiner().log('wallet', 'notification: ' + n.type) } catch (e) {}
        if (!Notification.isSupported()) return
        const x = new Notification({ title: n.title, body: n.body, icon: path.join(ASSETS, 'icon-256.png') })
        liveNotes.add(x)
        x.on('click', () => { if (n.url) openExternalSafe(n.url); else if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus() } })
        x.on('close', () => liveNotes.delete(x))
        setTimeout(() => liveNotes.delete(x), 10 * 60 * 1000)
        x.show()
      }
    })
  }
  return notifier
}
ipcMain.handle('notify:get', () => ({ config: getNotifier().config(), labels: getNotifier().labels() }))
ipcMain.handle('notify:set', (e, type, on) => getNotifier().setToggle(String(type), !!on))
ipcMain.handle('pool:account', (e, addr) => miningService.poolAccount(addr))
// payout notifications: while pool-mining on the official SCDO pool, read the pool account every 2 minutes
const lastPayoutTx = {}
async function pollPayout () {
  try {
    const st = miner ? miner.status() : null
    if (!st || !miningNow() || st.mode !== 'pool' || !miningService.isOfficialPool(st.poolUrl) || !st.wallet) return
    const r = await miningService.poolAccount(st.wallet)
    if (!r || !r.ok || !r.known || !r.lastPayout) return
    const k = st.wallet.toLowerCase()
    if (lastPayoutTx[k] === undefined) { lastPayoutTx[k] = r.lastPayout.tx; return } // first read this session: remember only
    if (lastPayoutTx[k] !== r.lastPayout.tx) { lastPayoutTx[k] = r.lastPayout.tx; getNotifier().onPayout({ amount: r.lastPayout.amount, tx: r.lastPayout.tx }) }
  } catch (e) {}
}
setInterval(pollPayout, 2 * 60 * 1000)

// ---------------- built-in miners ----------------
// Shard0: Ethash GPU (geth + scdo-stratum + Rigel).
// Classic shards 1–4: zminer CPU to the pool, and the go-scdo CUDA node (libcudart.dll beside node.exe; no goGpuDet.dll).
// Shard 1 pool is 82.223.19.88:3341. Shards 2–4 use 3342–3344.
// Shard0 GPU, Classic GPU and Classic CPU may all run together. Nothing here refuses a start.
const { MinerManager } = require('./src/miner/manager')
const { ZpowManager } = require('./src/miner/zpow/manager')
function minerBinDir () {
  if (app.isPackaged) return path.join(process.resourcesPath, 'miner', 'bin')
  return path.join(__dirname, 'miner-bin', process.platform)
}
let miner = null
let zpowCpu = null
let zpowGpu = null
function zpowOptions () {
  return {
    binDir: minerBinDir(),
    dataRoot: (!app.isPackaged && process.env.SCDO_MINER_DIR) || minerDataRoot(),
    root: __dirname
  }
}
function classicNote () {
  const parts = []
  const shardOf = (z) => { const n = Number(z && z.state && z.state.shard); return n >= 1 && n <= 4 ? ' Shard' + n : '' }
  if (zpowCpu && zpowCpu.wantRunning) parts.push((uiLang() === 'CN' ? 'Classic 處理器礦池' : 'Classic processor pool') + shardOf(zpowCpu))
  if (zpowGpu && zpowGpu.wantRunning) parts.push((uiLang() === 'CN' ? 'Classic 顯示卡' : 'Classic graphics card') + shardOf(zpowGpu))
  return parts.join(' · ')
}
function refreshTray () {
  if (!tray) return
  const st = miner ? Object.assign({}, miner.status()) : { running: false }
  const note = classicNote()
  if (note) st.classicNote = note
  tray.update(st)
}
function publishClassic (st) {
  refreshTray()
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('miner:classic', st)
}
function getZpow (kind) {
  if (kind === 'cpu') {
    if (!zpowCpu) {
      zpowCpu = new ZpowManager(zpowOptions())
      zpowCpu.on('status', st => publishClassic(st))
    }
    return zpowCpu
  }
  if (!zpowGpu) {
    zpowGpu = new ZpowManager(zpowOptions())
    zpowGpu.on('status', st => publishClassic(st))
  }
  return zpowGpu
}
function idleClassic (mode) {
  return { chain: 'classic', mode, running: false, code: 'IDLE', phase: 'idle' }
}
function classicSnapshot () {
  return {
    classicCpu: zpowCpu ? zpowCpu.status() : idleClassic('cpu'),
    classicGpu: zpowGpu ? zpowGpu.status() : idleClassic('gpu')
  }
}
async function stopClassic (backend) {
  const jobs = []
  if ((!backend || backend === 'cpu') && zpowCpu && zpowCpu.wantRunning) jobs.push(zpowCpu.stop())
  if ((!backend || backend === 'gpu') && zpowGpu && zpowGpu.wantRunning) jobs.push(zpowGpu.stop())
  await Promise.all(jobs)
}
function getMiner () {
  if (!miner) {
    const res = app.isPackaged ? path.join(process.resourcesPath, 'miner') : path.join(__dirname, 'miner-bin')
    miner = new MinerManager({
      binDir: minerBinDir(),
      genesis: path.join(res, 'scdo-shard0-genesis.json'),
      // 1.1.5b: test-only overrides, honoured only in a development run (never in the installed app)
      dataRoot: (!app.isPackaged && process.env.SCDO_MINER_DIR) || minerDataRoot(),
      rigelExe: !app.isPackaged ? (process.env.SCDO_RIGEL_EXE || undefined) : undefined,
      keepMining: () => !!(readIntent() || {}).keepMining // 2.0.1: respawn only when the user turned on "Keep mining"
    })
    miner.on('status', st => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('miner:status', st)
      refreshTray()
      try { getNotifier().onStatus(st) } catch (e) { console.error('notifier', e) } // 2.0.7 (P1)
      if (st && st.running && st.mode === 'pool' && st.wallet && lastPayoutTx[st.wallet.toLowerCase()] === undefined && !pollPayout.started) { pollPayout.started = true; setTimeout(() => { pollPayout.started = false; pollPayout() }, 15000) }
    })
    miner.on('block', h => { try { getNotifier().onBlock(h) } catch (e) {} })
  }
  return miner
}
// ---- 1.1.5: mining on/off intent lives in the main process (written to disk at once, fsync) ----
// 1.1.1-1.1.4 kept it in renderer localStorage, which Chromium flushes lazily: a Stop click followed by a kill
// could be lost, and the next launch started mining again.
function intentPath () { return path.join(app.getPath('userData'), 'miner-intent.json') }
function readIntent () { try { return JSON.parse(fs.readFileSync(intentPath(), 'utf8')) } catch (e) { return null } }
function writeIntent (patch) {
  const next = Object.assign({}, readIntent() || {}, patch, { updatedAt: new Date().toISOString() })
  const f = intentPath(); const tmp = f + '.tmp'
  try {
    fs.mkdirSync(path.dirname(f), { recursive: true })
    const fd = fs.openSync(tmp, 'w')
    try { fs.writeSync(fd, JSON.stringify(next, null, 2)); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
    fs.renameSync(tmp, f)
  } catch (e) { console.error('miner intent write failed', e) }
  return next
}

// ---- 1.1.5: startup cleanup of the wallet's own leftover geth / proxy / rigel ----
let startupCleanup = null
function afterCleanup () { return startupCleanup ? startupCleanup.catch(() => {}) : Promise.resolve() }

// ---- 1.1.5: visible "stopping" window while the miner shuts down (Stop button and quit) ----
let stopWin = null
function showStopWindow (parent) {
  if (stopWin && !stopWin.isDestroyed()) return stopWin
  const useParent = parent && !parent.isDestroyed() && parent.isVisible() ? parent : undefined
  stopWin = new BrowserWindow({
    width: 600, height: 250, resizable: false, minimizable: false, maximizable: false, closable: false, fullscreenable: false,
    alwaysOnTop: true, title: mt('stopping'), backgroundColor: '#ffffff', parent: useParent, modal: !!useParent, show: false,
    autoHideMenuBar: true, icon: path.join(ASSETS, process.platform === 'win32' ? 'icon.ico' : 'icon-256.png'),
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }
  })
  stopWin.setMenu(null)
  stopWin.loadFile(uiLang() === 'CN' ? 'stopping-zh.html' : 'stopping.html')
  stopWin.on('page-title-updated', (e) => e.preventDefault())
  stopWin.once('ready-to-show', () => { if (stopWin && !stopWin.isDestroyed()) stopWin.show() })
  setTimeout(() => { if (stopWin && !stopWin.isDestroyed() && !stopWin.isVisible()) stopWin.show() }, 800)
  stopWin.on('closed', () => { stopWin = null })
  return stopWin
}
function closeStopWindow () { if (stopWin && !stopWin.isDestroyed()) { stopWin.setClosable(true); stopWin.destroy() } stopWin = null }
function minerActive () {
  if ((zpowCpu && zpowCpu.wantRunning) || (zpowGpu && zpowGpu.wantRunning)) return true
  if (!miner) return false
  return !!(miner.wantRunning || miner.stopping || miner.cleaning || Object.values(miner.procs).some(Boolean))
}
async function stopMinerVisibly (parent) {
  if (!minerActive()) { if (miner) await miner.stop(); return }
  const w = showStopWindow(parent)
  const t0 = Date.now()
  try { await miner.stop() } finally {
    const left = 1200 - (Date.now() - t0); if (left > 0) await new Promise(resolve => setTimeout(resolve, left)) // never just flash
    if (stopWin === w && !quitPromise) closeStopWindow()
  }
}

ipcMain.handle('miner:start', async (e, wallet, opts) => {
  opts = opts || {}
  if (opts.chain === 'classic' || opts.backend === 'cpu' || opts.backend === 'gpu') {
    const backend = opts.backend === 'gpu' ? 'gpu' : 'cpu'
    try {
      await getZpow(backend).start(wallet, Object.assign({}, opts, { chain: 'classic', backend }))
      const cfgNow = readIntent() || {}
      const runPatch = backend === 'cpu' ? { runningCpu: true } : { runningClassicGpu: true }
      if (cfgNow.keepMining) runPatch.autoResume = true
      writeIntent(runPatch)
      refreshTray()
      return { ok: true }
    } catch (err) {
      try { getMiner().log('wallet', 'classic ' + backend + ' start failed: ' + (err && err.code ? err.code + ' ' : '') + (err && err.message || err)) } catch (e) {}
      return { ok: false, error: err.message, code: err.code }
    }
  }
  const cfg = readIntent() || {}
  const mode = opts.mode === 'node' ? 'node' : (cfg.miningMode === 'pool' ? 'pool' : 'mine')
  const startOpts = { mode, payout: opts.payout }
  if (mode === 'pool') startOpts.poolUrl = cfg.poolUrl
  await afterCleanup()
  try {
    await getMiner().start(wallet, startOpts)
    // 2.0.1: autoResume (start again on the next launch) only when the user turned on "Keep mining"
    writeIntent(Object.assign({ autoResume: !!cfg.keepMining, runningShard0: mode !== 'node', mode: mode === 'node' ? 'node' : 'mine' }, mode !== 'node' ? { reward: wallet } : { payout: opts.payout || null }))
    if (tray) tray.rebuild()
    return { ok: true }
  } catch (err) {
    try { getMiner().log('wallet', 'start failed: ' + (err && err.message || err)) } catch (e) {}
    if (err.code === 'NO_NVIDIA') writeIntent({ autoResume: false })
    return { ok: false, error: err.message, code: err.code }
  }
})
ipcMain.handle('miner:intent', () => readIntent())
ipcMain.handle('miner:intentClear', () => writeIntent({ autoResume: false }))
ipcMain.handle('miner:clearRunning', () => writeIntent(mineResume.clearedRunning(readIntent() || {})))
// one-time migration of the 1.1.1-1.1.4 localStorage values (only when no intent file exists yet)
ipcMain.handle('miner:intentMigrate', (e, ls) => {
  if (readIntent()) return readIntent()
  ls = ls || {}
  const addr = v => (/^0x[0-9a-fA-F]{40}$/.test(v || '') ? v : null)
  return writeIntent({ autoResume: ls.autoResume === '1', mode: ls.mode === 'node' ? 'node' : 'mine', reward: addr(ls.reward), payout: addr(ls.payout), migratedFrom: 'localStorage' })
})
ipcMain.handle('miner:otherRigels', async () => { await afterCleanup(); try { return await getMiner().otherRigels() } catch (err) { return [] } })
// everything the renderer needs to decide about auto-resume on launch
ipcMain.handle('miner:resumeCheck', async () => {
  await afterCleanup()
  const it = readIntent() || {}
  const m = getMiner()
  let gpuOk = !app.isPackaged && !!process.env.SCDO_RIGEL_EXE // test hook (development runs only, 1.1.5b): a stand-in miner exe, no GPU check (same as MinerManager.start)
  if (!gpuOk && it.mode !== 'node') { try { gpuOk = !!(await m.gpu()).nvidia } catch (e) {} }
  let others = []
  if (it.autoResume && it.mode !== 'node') { try { others = await m.otherRigels() } catch (e) {} }
  // 2.0.1: resume on launch only when BOTH the last state was "on" and "Keep mining" is enabled (default off)
  // 2.0.5: ...or once right after an update that stopped a running miner (resumeOnce, written by the updater), so an
  // update always gives back the mining state the user had, whatever "Keep mining" says
  const once = !!it.resumeOnce
  if (once) writeIntent({ resumeOnce: false })
  const autoResume = !!((it.autoResume && it.keepMining) || once)
  return { autoResume, mode: it.mode || 'mine', reward: it.reward || null, payout: it.payout || null, gpuOk, otherRigels: others, running: m.wantRunning, resume: autoResume ? (it.resume || null) : { cpu: false, classicGpu: false, shard0: false } }
})
ipcMain.handle('miner:gpu', async () => { try { return await getMiner().gpu() } catch (err) { return { nvidia: false, names: [], error: err.message } } })
ipcMain.handle('miner:stop', async (e, src) => {
  if (src && typeof src === 'object' && src.chain === 'classic') {
    const backend = optsBackend(src)
    try {
      await stopClassic(backend)
      writeIntent(mineResume.afterStop(readIntent() || {}, backend === 'gpu' ? 'classicGpu' : 'cpu'))
      refreshTray()
      return { ok: true }
    } catch (err) { return { ok: false, error: err.message } }
  }
  writeIntent(mineResume.afterStop(readIntent() || {}, 'shard0')) // the user's Stop is on disk before anything else happens
  try { getNotifier().markUserStop() } catch (err) {}
  try { getMiner().log('wallet', 'stop requested by the user (' + (src === 'node' ? 'Stop node button' : 'Stop mining button') + ')') } catch (err) {}
  if (miner) await stopMinerVisibly(mainWindow)
  return { ok: true }
})
ipcMain.handle('miner:status', () => getMiner().status())
// 2.0.6: the page asks for the confirmation before it calls miner:stop (only when the miner is really mining)
ipcMain.handle('miner:confirmStop', async () => { if (!miningNow()) return true; return confirmStopMining() })
ipcMain.handle('miner:defender', async () => {
  try { await getMiner().defenderExclusion(); return { ok: true } } catch (err) { return { ok: false, error: err.message } }
})
ipcMain.handle('miner:openLogs', () => shell.openPath(path.join(getMiner().o.dataRoot, 'logs')))
ipcMain.handle('miner:caps', () => { try { return getZpow('cpu').capabilities() } catch (err) { return { cpu: { available: false }, gpu: { available: false }, error: err.message } } })
ipcMain.handle('miner:classicStatus', () => classicSnapshot())
function optsBackend (src) { return src && src.backend === 'gpu' ? 'gpu' : 'cpu' }

// ---------------- 2.0.1 mining batch 1 ----------------
ipcMain.handle('mining:gpuPreflight', async () => { let g = null; try { g = await getMiner().gpu() } catch (e) {} return miningService.gpuPreflight(g) })
ipcMain.handle('mining:gpuTemp', async () => { try { return await miningService.gpuTemperature() } catch (err) { return { ok: false, gpus: [], error: err.message } } })
ipcMain.handle('mining:networkStats', async () => {
  const st = miner ? miner.status() : null
  const lh = st && st.running && (st.mode === 'mine' || st.mode === 'pool') ? st.hashrate : 0
  try { return Object.assign({ ok: true }, await miningService.networkStats(lh)) } catch (err) { return { ok: false, error: err.message } }
})
ipcMain.handle('mining:exportLogs', () => miningService.exportLogs(mainWindow, getMiner(), { version: app.getVersion() }))
ipcMain.handle('mining:getConfig', () => { const it = readIntent() || {}; return { miningMode: it.miningMode === 'pool' ? 'pool' : 'solo', poolUrl: it.poolUrl || '', keepMining: !!it.keepMining } })
ipcMain.handle('mining:setConfig', (e, cfg) => {
  cfg = cfg || {}
  const mode = cfg.miningMode === 'pool' ? 'pool' : 'solo'
  let poolUrl = ''
  if (mode === 'pool') { poolUrl = MinerManager.validPoolUrl(cfg.poolUrl); if (!poolUrl) return { ok: false, error: 'BAD_POOL' } }
  writeIntent({ miningMode: mode, poolUrl: poolUrl || (readIntent() || {}).poolUrl || '' })
  return { ok: true, miningMode: mode, poolUrl }
})
ipcMain.handle('mining:setKeepMining', (e, on) => setKeepMining(!!on))
function setKeepMining (on) {
  writeIntent({ keepMining: on, autoResume: on && !!(miner && miner.wantRunning) })
  if (tray) tray.rebuild()
  if (miner) miner.emit('status', miner.status())
  return { ok: true, keepMining: on }
}

// ---------------- 2.0.1 tray + taskbar overlay ----------------
let tray = null
function createTray () {
  if (tray) return
  try {
    tray = new TrayStatus({
      assetsDir: ASSETS,
      version: DISPLAY_VERSION,
      getWindow: () => mainWindow,
      isMinerActive: () => minerActive(),
      getKeepMining: () => !!(readIntent() || {}).keepMining,
      onKeepMining: (on) => setKeepMining(on),
      lang: uiLang(),
      onStop: async () => {
        if (miningNow() && !(await confirmStopMining())) { try { getMiner().log('wallet', 'tray Stop mining: cancelled by the user') } catch (err) {} return }
        writeIntent(mineResume.afterStop(readIntent() || {}, 'all')); try { getNotifier().markUserStop() } catch (err) {} try { getMiner().log('wallet', 'stop requested by the user (tray menu)') } catch (err) {}
        if (miner && miner.wantRunning) await stopMinerVisibly(mainWindow)
        try { await stopClassic() } catch (err) { console.error('classic stop failed', err) }
        refreshTray()
      },
      onQuit: () => requestQuit({ confirm: true, reason: 'tray' })
    })
    refreshTray()
  } catch (e) { console.error('tray failed', e) }
}

// ---------------- keyfile backup + delete (1.1.2) ----------------
// Never lose a keyfile: copy it to Documents\ScdoWallet\備份\<YYYY-MM-DD>\, read the copy back and compare
// SHA-256 with the original, and only then remove the original. Any failure aborts before deletion.
const crypto = require('crypto')
const os = require('os')
// 2.0.3: the folder name is Traditional Chinese (備份). An existing 1.1.2-2.0.2 folder (Simplified name) is renamed once;
// if it cannot be renamed (locked, sync client), the old folder keeps being used so no backup is ever split or lost.
let _backupRoot = null
function backupRoot () {
  if (_backupRoot) return _backupRoot
  const base = path.join(app.getPath('documents'), 'ScdoWallet')
  const now = path.join(base, '\u5099\u4efd'), legacy = path.join(base, '\u5907\u4efd')
  try {
    if (fs.existsSync(legacy) && !fs.existsSync(now)) {
      try { fs.renameSync(legacy, now) } catch (e) { console.error('backup folder rename failed, keeping old name', e && e.message); return (_backupRoot = legacy) }
    }
  } catch (e) {}
  return (_backupRoot = now)
}
function keyfileDir () { return path.join(os.homedir(), '.ScdoWallet', 'account') }
function localDate () { const d = new Date(); const z = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()) }
function sha256 (buf) { return crypto.createHash('sha256').update(buf).digest('hex') }
function safeKeyfileName (name) {
  if (typeof name !== 'string' || !name || name !== path.basename(name) || name === '.' || name === '..' || /[\\/]/.test(name)) throw new Error('invalid keyfile name')
  return name
}
function backupKeyfile (name) {
  name = safeKeyfileName(name)
  const src = path.join(keyfileDir(), name)
  const orig = fs.readFileSync(src)
  const dir = path.join(backupRoot(), localDate())
  fs.mkdirSync(dir, { recursive: true })
  let dst = path.join(dir, name); let i = 1
  while (fs.existsSync(dst)) dst = path.join(dir, name + '.' + (i++))
  const fd = fs.openSync(dst, 'wx', 0o600)
  try { fs.writeSync(fd, orig); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  const back = fs.readFileSync(dst)
  if (back.length !== orig.length || sha256(back) !== sha256(orig)) throw new Error('backup verification failed – keyfile NOT deleted')
  return { src, dst, sha256: sha256(orig) }
}
ipcMain.handle('keyfile:paths', () => ({ backupRoot: backupRoot(), keyfileDir: keyfileDir(), today: path.join(backupRoot(), localDate()) }))
ipcMain.handle('keyfile:backupDelete', (e, name) => {
  let b
  try { b = backupKeyfile(name) } catch (err) { return { ok: false, stage: 'backup', error: err.message } }
  try { fs.unlinkSync(b.src) } catch (err) { return { ok: false, stage: 'delete', error: err.message, backup: b.dst } }
  return { ok: true, backup: b.dst, sha256: b.sha256 }
})
ipcMain.handle('keyfile:backupOnly', (e, name) => {
  try { const b = backupKeyfile(name); return { ok: true, backup: b.dst } } catch (err) { return { ok: false, error: err.message } }
})
ipcMain.handle('keyfile:openBackups', () => { fs.mkdirSync(backupRoot(), { recursive: true }); return shell.openPath(backupRoot()) })
ipcMain.handle('menu:rebuild', () => { if (mainWindow) createMenu(mainWindow, uiLang()); return true })

let mainWindow

// Our RPC proxies (scdoscan.io/rpc/N) send Access-Control-Allow-Origin twice ("*, *"), which
// Chromium rejects; normalise the header for the wallet's own RPC traffic.
function fixCors () {
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    const h = details.responseHeaders || {}
    for (const k of Object.keys(h)) {
      if (k.toLowerCase() === 'access-control-allow-origin') delete h[k]
    }
    h['Access-Control-Allow-Origin'] = ['*']
    h['Access-Control-Allow-Headers'] = ['Content-Type']
    cb({ responseHeaders: h })
  })
}

function createWindow () {
  const sc = new ScdoClient()
  sc.init()
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    backgroundColor: '#E8F5E9',
    icon: path.join(ASSETS, process.platform === 'win32' ? 'icon.ico' : 'icon-256.png'),
    resizable: true,
    title: windowTitle(),
    // 2.0.6: shown on the first painted frame (the page paints its loading screen at once), never as an empty surface
    show: false,
    webPreferences: {
      // 2.0.1: no Node.js in the page. The UI talks to the main process only through preload.js (allowlisted IPC).
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      spellcheck: false
    }
  })
  mainWindow.loadFile('index.html')
  const t0 = Date.now()
  let shown = false
  const showMain = (why) => {
    if (shown || !mainWindow || mainWindow.isDestroyed()) return
    shown = true
    if (!startHidden) mainWindow.show()
    console.log('startup: main window ' + (startHidden ? 'ready (kept in tray)' : 'shown') + ' after ' + (Date.now() - t0) + ' ms (' + why + ')')
  }
  mainWindow.once('ready-to-show', () => showMain('first frame painted'))
  // never leave the user without a window: show it after 3 s whatever happened, and remember a missing first paint
  setTimeout(() => {
    if (!shown) {
      console.error('startup: no first paint after 3 s' + (GPU_SOFTWARE ? '' : ' - next launches use software rendering'))
      if (!GPU_SOFTWARE) writeGpuMode({ software: true, reason: 'no first paint within 3 s' })
      showMain('3 s fallback')
    }
  }, 3000)
  mainWindow.on('page-title-updated', (e) => e.preventDefault()) // 2.0.6: the title is set here (version, "updated")
  mainWindow.webContents.on('render-process-gone', (e, d) => { console.error('renderer gone: ' + d.reason + ' exitCode=' + d.exitCode); setTimeout(() => { try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload() } catch (err) {} }, 1000) })
  mainWindow.webContents.on('unresponsive', () => console.error('renderer unresponsive'))
  // the page may never navigate away from index.html; external links go to the allowlisted system browser
  const guardNav = (e, url) => { if (String(url).split('#')[0] !== APP_INDEX_URL) { e.preventDefault(); openExternalSafe(url) } }
  mainWindow.webContents.on('will-navigate', guardNav)
  mainWindow.webContents.on('will-redirect', guardNav)
  mainWindow.webContents.on('will-frame-navigate', (e) => { if (!e.isMainFrame) e.preventDefault() })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { openExternalSafe(url); return { action: 'deny' } })
  mainWindow.webContents.on('will-attach-webview', (e) => e.preventDefault())
  mainWindow.webContents.once('did-finish-load', () => { if (tray) tray.reapply() })
  // 2.0.6: the window's X (and Ctrl+W) only hides the wallet to the tray; mining and the node keep running.
  // Quitting is done from the tray menu (Quit, with a confirmation while mining), by an update, or by Windows shutdown.
  mainWindow.on('close', (e) => {
    if (quitting || readyToQuit) return
    e.preventDefault()
    if (!tray) { requestQuit({ confirm: true, reason: 'window close without tray' }); return }
    mainWindow.hide()
    try { getMiner().log('wallet', 'main window closed by the user: hidden to the tray, mining/node unchanged') } catch (err) {}
    if (!hintShown && process.platform === 'win32' && tray.balloon) { hintShown = true; tray.balloon(mt('trayHidden'), mt('trayHiddenMsg')) }
  })
  mainWindow.on('session-end', () => { quitting = true; try { getNotifier().markUserStop() } catch (e) {} }) // Windows log-off / shutdown (no 'mining stopped' notification)
  mainWindow.on('closed', () => { mainWindow = null })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else if (process.argv.includes('--scdo-quit')) {
  // 2.0.6: the installer helper's quit request found no running wallet - never start a wallet for it
  app.exit(0)
} else {
  app.on('second-instance', (e, argv) => {
    // 2.0.6: the installer / uninstaller helper asks a running wallet to quit gracefully (the X button only hides it now)
    if (Array.isArray(argv) && argv.includes('--scdo-quit')) { console.log('quit requested by the installer helper'); requestQuit({ confirm: false, reason: 'installer' }); return }
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus() }
  })
  app.whenReady().then(() => {
    if (process.platform === 'win32') { try { app.setAppUserModelId('io.scdoscan.scdowallet') } catch (e) {} } // 2.0.7: Windows toast notifications (same id as the installer shortcut)
    fixCors()
    session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(perm === 'clipboard-sanitized-write'))
    session.defaultSession.setPermissionCheckHandler((wc, perm) => perm === 'clipboard-sanitized-write')
    app.on('web-contents-created', (e, wc) => {
      wc.setWindowOpenHandler(({ url }) => { openExternalSafe(url); return { action: 'deny' } })
      wc.on('will-attach-webview', (ev) => ev.preventDefault())
    })
    // 1.1.5: stop the wallet's own miner processes left over from an earlier session (never other Rigel/geth)
    startupCleanup = getMiner().cleanupStale().catch(err => { console.error('miner cleanup failed', err); return [] })
    // 1.1.6: apply any completed-update marker from a previous run (log + restore mining intent)
    const ra = getUpdater().resumeAfterUpdate()
    if (ra && ra.applied) justUpdated = { version: ra.version, wasMining: !!ra.wasMining }
    createWindow()
    createMenu(mainWindow, uiLang())
    createTray()
    // 1.1.6: first update check 1 minute after launch, then every 6 hours
    scheduleAutoCheck()
  })
}

// 1.1.5: quitting while the miner runs (or is stopping / cleaning up) keeps a visible "Stopping miner, saving chain
// data" window until rigel, proxy and geth have exited, and only then quits. A clean quit clears the running flags.
// Auto-resume, when it is explicitly on, keeps a snapshot of what was running so the next launch can start only that.
let readyToQuit = false
let quitPromise = null
let quitting = false // 2.0.6: set once a real quit was decided (tray Quit, update, installer, shutdown)
let hintShown = false
const startHidden = process.argv.includes('--scdo-hidden')
// 2.0.6: the one way to quit. confirm=true asks first while mining (Cancel is the default).
async function requestQuit ({ confirm, reason } = {}) {
  if (quitPromise) return quitPromise
  if (confirm && miningNow()) {
    const opts = { type: 'question', title: mt('quitTitle'), message: mt('quitMsg'), buttons: mt('quitBtns'), defaultId: 0, cancelId: 0, noLink: true }
    const w = mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() ? mainWindow : null
    const r = w ? await dialog.showMessageBox(w, opts) : await dialog.showMessageBox(opts)
    if (r.response !== 1) { try { getMiner().log('wallet', 'quit cancelled by the user (' + reason + ')') } catch (e) {} return }
  }
  quitting = true
  try { writeIntent(mineResume.afterQuit(readIntent() || {})) } catch (e) { console.error('clear running flags on quit failed', e) }
  try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('menu:action', 'clearMineRunning') } catch (e) {}
  // 2.0.7: a quit stops mining on purpose; only an update quit is reported as "paused for an update"
  try { if (reason === 'update') getNotifier().markStopReason('update'); else getNotifier().markUserStop() } catch (e) {}
  try { if (miner) getMiner().log('wallet', 'quit (' + (reason || 'app') + ')') } catch (e) {}
  if (minerActive()) return gracefulQuit(reason)
  readyToQuit = true
  app.quit()
}
// 2.0.6 ('prbo' popup): an update/installer quit used to open a separate always-on-top 'Stopping miner' window on its own
// while the main window was hidden; users closed it as a blank window. Those quits now stop the miner silently (same graceful stop).
function gracefulQuit (reason) {
  if (quitPromise) return quitPromise
  const silent = reason === 'update' || reason === 'installer'
  quitPromise = (async () => {
    if (stopWin && !stopWin.isDestroyed() && (silent || stopWin.getParentWindow())) closeStopWindow() // re-open it on its own: the main window is hidden next
    if (!silent) showStopWindow()
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide()
    const t0 = Date.now()
    try { await afterCleanup(); if (miner) await miner.stop(); await stopClassic() } catch (e) { console.error('stop on quit failed', e) }
    const left = 1200 - (Date.now() - t0); if (left > 0) await new Promise(resolve => setTimeout(resolve, left))
    readyToQuit = true
    closeStopWindow()
    app.quit()
  })()
  return quitPromise
}
app.on('before-quit', (e) => {
  if (readyToQuit) return
  if (quitting) { if (!minerActive()) { readyToQuit = true; return } e.preventDefault(); gracefulQuit(); return }
  // anything else (e.g. Cmd+Q on macOS) goes through the same confirmation as the tray Quit
  e.preventDefault(); requestQuit({ confirm: true, reason: 'app quit' })
})
// 2.0.1: last line of defence - whatever happened above, no miner child (geth / proxy / rigel) outlives the wallet
function killMinerChildrenSync () {
  const pids = []
  if (miner) pids.push(...miner.childPids())
  for (const z of [zpowCpu, zpowGpu]) if (z) pids.push(...z.childPids())
  for (const pid of pids) {
    try {
      if (process.platform === 'win32') require('child_process').execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 10000 })
      else process.kill(pid, 'SIGKILL')
    } catch (e) {}
  }
}
app.on('will-quit', () => { killMinerChildrenSync(); if (tray) tray.destroy() })
process.on('exit', () => killMinerChildrenSync())

app.on('window-all-closed', function () {
  // 2.0.6: the wallet lives in the tray; it only quits through requestQuit()
  if (quitting && !quitPromise) app.quit()
})

app.on('activate', function () {
  if (mainWindow === null) {
    createWindow()
    createMenu(mainWindow, uiLang())
  } else if (!mainWindow.isDestroyed() && !mainWindow.isVisible()) mainWindow.show()
})
