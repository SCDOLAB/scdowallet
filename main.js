// SCDO Wallet main process (2.0.9: narrow-window header no-wrap; was 2.0.8: light green theme; 2.0.7: mining notifications, pool payout card, stable/beta update channel + installer SHA-256 in About.
// 2.0.6: no black window - software rendering on Windows, window shown on its first painted frame;
// X hides to the tray, Quit only from the tray with a confirmation while mining; stop-mining confirmation; titled windows after an update.
// 2.0.0 rename; 2026-09 upgrade: Electron 44, no `remote`, shard0 EVM + built-in GPU miner)
// 2.0.1 security release: sandboxed renderer (nodeIntegration off, contextIsolation + sandbox on, preload allowlist),
// wallet/keyfile/signing moved to the main process (src/main/walletService.js), shard0 confirm step with address checks,
// external-URL allowlist, miner never restarts itself unless "Keep mining" is on, tray + taskbar overlay badge.
require('./src/main/safeLog') // 2.0.2: EPIPE-safe logging + crash guards, must load first
const { shell, BrowserWindow, app, ipcMain, dialog, session, Notification, powerMonitor } = require('electron')
const path = require('path')
const fs = require('fs')
const mineResume = require('./src/main/mineResume')
const guardHost = require('./src/miner/guardHost')
const pcGuard = require('./src/miner/pcGuard')
const { applyPriority } = require('./src/miner/priority')
const powerHold = require('./src/miner/powerHold')
const { FIRST_RUN } = require('./src/miner/guardPlan')
const { VERSION, checkRuntime } = require('./src/version')
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
function trustedUiUrl (url) {
  const bare = String(url || '').split('#')[0]
  if (bare === APP_INDEX_URL) return true
  try {
    const extra = require('./src/main/uiHost').activeUrl()
    return !!extra && bare === extra
  } catch (e) { return false }
}
function trustedSender (e) {
  try {
    const f = e.senderFrame
    return !!(mainWindow && !mainWindow.isDestroyed() && e.sender === mainWindow.webContents && f && f === e.sender.mainFrame && trustedUiUrl(f.url))
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

const DISPLAY_VERSION = VERSION
const versionCheck = checkRuntime((() => { try { return app.getVersion() } catch (e) { return '' } })())
if (!versionCheck.ok) console.error(versionCheck.error + '; reporting ' + VERSION)
const BUILD_COMMIT = (() => { try { const b = require('./build-info.json'); return /^[0-9a-f]{7,40}$/.test(String(b.commit || '')) ? String(b.commit) : '' } catch (e) { return '' } })() // 3.0.2: written by scripts/build-info.js before packing
ipcMain.handle('app:info', () => ({ version: VERSION, displayVersion: VERSION, commit: BUILD_COMMIT, platform: process.platform, arch: process.arch, userData: app.getPath('userData'), updated: justUpdated, lang: uiLang(), softwareRendering: GPU_SOFTWARE }))
ipcMain.handle('app:mem', () => {
  let free = os.freemem()
  if (process.platform === 'darwin') { const a = require('./src/main/macMem').macAvailable(); if (a != null && a > free) free = a }
  return { free, total: os.totalmem() }
})
ipcMain.handle('app:titles', () => { refreshTitles(); return true }) // 2.0.6: re-title windows after a language switch
ipcMain.handle('app:updatedSeen', () => { justUpdated = null; refreshTitles(); return true })
// external links: https only, allowlisted hosts only, opened in the system browser (never inside the wallet)
// 3.0.4: plus the official Telegram channel and group, and the support email (exact addresses only)
const EXTERNAL_ALLOW = [/^https:\/\/scdoscan\.io(\/|$)/, /^https:\/\/apeccapital\.org(\/|$)/, /^https:\/\/github\.com\/(rigelminer|SCDOLAB)(\/|$)/, /^https:\/\/t\.me\/(SCDOLabor|SCDOCommunity)$/]
const MAIL_ALLOW = ['mailto:admin@apeccapital.org']
// 3.1.6: the home demo wheel and its Telegram group, exact URLs from src/js/demoLinks.js only
const DEMO_LINKS = require('./src/js/demoLinks')
const EXACT_ALLOW = [DEMO_LINKS.DEMO_WHEEL_URL, DEMO_LINKS.TELEGRAM_URL]
// Pay invoice hand-off only. MetaMask and Coinbase dapp links, plus a parsed
// ton: or ethereum: transfer. This does not register those schemes with the OS.
const payInvoice = require('./src/js/payInvoice/parse')
function openExternalSafe (url) {
  const raw = String(url || '').trim()
  if (payInvoice.isHandoffUri(raw) || (payInvoice.isWalletDeepLink(raw) && !/scdoscan\.io/i.test(raw))) {
    try { shell.openExternal(raw); return true } catch (e) { return false }
  }
  let u
  try { u = new URL(raw) } catch (e) { return false }
  if (u.protocol === 'mailto:') { if (!MAIL_ALLOW.includes(u.href)) { console.warn('blocked external URL', u.href); return false } shell.openExternal(u.href); return true }
  if (u.protocol !== 'https:' || u.username || u.password) return false
  const href = u.href
  if (!EXACT_ALLOW.includes(href) && !EXTERNAL_ALLOW.some(re => re.test(href))) { console.warn('blocked external URL', href); return false }
  shell.openExternal(href)
  return true
}
ipcMain.handle('shell:openExternal', (e, url) => openExternalSafe(url))

const ScdoClient = require('./src/api/scdoClient')
const createMenu = require('./src/js/menu.js').createMenu
const walletService = require('./src/main/walletService')
const Join = require('./src/js/agentJoin')
const { createStore, createController } = require('./src/main/agentJoin')
const joinStore = createStore(path.join(app.getPath('userData'), 'agent-join.json'))
const joinCtl = createController({ store: joinStore, agent: () => opsAgent, env: process.env })
const miningService = require('./src/main/miningService')
const { TrayStatus } = require('./src/main/trayStatus')
const sessionMode = require('./src/main/sessionMode')
let sessionLight = false
let sessionOpenedAtLogin = false
walletService.register(ipcMain, () => mainWindow)
require('./src/main/remitService').register(ipcMain, walletService.decryptForRemit) // 2.0.12 匯款 sign-in
// 2.0.6: main-process dialogs, window titles and the tray follow the wallet language ('CN' = 華語繁體, 'EN')
function uiLang () { try { return walletService.currentLang() === 'EN' ? 'EN' : 'CN' } catch (e) { return 'CN' } }
const MT = {
  CN: {
    stopTitle: '停止記帳 — SCDO Wallet', stopMsg: '確定要停止記帳嗎？停止後將不再獲得出塊獎勵。', stopBtns: ['取消', '停止記帳'],
    quitTitle: '結束 SCDO Wallet', quitMsg: '記帳正在進行。確定要結束 SCDO Wallet 嗎？結束後記帳會停止，將不再獲得出塊獎勵。', quitBtns: ['取消', '結束'],
    updated: '已更新', stopping: '正在停止記帳 — SCDO Wallet',
    trayHidden: 'SCDO Wallet 仍在背景執行', trayHiddenMsg: '記帳和節點會繼續執行。要結束錢包，請在系統匣圖示上按右鍵，選「結束」。',
    trayStayNotice: 'SCDO Wallet 仍在系統匣執行，Agent 才會保持在線。要停止請從系統匣選單結束。',
    quitAgentMsg: '結束後 Agent 會離線，獎勵也會暫停。',
    quitAgentQuit: '結束', quitAgentStay: '繼續執行', quitAgentDontAsk: '不要再問'
  },
  EN: {
    stopTitle: 'Stop bookkeeping — SCDO Wallet', stopMsg: 'Stop bookkeeping? You will no longer earn block rewards.', stopBtns: ['Cancel', 'Stop bookkeeping'],
    quitTitle: 'Quit SCDO Wallet', quitMsg: 'Bookkeeping is running. Quit SCDO Wallet? Bookkeeping will stop and you will no longer earn block rewards.', quitBtns: ['Cancel', 'Quit'],
    updated: 'updated', stopping: 'Stopping bookkeeping node — SCDO Wallet',
    trayHidden: 'SCDO Wallet is still running', trayHiddenMsg: 'Bookkeeping and the node keep running. To quit the wallet, right-click the tray icon and choose Quit.',
    trayStayNotice: 'SCDO Wallet is still running in the tray so your agent stays online. Quit from the tray menu to stop.',
    quitAgentMsg: 'Quitting takes your agent offline and pauses rewards.',
    quitAgentQuit: 'Quit', quitAgentStay: 'Keep running', quitAgentDontAsk: "Don't ask again"
  }
}
function mt (k) { return (MT[uiLang()] || MT.CN)[k] }
// Signed wallet-ui.json can replace these keys. Unknown or HTML values stay on the built-in line.
function uiString (key, fallback) {
  const loc = uiLang() === 'EN' ? 'en' : 'zh-Hant'
  let v = null
  try {
    const ui = require('./src/js/walletUi')
    const doc = walletUiDoc || ui.current()
    const pack = doc && doc.strings && doc.strings[loc]
    v = pack && pack[key]
  } catch (e) { v = null }
  if (typeof v === 'string' && v && !/[<>]/.test(v)) return v
  return fallback
}
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
  if (!updater) updater = new Updater({ currentVersion: VERSION, windowProvider: () => mainWindow, quit: () => requestQuit({ confirm: false, reason: 'update' }), urlProvider: () => updateChannel.manifestUrls(updateChannel.getChannel(settingsStore)) })
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
    return await updateChannel.buildHashInfo({ version: VERSION, platform: process.platform, userData: app.getPath('userData'), manifest: getUpdater().lastManifest, fetchText: (u) => miningService.httpsGetText(u, 10000, 64 * 1024) })
  } catch (err) { return { version: VERSION, sha256: null, source: null, error: err.message } }
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
let lastPayoutRead = null
async function pollPayout () {
  try {
    const st = miner ? miner.status() : null
    if (!st || !miningNow() || st.mode !== 'pool' || !miningService.isOfficialPool(st.poolUrl) || !st.wallet) return
    const r = await miningService.poolAccount(st.wallet)
    if (r && r.ok) lastPayoutRead = { at: Date.now(), address: st.wallet, balance: r.balance || null }
    if (!r || !r.ok || !r.known || !r.lastPayout) return
    const k = st.wallet.toLowerCase()
    if (lastPayoutTx[k] === undefined) { lastPayoutTx[k] = r.lastPayout.tx; return } // first read this session: remember only
    if (lastPayoutTx[k] !== r.lastPayout.tx) { lastPayoutTx[k] = r.lastPayout.tx; getNotifier().onPayout({ amount: r.lastPayout.amount, tx: r.lastPayout.tx }) }
  } catch (e) { console.warn('payout poll', e && e.message) }
}
setInterval(pollPayout, 2 * 60 * 1000)

// ---------------- built-in ledger nodes ----------------
// Shard0: Ethash GPU (geth + scdo-stratum + Rigel).
// Classic shards 1–4: zminer CPU to the pool, and zminer-gpu (one process per shard, device 0).
// Solo Classic uses the go-scdo node only when solo was saved and that node is synced.
// 3.1.6: Shard1–4 Classic pools have no built-in host. Remote config (apeccapital.org/wallet/config.json,
// zpowPools) or SCDO_ZPOW_POOLS names them; ports 3341–3344.
// Shard0, Classic graphics card and Classic processor may all run together.
const { MinerManager } = require('./src/miner/manager')
const { ZpowManager, GpuFleet } = require('./src/miner/zpow/manager')
function minerBinDir () {
  if (app.isPackaged) return path.join(process.resourcesPath, 'miner', 'bin')
  return path.join(__dirname, 'miner-bin', process.platform)
}
function zminerGpuDir () {
  if (app.isPackaged) return path.join(process.resourcesPath, 'miners', 'zminer-gpu')
  return path.join(__dirname, 'resources', 'miners', 'zminer-gpu')
}
let miner = null
let zpowCpu = null
let zpowGpu = null
let remoteDoc = null
function guardActive () {
  return (readIntent() || {}).guardSmooth !== false
}
function guardLoopOn () {
  return !!(guardRun && guardRun.started && guardActive())
}
function pinMiner (proc) {
  if (!guardActive() || !proc || !proc.pid) return
  const plan = guardHost.threadPlanCached()
  if (plan && !plan.pending) guardHost.pinProcess(proc.pid, plan)
}
function zpowOptions () {
  return {
    binDir: minerBinDir(),
    gpuDir: zminerGpuDir(),
    dataRoot: (!app.isPackaged && process.env.SCDO_MINER_DIR) || minerDataRoot(),
    root: __dirname,
    lowPriority: () => (readIntent() || {}).lowPriority !== false,
    threadsDefault: () => {
      if (!guardActive()) return null
      const plan = guardHost.threadPlanCached()
      if (!plan || plan.pending) return 1
      return plan.threads
    },
    clampThreads: (n) => {
      if (!guardActive()) return n
      const plan = guardHost.threadPlanCached()
      if (!plan || plan.pending) return 1
      return Math.max(1, Math.min(n, plan.threads))
    },
    onSpawn: (proc) => pinMiner(proc),
    guardOwnsRestart: () => guardLoopOn(),
    remoteConfig: remoteDoc
  }
}
function classicNote () {
  const parts = []
  const cn = uiLang() === 'CN'
  if (zpowCpu && zpowCpu.wantRunning) {
    const n = Number(zpowCpu.state && zpowCpu.state.shard)
    parts.push((cn ? 'Classic 處理器記帳池' : 'Classic processor pool') + (n >= 1 && n <= 4 ? ' Shard' + n : ''))
  }
  if (zpowGpu && zpowGpu.wantRunning) {
    const st = zpowGpu.status()
    const shards = (st.shards || []).map(s => Number(s.shard)).filter(n => n >= 1 && n <= 4)
    const solo = st.backend === 'classic-node'
    const label = solo ? (cn ? 'Classic 顯示卡' : 'Classic graphics card') : (cn ? 'Classic 顯示卡記帳池' : 'Classic graphics card pool')
    parts.push(label + (shards.length ? ' Shard' + shards.join(' ') : ''))
  }
  return parts.join(' · ')
}
function guardSnapshot () {
  const g = guardRun && guardRun.snapshot && guardRun.snapshot()
  return g && (g.active || g.colour === 'grey' || g.colour === 'yellow' || g.colour === 'green' || g.colour === 'red') ? g : null
}
function attachGuard (st) {
  const g = guardSnapshot()
  if (g && st) st.guard = g
  return st
}
function refreshTray () {
  if (!tray) return
  const st = miner ? Object.assign({}, miner.status()) : { running: false }
  const note = classicNote()
  if (note) st.classicNote = note
  attachGuard(st)
  tray.update(st)
}
function publishClassic (st) {
  refreshTray()
  if (st) attachGuard(st)
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
    zpowGpu = new GpuFleet(zpowOptions())
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
function withinMs (work, ms) {
  return new Promise(resolve => {
    let done = false
    const t = setTimeout(() => { if (!done) { done = true; resolve('timeout') } }, ms)
    Promise.resolve().then(work).then(v => {
      if (done) return
      done = true
      clearTimeout(t)
      resolve(v)
    }, () => {
      if (done) return
      done = true
      clearTimeout(t)
      resolve('timeout')
    })
  })
}
function classicBusy (mgr) {
  if (!mgr) return false
  if (mgr.wantRunning) return true
  try { return mgr.childPids().length > 0 } catch (e) { return false }
}
// No child: return at once. A live child is killed, and this promise settles
// within 2s even when the kill itself does not.
async function stopClassic (backend, opts) {
  const jobs = []
  if ((!backend || backend === 'cpu') && classicBusy(zpowCpu)) jobs.push(zpowCpu.stop(opts))
  if ((!backend || backend === 'gpu') && classicBusy(zpowGpu)) jobs.push(zpowGpu.stop(opts))
  if (!jobs.length) return
  await withinMs(() => Promise.all(jobs), 2000)
}
const MAC_SHARD0_POOL = 'ethproxy+tcp://139.84.196.31:3333'
function getMiner () {
  if (!miner) {
    const res = app.isPackaged ? path.join(process.resourcesPath, 'miner') : path.join(__dirname, 'miner-bin')
    miner = new MinerManager({
      binDir: minerBinDir(),
      genesis: path.join(res, 'scdo-shard0-genesis.json'),
      // 1.1.5b: test-only overrides, honoured only in a development run (never in the installed app)
      dataRoot: (!app.isPackaged && process.env.SCDO_MINER_DIR) || minerDataRoot(),
      rigelExe: !app.isPackaged ? (process.env.SCDO_RIGEL_EXE || undefined) : undefined,
      keepMining: () => !!(readIntent() || {}).keepMining, // 2.0.1: respawn only when the user turned on "Keep mining"
      lowPriority: () => (readIntent() || {}).lowPriority !== false,
      guardOwnsRestart: () => guardLoopOn(),
      onSpawn: (proc) => pinMiner(proc)
    })
    miner.on('status', st => {
      if (st) attachGuard(st)
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
  } catch (e) { console.error('bookkeeping node intent write failed', e) }
  return next
}

// ---- 1.1.5: startup cleanup of the wallet's own leftover geth / proxy / rigel ----
let startupCleanup = null
function afterCleanup () { return startupCleanup ? startupCleanup.catch(() => {}) : Promise.resolve() }
function minerProcessAlive () {
  if (classicBusy(zpowCpu) || classicBusy(zpowGpu)) return true
  if (!miner) return false
  if (miner.wantRunning || miner.stopping || miner.cleaning) return true
  try { if (miner.childPids().length) return true } catch (e) {}
  try { return Object.values(miner.procs || {}).some(Boolean) } catch (e) { return false }
}
// Startup with nothing running: a leftover running* flag is a crashed session, not a request to mine.
function settleStaleRunFlags () {
  if (minerProcessAlive()) return
  writeIntent(mineResume.afterStartup(readIntent() || {}, false))
}

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
  if (sessionLight) return { ok: false, code: 'LIGHT' }
  if (guardActive()) { try { await guardHost.ready() } catch (err) {} }
  if (opts.chain === 'classic' || opts.backend === 'cpu' || opts.backend === 'gpu') {
    const backend = opts.backend === 'gpu' ? 'gpu' : 'cpu'
    try {
      let startOpts = Object.assign({}, opts, { chain: 'classic', backend })
      if (backend === 'gpu' && startOpts.gpuMiner !== 'external') {
        const intent = readIntent() || {}
        const askedSolo = startOpts.gpuMiner === 'classic-node' || startOpts.solo === true || startOpts.miningMode === 'solo' || intent.miningMode === 'solo'
        if (askedSolo) {
          if (!startOpts.miningMode && intent.miningMode) startOpts.miningMode = intent.miningMode
          try {
            const measured = await require('./src/miner/zpow/manager').measureShardSync(startOpts.shard)
            startOpts.nodeSynced = !!(measured && measured.synced)
            if (measured && measured.pct != null) startOpts.syncPct = measured.pct
          } catch (err) {
            startOpts.nodeSynced = false
          }
        }
      }
      await getZpow(backend).start(wallet, startOpts)
      const cfgNow = readIntent() || {}
      const runPatch = backend === 'cpu' ? { runningCpu: true } : { runningClassicGpu: true }
      if (cfgNow.keepMining) runPatch.autoResume = true
      writeIntent(runPatch)
      armLoginLaunch()
      refreshTray()
      return { ok: true }
    } catch (err) {
      try { getMiner().log('wallet', 'classic ' + backend + ' start failed: ' + (err && err.code ? err.code + ' ' : '') + (err && err.message || err)) } catch (e) {}
      return { ok: false, error: err.message, code: err.code }
    }
  }
  const cfg = readIntent() || {}
  let mode = opts.mode === 'node' ? 'node' : (cfg.miningMode === 'pool' ? 'pool' : 'mine')
  // 3.1.7: no Shard0 node ships for macOS, so the Mac graphics card always mines through a pool
  // (the user's own pool when set, otherwise the SCDO pool in Melbourne).
  const macPool = process.platform === 'darwin' && mode !== 'node'
  if (macPool) mode = 'pool'
  const startOpts = { mode, payout: opts.payout }
  if (mode === 'pool') startOpts.poolUrl = macPool ? ((cfg.miningMode === 'pool' && MinerManager.validPoolUrl(cfg.poolUrl)) || MAC_SHARD0_POOL) : cfg.poolUrl
  await afterCleanup()
  try {
    await getMiner().start(wallet, startOpts)
    // 2.0.1: autoResume (start again on the next launch) only when the user turned on "Keep mining"
    writeIntent(Object.assign({ autoResume: !!cfg.keepMining, runningShard0: mode !== 'node', mode: mode === 'node' ? 'node' : 'mine' }, mode !== 'node' ? { reward: wallet } : { payout: opts.payout || null }))
    if (mode !== 'node') armLoginLaunch()
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
  const it = readIntent() || {}
  if (sessionLight) {
    return { autoResume: false, light: true, weakDevice: false, mode: it.mode || 'mine', reward: it.reward || null, payout: it.payout || null, gpuOk: false, otherRigels: [], running: false, resume: { cpu: false, classicGpu: false, shard0: false } }
  }
  await afterCleanup()
  try { settleStaleRunFlags() } catch (e) {}
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
  let weak = false
  let plan = null
  try {
    if (guardActive()) {
      await guardHost.ready()
      plan = guardHost.threadPlanCached()
      weak = !!(plan && (plan.unsuitable || plan.virtual))
    }
  } catch (e) {}
  if (weak && !it.guardWeakNoted) {
    writeIntent({ guardWeakNoted: true })
    const cn = uiLang() !== 'EN'
    const line = plan && plan.virtual
      ? (cn ? '虛擬機中記帳效率極低，建議關閉' : 'Bookkeeping inside a virtual machine is very slow. Leaving it off is recommended.')
      : (cn ? '此裝置不適合記帳' : 'This computer is a poor fit for bookkeeping.')
    try { if (tray) tray.balloon('SCDO Wallet', line) } catch (e) {}
  }
  const autoResume = !!((it.autoResume && it.keepMining) || once) && !weak
  return { autoResume, weakDevice: weak, mode: it.mode || 'mine', reward: it.reward || null, payout: it.payout || null, gpuOk, otherRigels: others, running: m.wantRunning, resume: autoResume ? (it.resume || null) : { cpu: false, classicGpu: false, shard0: false } }
})
ipcMain.handle('miner:gpu', async () => { try { return await getMiner().gpu() } catch (err) { return { nvidia: false, names: [], error: err.message } } })
ipcMain.handle('miner:stop', async (e, src) => {
  if (src && typeof src === 'object' && src.chain === 'classic') {
    const backend = optsBackend(src)
    // On disk before the kill. A hang must not leave runningClassicGpu set.
    writeIntent(mineResume.afterStop(readIntent() || {}, backend === 'gpu' ? 'classicGpu' : 'cpu'))
    try {
      await stopClassic(backend, { endSession: true })
      refreshTray()
      return { ok: true }
    } catch (err) { return { ok: false, error: err.message } }
  }
  writeIntent(mineResume.afterStop(readIntent() || {}, 'shard0')) // the user's Stop is on disk before anything else happens
  try { getNotifier().markUserStop() } catch (err) {}
  // 3.1.4: say who stopped it. The cat's GPU heat guard is not the user.
  const stopWho = src === 'heat' ? 'stop requested by the GPU heat guard (AI cat, card still too hot after the bookkeeping node guard)' : 'stop requested by the user (' + (src === 'node' ? 'Stop node button' : 'Stop bookkeeping button') + ')'
  try { getMiner().log('wallet', stopWho) } catch (err) {}
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
ipcMain.handle('miner:caps', async () => {
  try {
    if (guardActive()) await guardHost.ready()
    const caps = getZpow('cpu').capabilities()
    if (process.platform === 'darwin') { try { const g = await getMiner().gpu(); caps.macGpu = { available: !!(g && g.nvidia), names: (g && g.mineNames) || [] } } catch (e) { caps.macGpu = { available: false, names: [] } } }
    return caps
  } catch (err) { return { cpu: { available: false }, gpu: { available: false }, error: err.message } }
})
ipcMain.handle('miner:classicStatus', () => classicSnapshot())
function optsBackend (src) { return src && src.backend === 'gpu' ? 'gpu' : 'cpu' }

// ---------------- 2.0.1 mining batch 1 ----------------
ipcMain.handle('mining:gpuPreflight', async () => { let g = null; try { g = await getMiner().gpu() } catch (e) {} return miningService.gpuPreflight(g) })
ipcMain.handle('mining:gpuTemp', async () => { try { return await miningService.gpuTemperature({ apiPort: miner && miner.state && miner.state.ports && miner.state.ports.rigelApi }) } catch (err) { return { ok: false, gpus: [], error: err.message } } })
ipcMain.handle('mining:networkStats', async () => {
  const st = miner ? miner.status() : null
  const lh = st && st.running && (st.mode === 'mine' || st.mode === 'pool') ? st.hashrate : 0
  try { return Object.assign({ ok: true }, await miningService.networkStats(lh)) } catch (err) { return { ok: false, error: err.message } }
})
ipcMain.handle('mining:exportLogs', () => miningService.exportLogs(mainWindow, getMiner(), { version: VERSION }))
ipcMain.handle('mining:getConfig', () => {
  const it = readIntent() || {}
  return { miningMode: it.miningMode === 'pool' ? 'pool' : 'solo', poolUrl: it.poolUrl || '', keepMining: !!it.keepMining, guardSmooth: it.guardSmooth !== false, mineOnBattery: !!it.mineOnBattery, lowPriority: it.lowPriority !== false }
})
ipcMain.handle('mining:setConfig', (e, cfg) => {
  cfg = cfg || {}
  const mode = cfg.miningMode === 'pool' ? 'pool' : 'solo'
  let poolUrl = ''
  if (mode === 'pool') { poolUrl = MinerManager.validPoolUrl(cfg.poolUrl); if (!poolUrl) return { ok: false, error: 'BAD_POOL' } }
  writeIntent({ miningMode: mode, poolUrl: poolUrl || (readIntent() || {}).poolUrl || '' })
  return { ok: true, miningMode: mode, poolUrl }
})
ipcMain.handle('mining:setKeepMining', (e, on) => setKeepMining(!!on))
ipcMain.handle('mining:setGuard', (e, patch) => {
  patch = patch || {}
  const next = {}
  if (patch.guardSmooth != null) next.guardSmooth = !!patch.guardSmooth
  if (patch.mineOnBattery != null) next.mineOnBattery = !!patch.mineOnBattery
  if (patch.lowPriority != null) next.lowPriority = !!patch.lowPriority
  if (patch.guardPauseUntil != null) next.guardPauseUntil = Math.max(0, Number(patch.guardPauseUntil) || 0)
  if (patch.resetGuard) {
    next.guardSmooth = true
    next.mineOnBattery = false
    next.lowPriority = true
    next.guardPauseUntil = 0
  }
  // Intent only. Phase, thread count and tray colour are written by the guard.
  writeIntent(next)
  const it = readIntent() || {}
  const low = it.lowPriority !== false
  const ids = []
  try { if (zpowCpu) ids.push.apply(ids, zpowCpu.childPids()) } catch (e) {}
  try { if (zpowGpu) ids.push.apply(ids, zpowGpu.childPids()) } catch (e) {}
  try { if (miner && miner.rigelPid) { const id = miner.rigelPid(); if (id) ids.push(id) } } catch (e) {}
  for (const id of ids) applyPriority(id, low)
  return { ok: true, guardSmooth: it.guardSmooth !== false, mineOnBattery: !!it.mineOnBattery, lowPriority: low }
})
ipcMain.handle('mining:localSync', async () => {
  try { return await require('./src/miner/zpow/manager').localNodeHeights() } catch (e) { return {} }
})
ipcMain.handle('mining:shardSync', async () => {
  try { return await require('./src/miner/zpow/manager').measureAllShardSync() } catch (e) { return {} }
})
ipcMain.handle('mining:poolStatus', async () => {
  const poolStatus = require('./src/js/poolStatus')
  const { poolForShard, poolsFromEnv } = require('./src/miner/zpow/pools')
  let overrides = null
  try { overrides = poolsFromEnv() } catch (e) { overrides = null }
  return poolStatus.readAll(() => {
    const out = {}
    for (const n of [1, 2, 3, 4]) out[n] = poolForShard(n, overrides)
    return out
  })
})
function setKeepMining (on) {
  writeIntent({ keepMining: on, autoResume: on && !!(miner && miner.wantRunning) })
  if (on) armLoginLaunch()
  if (tray) tray.rebuild()
  if (miner) miner.emit('status', miner.status())
  return { ok: true, keepMining: on }
}

// ---------------- 2.0.1 tray + taskbar overlay ----------------
let tray = null
let guardRun = null
function ensureGuard () {
  if (guardRun) return
  if (process.platform !== 'win32' && process.platform !== 'darwin' && process.platform !== 'linux') return
  guardRun = pcGuard.start({
    platform: process.platform,
    readIntent,
    light: () => sessionLight,
    listMiners: () => {
      const out = []
      if (zpowCpu) out.push({ id: 'cpu', mgr: zpowCpu, kind: 'cpu' })
      if (zpowGpu && zpowGpu.kids) {
        for (const [shard, kid] of zpowGpu.kids) out.push({ id: 'gpu-' + shard, mgr: kid, kind: 'gpu' })
      }
      if (miner && miner.guardTarget) {
        const target = miner.guardTarget()
        if (target) out.push({ id: 'shard0', mgr: target, kind: 'gpu' })
      }
      return out
    },
    readSample: (opts) => guardHost.readSample(opts),
    gpuTempC: () => guardHost.gpuTempC(),
    threadPlan: () => guardHost.threadPlanCached(),
    applyAffinity: (pids, ids) => guardHost.applyAffinity(pids, ids),
    applyPriority: (pid, low) => guardHost.applyPriority(pid, low),
    pinProcess: (pid, plan) => guardHost.pinProcess(pid, plan),
    note: (text) => { if (tray) tray.balloon('SCDO Wallet', text) },
    onChange: () => refreshTray(),
    log: (line) => {
      try { console.error(line) } catch (e) {}
      try { if (zpowCpu && zpowCpu.log) zpowCpu.log(line) } catch (e) {}
    }
  })
}
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
      getSession: () => publicSession(),
      getAgentOnline: () => agentLedgerOnline(),
      string: (key, fallback) => uiString(key, fallback),
      onLogin: (on) => setLoginLaunch(on === true),
      onLight: (on) => { setSessionLight(on === true) },
      onPace: (patch) => setPace(patch),
      lang: uiLang(),
      onStop: async () => {
        if (miningNow() && !(await confirmStopMining())) { try { getMiner().log('wallet', 'tray Stop bookkeeping: cancelled by the user') } catch (err) {} return }
        writeIntent(mineResume.afterStop(readIntent() || {}, 'all')); try { getNotifier().markUserStop() } catch (err) {} try { getMiner().log('wallet', 'stop requested by the user (tray menu)') } catch (err) {}
        if (miner && miner.wantRunning) await stopMinerVisibly(mainWindow)
        try { await stopClassic(undefined, { endSession: true }) } catch (err) { console.error('classic stop failed', err) }
        refreshTray()
      },
      onQuit: () => requestQuit({ confirm: true, reason: 'tray' }),
      onPauseFor: (spec) => {
        let until = 0
        if (spec === 'today') {
          const d = new Date()
          until = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime()
        } else until = Date.now() + Number(spec)
        writeIntent({ guardPauseUntil: until })
      },
      onPauseClear: () => writeIntent({ guardPauseUntil: 0 })
    })
    try {
      const seen = readIntent() || {}
      if (!seen.guardIntroSeen) {
        writeIntent({ guardIntroSeen: true })
        const line = uiLang() === 'EN' ? FIRST_RUN.EN : FIRST_RUN.CN
        tray.balloon('SCDO Wallet', line)
      }
    } catch (e) {}
    refreshTray()
    ensureGuard()
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
  try { require('./src/api/mnemonic').removeSeal(path.join(os.homedir(), '.ScdoWallet', 'mnemonic'), name) } catch (err) {}
  // The keyfile above is the only key this delete removes. evm.json loses that account's entry
  // after a backup; other accounts and their key files stay where they are.
  let evm = { ok: true, removed: false, backup: '' }
  try { evm = require('./src/api/evmCache').forgetAccount(path.join(os.homedir(), '.ScdoWallet', 'evm.json'), name) } catch (err) { evm = { ok: false, removed: false, backup: '', error: err && err.message } }
  return { ok: true, backup: b.dst, sha256: b.sha256, evm: evm }
})
ipcMain.handle('keyfile:backupOnly', (e, name) => {
  try { const b = backupKeyfile(name); return { ok: true, backup: b.dst } } catch (err) { return { ok: false, error: err.message } }
})
ipcMain.handle('keyfile:openBackups', () => { fs.mkdirSync(backupRoot(), { recursive: true }); return shell.openPath(backupRoot()) })
ipcMain.handle('menu:rebuild', () => { if (mainWindow) createMenu(mainWindow, uiLang()); return true })

let mainWindow
let walletPanelCtl = null
let walletUiDoc = null

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
    // 3.1.0: the operating system's own title bar and window buttons. Do not draw a custom bar.
    titleBarStyle: 'default',
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
  try { require('./src/main/uiHost').load(mainWindow) } catch (e) { mainWindow.loadFile('index.html') }
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
  mainWindow.webContents.on('render-process-gone', (e, d) => {
    console.error('renderer gone: ' + d.reason + ' exitCode=' + d.exitCode)
    let rolled = false
    try { rolled = require('./src/main/uiHost').noteCrash(d && d.reason) } catch (err) {}
    setTimeout(() => {
      try {
        if (!mainWindow || mainWindow.isDestroyed()) return
        if (rolled) require('./src/main/uiHost').load(mainWindow)
        else mainWindow.reload()
      } catch (err) {}
    }, 1000)
  })
  mainWindow.webContents.on('did-fail-load', (e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return
    try {
      const host = require('./src/main/uiHost')
      if (host.noteLoadFail(url)) host.load(mainWindow)
    } catch (err) {}
  })
  mainWindow.webContents.on('unresponsive', () => console.error('renderer unresponsive'))
  // the page may never navigate away from index.html; external links go to the allowlisted system browser
  const guardNav = (e, url) => { if (!trustedUiUrl(url)) { e.preventDefault(); openExternalSafe(url) } }
  mainWindow.webContents.on('will-navigate', guardNav)
  mainWindow.webContents.on('will-redirect', guardNav)
  mainWindow.webContents.on('will-frame-navigate', (e) => { if (!e.isMainFrame) e.preventDefault() })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { openExternalSafe(url); return { action: 'deny' } })
  mainWindow.webContents.on('will-attach-webview', (e) => e.preventDefault())
  mainWindow.webContents.on('did-finish-load', () => {
    if (tray) tray.reapply()
    sendTrayHint()
    if (!pendingProtocol || !mainWindow || mainWindow.isDestroyed()) return
    try { mainWindow.webContents.send('agentJoin:updated', pendingProtocol) } catch (e) {}
  })
  // 2.0.6: the window's X (and Ctrl+W) only hides the wallet to the tray; mining and the node keep running.
  // Quitting is done from the tray menu (Quit, with a confirmation while mining), by an update, or by Windows shutdown.
  mainWindow.on('show', () => sendTrayHint())
  mainWindow.on('close', (e) => {
    if (quitting || readyToQuit) return
    e.preventDefault()
    if (!tray) { requestQuit({ confirm: true, reason: 'window close without tray' }); return }
    mainWindow.hide()
    try { getMiner().log('wallet', 'main window closed by the user: hidden to the tray, bookkeeping/node unchanged') } catch (err) {}
    noteHiddenToTray()
  })
  mainWindow.on('session-end', () => { quitting = true; try { getNotifier().markUserStop() } catch (e) {} }) // Windows log-off / shutdown (no 'mining stopped' notification)
  mainWindow.on('closed', () => {
    try { if (walletPanelCtl) walletPanelCtl.destroy() } catch (e) {}
    mainWindow = null
  })
}

let pendingProtocol = null
function protocolMessage (parsed) {
  if (!parsed || !parsed.ok) return null
  if (parsed.kind === 'agent-start') return { route: 'agent-start' }
  if (parsed.kind === 'invite-create') return { route: 'invite-create' }
  if (parsed.kind === 'invite-claim') return { route: 'invite-claim', secret: parsed.secret, contract: parsed.contract, chainId: parsed.chainId }
  return { route: 'join', pendingRef: parsed.ref || '', src: parsed.src || '' }
}
function acceptProtocolUrl (raw) {
  const parsed = Join.parseWalletUrl(raw)
  if (!parsed.ok) return
  if (!parsed.kind || parsed.kind === 'join') {
    try { joinStore.remember(parsed) } catch (e) { console.warn('join url', e && e.message) }
  }
  const msg = protocolMessage(parsed)
  if (!msg) return
  pendingProtocol = msg
  try {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('agentJoin:updated', msg)
  } catch (e) {}
}
function takeJoinArgv (argv) {
  for (const u of Join.urlsFromArgv(argv)) acceptProtocolUrl(u)
}
app.on('open-url', (e, url) => { e.preventDefault(); acceptProtocolUrl(url) })
function publicWalletUi () {
  const walletUi = require('./src/js/walletUi')
  const doc = walletUiDoc || walletUi.current() || walletUi.defaults()
  return {
    links: doc.links,
    cards: doc.cards,
    strings: doc.strings || { en: {}, 'zh-Hant': {} },
    homeCards: doc.homeCards || [],
    banner: doc.banner || null,
    flags: doc.flags || {},
    minVersion: doc.minVersion || '',
    recommendedVersion: doc.recommendedVersion || '',
    from: doc.from || 'default'
  }
}
function publishWalletUi (doc, from) {
  walletUiDoc = Object.assign({}, doc, { from: from || (doc && doc.from) || 'default' })
  try { require('./src/js/walletUi').setCurrent(walletUiDoc) } catch (e) {}
  try { if (mainWindow && !mainWindow.isDestroyed()) createMenu(mainWindow, uiLang()) } catch (e) {}
  try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('panel:doc', publicWalletUi()) } catch (e) {}
}
function startWalletPanel () {
  const { create } = require('./src/main/walletPanel')
  walletPanelCtl = create({
    getWindow: function () { return mainWindow },
    getLang: function () { return uiLang() },
    onProtocol: function (url) { acceptProtocolUrl(url) }
  })
  if (mainWindow) walletPanelCtl.hookResize(mainWindow)
  ipcMain.handle('panel:doc', () => publicWalletUi())
  ipcMain.handle('panel:show', (e, req) => walletPanelCtl.show(req))
  ipcMain.handle('panel:close', () => { walletPanelCtl.hide(); return true })
  refreshLiveUi()
  const liveTimer = setInterval(refreshLiveUi, 30 * 60 * 1000)
  if (liveTimer.unref) liveTimer.unref()
}
function refreshLiveUi () {
  const walletUi = require('./src/js/walletUi')
  const uiBundle = require('./src/main/uiBundle')
  walletUi.refresh({
    cacheFile: path.join(app.getPath('userData'), 'wallet-ui.json'),
    fetchImpl: function (url) { return require('./src/config/endpoints').getJson(url, 8000) }
  }).then(function (result) { publishWalletUi(result.doc, result.from) }).catch(function (e) { console.warn('wallet ui', e && e.message) })
  uiBundle.refresh({
    userData: app.getPath('userData'),
    shellVersion: VERSION,
    fetchImpl: function (url) { return require('./src/config/endpoints').getJson(url, 8000) }
  }).then(function (result) {
    if (result && result.state) require('./src/main/uiHost').adopt(result.state)
  }).catch(function (e) { console.warn('ui bundle', e && e.message) })
}
function registerScdoProtocol () {
  try {
    if (process.defaultApp && process.argv.length >= 2) app.setAsDefaultProtocolClient('scdowallet', process.execPath, [path.resolve(process.argv[1])])
    else app.setAsDefaultProtocolClient('scdowallet')
  } catch (e) { console.warn('scdowallet protocol', e && e.message) }
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
    takeJoinArgv(argv)
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus() }
  })
  app.whenReady().then(() => {
    bootSession()
    try { guardHost.warm() } catch (e) {}
    try {
      powerMonitor.on('suspend', () => { try { powerHold.onSuspend(Date.now(), minerProcessAlive()) } catch (e) {} })
      powerMonitor.on('resume', () => { try { powerHold.onResume(Date.now()) } catch (e) {} })
    } catch (e) {}
    if (process.platform === 'win32') { try { app.setAppUserModelId('io.scdoscan.scdowallet') } catch (e) {} } // 2.0.7: Windows toast notifications (same id as the installer shortcut)
    registerScdoProtocol()
    takeJoinArgv(process.argv)
    fixCors()
    const allowClip = (perm) => perm === 'clipboard-sanitized-write' || perm === 'clipboard-read'
    session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(allowClip(perm)))
    session.defaultSession.setPermissionCheckHandler((wc, perm) => allowClip(perm))
    app.on('web-contents-created', (e, wc) => {
      let panelGuest = false
      try { panelGuest = String((wc.session && wc.session.storagePath) || '').indexOf('wallet-panel') >= 0 } catch (err) {}
      if (panelGuest) return
      wc.setWindowOpenHandler(({ url }) => { openExternalSafe(url); return { action: 'deny' } })
      wc.on('will-attach-webview', (ev) => ev.preventDefault())
    })
    // 1.1.5: stop the wallet's own miner processes left over from an earlier session (never other Rigel/geth)
    startupCleanup = getMiner().cleanupStale().then(() => {
      try { settleStaleRunFlags() } catch (e) { console.error('stale run flags', e) }
    }).catch(err => { console.error('bookkeeping node cleanup failed', err); return [] })
    // 1.1.6: apply any completed-update marker from a previous run (log + restore mining intent)
    const ra = getUpdater().resumeAfterUpdate()
    if (ra && ra.applied) justUpdated = { version: ra.version, wasMining: !!ra.wasMining }
    try {
      require('./src/main/uiHost').init({ userData: app.getPath('userData'), appIndex: path.join(__dirname, 'index.html') })
    } catch (e) { console.warn('ui host', e && e.message) }
    createWindow()
    applyLightRuntime()
    createMenu(mainWindow, uiLang())
    createTray()
    startOpsAgent()
    try {
      const { refresh } = require('./src/config/remoteConfig')
      refresh({ cacheFile: path.join(app.getPath('userData'), 'remote-config.json') }).then(applyRemoteConfig).catch(e => console.warn('remote config', e && e.message))
    } catch (e) { console.warn('remote config', e && e.message) }
    try { startWalletPanel() } catch (e) { console.warn('wallet panel', e && e.message) }
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
let trayHintPending = false
let trayHintDismissed = false
let agentLive = false
function agentProcessOnline () {
  try {
    const st = opsAgent && opsAgent.status && opsAgent.status()
    if (st && st.registered) return true
  } catch (e) {}
  if (agentLive) return true
  try {
    const view = joinStore.publicView()
    if (view && view.locked) return true
  } catch (e) {}
  return false
}
// 3.1.12: the tray presence line uses the same online state as the Agent card (see AgentService.online).
// agentProcessOnline above stays for the quit question: a started agent goes offline when the wallet quits.
function agentLedgerOnline () {
  try { return !!(opsAgent && opsAgent.online && opsAgent.online()) } catch (e) { return false }
}
function sendTrayHint () {
  if (!trayHintPending || trayHintDismissed) return
  if (!mainWindow || mainWindow.isDestroyed()) return
  try { mainWindow.webContents.send('agent:trayHint', { show: true }) } catch (e) {}
}
function noteHiddenToTray () {
  keepAgentHeartbeat()
  if (!hintShown) {
    hintShown = true
    trayHintPending = true
    const body = uiString('trayStayNotice', mt('trayStayNotice'))
    let noted = false
    try {
      if (Notification.isSupported()) {
        const n = new Notification({ title: 'SCDO Wallet', body: body, silent: true })
        n.on('click', () => { try { if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus() } } catch (err) {} })
        n.show()
        noted = true
      }
    } catch (e) {}
    if (!noted && tray && tray.balloon) tray.balloon('SCDO Wallet', body)
  }
}
function confirmAgentQuit () {
  if ((readIntent() || {}).agentQuitQuiet === true) return Promise.resolve(true)
  const w = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
  if (w && !w.isVisible()) { try { w.show(); w.focus() } catch (e) {} }
  const opts = {
    type: 'question',
    title: mt('quitTitle'),
    message: uiString('quitAgentMsg', mt('quitAgentMsg')),
    buttons: [uiString('quitAgentQuit', mt('quitAgentQuit')), uiString('quitAgentStay', mt('quitAgentStay'))],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    checkboxLabel: uiString('quitAgentDontAsk', mt('quitAgentDontAsk')),
    checkboxChecked: false
  }
  const box = w && !w.isDestroyed() ? dialog.showMessageBox(w, opts) : dialog.showMessageBox(opts)
  return box.then(r => {
    if (!r || r.response !== 0) return false
    if (r.checkboxChecked) writeIntent({ agentQuitQuiet: true })
    return true
  })
}
let startHidden = process.argv.includes('--scdo-hidden') || process.argv.includes('--hidden')
function bootSession () {
  let was = false
  try {
    const settings = app.getLoginItemSettings ? app.getLoginItemSettings() : null
    was = !!(settings && settings.wasOpenedAtLogin)
  } catch (e) {}
  sessionOpenedAtLogin = sessionMode.openedAtLogin({ argv: process.argv, wasOpenedAtLogin: was })
  const intent = readIntent()
  sessionLight = sessionMode.linuxLight(process.platform) || sessionMode.resolveLight({ intent: intent, openedAtLogin: sessionOpenedAtLogin })
  if (sessionOpenedAtLogin || sessionMode.hiddenLaunch(process.argv)) startHidden = true
  if (sessionMode.shouldArmLogin(intent) && sessionMode.rigWantsLogin(intent, agentStartedForLogin())) armLoginLaunch()
  else applyLoginLaunch()
}
function agentStartedForLogin () {
  try {
    const view = joinStore.publicView()
    return !!(view && view.locked)
  } catch (e) { return false }
}
function keepAgentHeartbeat () {
  try { if (opsAgent && opsAgent.nudge) opsAgent.nudge() } catch (e) {}
}
function applyLoginLaunch () {
  const on = (readIntent() || {}).loginLaunch === true
  try { app.setLoginItemSettings(sessionMode.loginItemSettings(on)) } catch (e) {}
}
function publicSession () {
  const it = readIntent() || {}
  const prefs = sessionMode.normalizePrefs(it)
  return {
    loginLaunch: prefs.loginLaunch,
    loginAsked: prefs.loginAsked,
    offerLogin: sessionMode.offerLogin(it),
    light: !!sessionLight,
    lightChosen: prefs.lightChosen,
    openedAtLogin: !!sessionOpenedAtLogin,
    gpuLow: prefs.gpuIntensity === 'low',
    idleOnly: prefs.idleOnly,
    bookkeeping: minerActive()
  }
}
function publishSession () {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('session:changed', publicSession())
  } catch (e) {}
  if (tray) { try { tray.rebuild() } catch (e) {} }
}
function applyLightRuntime () {
  const wc = mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null
  if (wc) {
    try { wc.setFrameRate(sessionLight ? 1 : 60) } catch (e) {}
    try { wc.setBackgroundThrottling(true) } catch (e) {}
  }
  publishSession()
}
function setLoginLaunch (on) {
  const open = on === true
  writeIntent({ loginLaunch: open, loginAsked: true, loginOff: !open })
  applyLoginLaunch()
  publishSession()
  return publicSession()
}
function armLoginLaunch () {
  if (!sessionMode.shouldArmLogin(readIntent())) return publicSession()
  writeIntent(sessionMode.armLoginPatch())
  applyLoginLaunch()
  publishSession()
  return publicSession()
}
function setPace (patch) {
  patch = patch || {}
  const next = {}
  if (patch.gpuLow != null) next.gpuIntensity = patch.gpuLow === true ? 'low' : 'normal'
  if (patch.idleOnly != null) next.idleOnly = patch.idleOnly === true
  writeIntent(next)
  publishSession()
  return publicSession()
}
async function setSessionLight (on) {
  if (sessionMode.linuxLight(process.platform)) {
    sessionLight = true
    applyLightRuntime()
    return publicSession()
  }
  const want = on === true
  sessionLight = want
  writeIntent({ lightMode: want, lightChosen: true })
  if (want) {
    try { writeIntent(mineResume.afterStop(readIntent() || {}, 'all')) } catch (e) {}
    try { if (miner && miner.wantRunning) await miner.stop() } catch (e) {}
    try { await stopClassic(undefined, { endSession: true }) } catch (e) {}
  }
  applyLightRuntime()
  try { refreshTray() } catch (e) {}
  return publicSession()
}
// 2.0.6: the one way to quit. confirm=true asks first while mining (Cancel is the default).
async function clearPageRunFlags () {
  if (!mainWindow || mainWindow.isDestroyed()) return
  await mainWindow.webContents.executeJavaScript("try{localStorage.removeItem('minerRunClassicCpu');localStorage.removeItem('minerRunClassicGpu');localStorage.removeItem('minerRunShard0')}catch(e){}")
}
async function requestQuit ({ confirm, reason } = {}) {
  if (quitPromise) return quitPromise
  if (confirm && agentProcessOnline()) {
    const ok = await confirmAgentQuit()
    if (!ok) { try { getMiner().log('wallet', 'quit cancelled by the user (' + reason + ')') } catch (e) {} return }
  } else if (confirm && miningNow()) {
    const opts = { type: 'question', title: mt('quitTitle'), message: mt('quitMsg'), buttons: mt('quitBtns'), defaultId: 0, cancelId: 0, noLink: true }
    const w = mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() ? mainWindow : null
    const r = w ? await dialog.showMessageBox(w, opts) : await dialog.showMessageBox(opts)
    if (r.response !== 1) { try { getMiner().log('wallet', 'quit cancelled by the user (' + reason + ')') } catch (e) {} return }
  }
  quitting = true
  try { writeIntent(mineResume.afterQuit(readIntent() || {})) } catch (e) { console.error('clear running flags on quit failed', e) }
  try { await clearPageRunFlags() } catch (e) { console.error('clear page run flags failed', e) }
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
// ---------------- 3.1.4 AI Agent Ledger: the AI kitten as ops agent ----------------
// Reads this miner's live status, self-heals known incidents (duplicate Rigel on 5055, lost mining state after a
// reboot, 0 peers / stalled sync, stuck 0 H/s, GPU heat), keeps a local event log, and sends heartbeats signed with
// this machine's own agent key (userData/agent/agent-key.json). The key is never sent; the server holds no keys.
// Reporting can be turned off ("agentReporting": false in miner-intent.json); local self-heal still runs.
let opsAgent = null
async function agentSnapshot () {
  if (sessionLight) return { code: 'ONLINE', running: false, wantMining: false, hashrate: 0, gpuTempC: null, peers: null }
  const m = getMiner()
  const st = m.status() || {}
  const it = readIntent() || {}
  const node = st.mode === 'node'
  const wantMining = !!st.running && !node
  let otherRigels = []
  if (wantMining || (it.autoResume && it.keepMining)) { try { otherRigels = await m.otherRigels() } catch (e) {} }
  let gpuTempC = null
  try { const t = await guardHost.gpuTempC(); gpuTempC = typeof t === 'number' ? t : (t && Number.isFinite(t.tempC) ? t.tempC : null) } catch (e) {}
  let gaveUp = false
  try { const v = guardRun && guardRun.snapshot && guardRun.snapshot(); gaveUp = !!(v && v.chains && v.chains.some(c => c.status && c.status.gaveUp)) } catch (e) {}
  const zRunning = !!((zpowCpu && zpowCpu.wantRunning) || (zpowGpu && zpowGpu.wantRunning))
  const armed = !!((it.autoResume && it.keepMining) || it.resumeOnce)
  const resumeChains = it.resume ? Object.keys(it.resume).filter(k => it.resume[k]) : []
  // the manager's status can be empty (e.g. IDLE while Rigel / the node run on alternate ports): read them directly
  let pr = {}
  if (st.hashrate == null || st.peers == null || st.localBlock == null || st.networkBlock == null) { try { pr = (m.agentProbe && await m.agentProbe()) || {} } catch (e) {} }
  const num = (a, b) => (a != null && Number.isFinite(Number(a))) ? Number(a) : ((b != null && Number.isFinite(Number(b))) ? Number(b) : null)
  let lastRewardAt = null
  let rewardsSeen = (Number(st.sharesAccepted) || 0) > 0 || (Number(st.blocksFound) || 0) > 0
  try {
    const g = guardRun && guardRun.snapshot && guardRun.snapshot()
    const times = ((g && g.chains) || []).map(c => c && c.lastShareAt).filter(t => typeof t === 'number' && t > 0)
    if (times.length) lastRewardAt = Math.max.apply(null, times)
  } catch (e) {}
  let poolMode = st.mode === 'pool' && wantMining
  let poolConnected = null
  if (poolMode) {
    if (st.code === 'MINING') poolConnected = true
    else if (st.code === 'MINING_STARTING' || st.code === 'ERROR') poolConnected = false
  }
  let payoutBalanceFresh = false
  const notePool = (z) => {
    if (!z || !z.running || z.backend === 'classic-node') return
    poolMode = true
    if (z.connected === false) poolConnected = false
    else if (z.connected === true && poolConnected !== false) poolConnected = true
    if ((Number(z.sharesAccepted) || 0) > 0 || (Number(z.blocksFound) || 0) > 0) rewardsSeen = true
    if (z.poolStats && !z.poolError) payoutBalanceFresh = true
  }
  try { const snap = classicSnapshot(); notePool(snap.classicCpu); notePool(snap.classicGpu) } catch (e) {}
  return {
    wantMining, running: !!st.running || zRunning, code: st.code || null, hashrate: num(st.hashrate, pr.hashrate),
    peers: num(st.peers, pr.peers), localBlock: num(st.localBlock, pr.localBlock), networkBlock: num(st.networkBlock, pr.networkBlock),
    nodeRunning: !!(st.procs && st.procs.includes('geth')), paused: !!st.paused, procs: st.procs || [],
    otherRigels, gaveUp, quickExits: m.recentExits ? m.recentExits('rigel') : 0, gpuTempC,
    armedResume: armed && resumeChains.length > 0, resumeChains, uptimeMs: Math.round(process.uptime() * 1000),
    miningStartedAt: st.startedAt || null, lastRewardAt, rewardsSeen, poolMode, poolConnected,
    payoutWatched: poolMode, payoutBalanceAt: lastPayoutRead && lastPayoutRead.at || null, payoutBalanceFresh,
    noRewardHours: remoteDoc && remoteDoc.noRewardHours, payoutStaleHours: remoteDoc && remoteDoc.payoutStaleHours
  }
}
function minerPayoutWallet () {
  try {
    const st = getMiner().status() || {}
    if (st.wallet) return st.wallet
  } catch (e) {}
  try {
    const c = classicSnapshot()
    if (c.classicCpu && c.classicCpu.wallet) return c.classicCpu.wallet
    const g = c.classicGpu
    if (g && g.wallet) return g.wallet
    if (g && Array.isArray(g.shards)) {
      const s = g.shards.find(x => x && x.wallet)
      if (s) return s.wallet
    }
  } catch (e) {}
  return ''
}
function payoutAddressNow () {
  let accounts = []
  try { accounts = walletService.listAccounts() } catch (e) { accounts = [] }
  const found = joinStore.currentPayout(minerPayoutWallet(), accounts, readIntent())
  if (found.intentPatch && Object.keys(found.intentPatch).length) writeIntent(found.intentPatch)
  return found.payout || ''
}
async function startMyAgent (typedRef) {
  let created = null
  let accounts = []
  try { accounts = walletService.listAccounts() } catch (e) { accounts = [] }
  if (!accounts.length) {
    const password = Join.generatePassword()
    try { created = await walletService.createAccount({ name: 'Agent', password: password, shard: '0' }) } catch (e) { created = { ok: false, error: 'create' } }
    if (!created || !created.ok) return { ok: false, error: (created && created.error) || 'create' }
    try { accounts = walletService.listAccounts() } catch (e) { accounts = [] }
  }
  joinStore.lock(typedRef)
  agentLive = true
  try { armLoginLaunch() } catch (e) {}
  try { refreshTray() } catch (e) {}
  const file = (created && created.file) || joinStore.publicView().payoutFile || ''
  if (created && created.evm) joinStore.setPayout(created.evm, created.file, 'auto')
  const applied = created && created.evm
    ? { view: joinStore.publicView(), intentPatch: Join.bookkeepingPatch(readIntent(), created.evm) }
    : joinStore.useSelection(accounts, file, readIntent())
  if (applied.intentPatch && Object.keys(applied.intentPatch).length) writeIntent(applied.intentPatch)
  registerAgentLater()
  const phrase = created && created.phrase ? created.phrase : ''
  if (created) created.phrase = ''
  return {
    ok: true,
    starting: true,
    file: (created && created.file) || file,
    evm: (created && created.evm) || (applied.view && applied.view.payout) || '',
    date: (created && created.date) || '',
    phrase: phrase,
    registered: false,
    payout: applied.view.payout || ''
  }
}
function registerAgentLater () {
  if (!opsAgent) return
  opsAgent.register().then(r => {
    const registered = !!(r && r.ok)
    if (registered) joinCtl.refcode().catch(() => {})
    try { refreshTray() } catch (e) {}
    tellJoinSettled(registered)
  }).catch(() => tellJoinSettled(false))
}
// 3.1.12: the Agent card and the tray follow the agent. When online or the x402 reserve changes, tell the page
// (it re-reads agentJoin:get) and rebuild the tray. 3.1.11 read the card once at startup, before the first
// register, so it could stay on Offline while the agent was online.
let agentCardSig = ''
let agentCardTimer = null
function agentCardTick () {
  let st = null
  try { st = opsAgent && opsAgent.status() } catch (e) { st = null }
  if (!st) return
  const sig = [st.online ? 1 : 0, st.settled ? 1 : 0, st.registered ? 1 : 0, st.usdcWallet || ''].join('|')
  if (sig === agentCardSig) return
  agentCardSig = sig
  try { refreshTray() } catch (e) {}
  try {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('agentJoin:changed', { online: !!st.online, usdcWallet: st.usdcWallet || '' })
  } catch (e) {}
}
function watchAgentCard () {
  if (agentCardTimer) return
  agentCardTimer = setInterval(agentCardTick, 5000)
  if (agentCardTimer.unref) agentCardTimer.unref()
}
function tellJoinSettled (registered) {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('agentJoin:settled', { registered: !!registered })
  } catch (e) {}
}
let claimWatch = ''
async function claimReceiptReady () {
  const addr = String(claimWatch || '')
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) return false
  const { ethers } = require('ethers')
  const { Shard0 } = require('./src/api/evm')
  const reg = new ethers.Contract('0x458F974CcC4F1DB16Fe9F57489b134D7013bAD0d', ['function referrerOf(address) view returns (address)'], new Shard0().provider)
  const ref = await reg.referrerOf(addr)
  return !!ref && ref !== ethers.ZeroAddress
}
function applyRemoteConfig (result) {
  const doc = result && result.config
  if (!doc) {
    if (result && result.errors && result.errors.length) console.warn('remote config', result.errors.join('; '))
    return
  }
  remoteDoc = doc
  try { require('./src/config/endpoints').setCachedRemote(doc) } catch (e) {}
  try { if (zpowCpu) zpowCpu.o.remoteConfig = doc } catch (e) {}
  try { if (zpowGpu) zpowGpu.o.remoteConfig = doc } catch (e) {}
  try { if (miner) miner.o.remoteConfig = doc } catch (e) {}
  try { if (opsAgent) opsAgent.setRemote(doc) } catch (e) {}
  try {
    const dir = path.join(os.homedir(), '.ScdoWallet')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'remote-config.json'), JSON.stringify(doc))
  } catch (e) { console.warn('remote config cache', e && e.message) }
}
function reportProcessError (kind, err) {
  const message = (err && (err.message || String(err))) || ''
  const stack = (err && err.stack) || ''
  console.error('wallet ' + kind, message)
  try {
    if (opsAgent) opsAgent.reportError({ kind, message, stack }).catch(e => console.error('agent report failed', e && e.message))
  } catch (e) { console.error('agent report failed', e && e.message) }
}
function startOpsAgent () {
  if (opsAgent) return
  try {
    const { AgentService } = require('./src/agent/agentService')
    opsAgent = new AgentService(path.join(app.getPath('userData'), 'agent'), {
      version: VERSION, platform: process.platform, label: '',
      payoutAddress: payoutAddressNow,
      accountPayout: () => { try { const a = (walletService.listAccounts() || []).find(x => x && x.evm); return a ? String(a.evm) : '' } catch (e) { return '' } },
      joinExtra: () => joinStore.joinExtra(),
      onReserve: (addr) => { try { joinStore.setUsdc(addr) } catch (e) {} },
      enabled: () => (readIntent() || {}).agentReporting !== false,
      light: () => sessionLight,
      snapshot: agentSnapshot,
      handlers: {
        'free-port': async (a) => {
          const freed = await getMiner().agentFreeRigelPort(a.pids)
          if (freed && guardRun && guardRun.clearGiveUp) guardRun.clearGiveUp()
          return freed
        },
        'restart-miner': async () => {
          if (guardRun && guardRun.clearGiveUp) guardRun.clearGiveUp()
          return getMiner().restartRigelForGuard()
        },
        'reconnect-peers': (a) => getMiner().agentReconnectPeers(a.reason),
        'resume-mining': async () => {
          if (!mainWindow || mainWindow.isDestroyed()) return false
          mainWindow.webContents.send('agent:resume'); return true
        },
        // GPU heat is enforced by the miner guard's temperature rule (85 °C slow down, 90 °C pause);
        // the agent records and reports it, and nudges the guard to re-evaluate.
        throttle: async () => { refreshTray(); return true },
        'pause-gpu': async () => { refreshTray(); return true },
        unthrottle: async () => { refreshTray(); return true }
      }
    })
    const rawRegister = opsAgent.register.bind(opsAgent)
    opsAgent.register = function () {
      return rawRegister().then(r => { try { refreshTray() } catch (err) {} return r })
    }
    opsAgent.start()
    keepAgentHeartbeat()
    watchAgentCard()
  } catch (e) { console.error('ops agent failed to start', e && e.message) }
}
ipcMain.handle('session:get', () => publicSession())
ipcMain.handle('session:setLogin', (e, on) => setLoginLaunch(on === true))
ipcMain.handle('session:setLight', (e, on) => setSessionLight(on === true))
ipcMain.handle('session:setPace', (e, patch) => setPace(patch))
ipcMain.handle('session:loginAnswer', (e, yes) => setLoginLaunch(yes === true))
ipcMain.handle('session:armLogin', () => armLoginLaunch())
ipcMain.handle('session:trayHintDismiss', () => { trayHintDismissed = true; trayHintPending = false; return { ok: true } })
ipcMain.handle('agent:status', () => opsAgent ? opsAgent.status() : null)
ipcMain.handle('agent:setReporting', (e, on) => { writeIntent({ agentReporting: !!on }); return !!on })
ipcMain.handle('agentJoin:get', () => joinCtl.snapshot(opsAgent ? opsAgent.status() : null))
ipcMain.handle('agentJoin:start', (e, p) => startMyAgent(p && p.typedRef).catch(() => ({ ok: false, error: 'create' })))
ipcMain.handle('agentJoin:setPayout', (e, p) => {
  const addr = Join.validPayout(p && p.address)
  if (!addr) return joinStore.publicView()
  const view = joinStore.setPayout(addr, p && p.file, 'settings')
  const patch = Join.bookkeepingPatch(readIntent(), view.payout)
  patch.reward = view.payout
  writeIntent(patch)
  if (opsAgent) opsAgent.register().catch(() => {})
  return view
})
ipcMain.handle('agentJoin:useSelection', (e, p) => {
  let accounts = []
  try { accounts = walletService.listAccounts() } catch (err) { accounts = [] }
  const applied = joinStore.useSelection(accounts, p && p.file, readIntent())
  if (applied.changed && opsAgent) opsAgent.register().catch(() => {})
  if (applied.intentPatch && readIntent() && Object.keys(applied.intentPatch).length) writeIntent(applied.intentPatch)
  return applied.view
})
ipcMain.handle('agentJoin:refcode', () => joinCtl.refcode().catch(() => ({ ok: false, error: 'refcode' })))
ipcMain.handle('invite:create', async (e, p) => {
  p = p || {}
  const Invite = require('./src/js/inviteRegistry')
  const plan = Invite.planCreate({ gift: p.gift, feeBps: p.feeBps })
  const sent = await walletService.sendContract({ file: p.file, password: p.password, to: plan.to, data: plan.data, valueWei: plan.valueWei })
  if (!sent || !sent.ok) return { ok: false, error: (sent && sent.error) || 'send' }
  return { ok: true, hash: sent.hash, id: plan.id, link: plan.link }
})
ipcMain.handle('invite:cancel', async (e, p) => {
  p = p || {}
  const Invite = require('./src/js/inviteRegistry')
  const plan = Invite.planCancel(p.id)
  if (!plan) return { ok: false, error: 'id' }
  const sent = await walletService.sendContract({ file: p.file, password: p.password, to: plan.to, data: plan.data, valueWei: '0' })
  if (!sent || !sent.ok) return { ok: false, error: (sent && sent.error) || 'send' }
  return { ok: true, hash: sent.hash, id: plan.id }
})
ipcMain.handle('invite:claim', async (e, body) => {
  body = body && typeof body === 'object' ? body : {}
  claimWatch = String(body.newAddr || '')
  if (!opsAgent || !opsAgent.relayClaim) return { ok: false, status: 0 }
  try {
    const res = await opsAgent.relayClaim(body)
    return { ok: !!(res && res.status === 200), status: res && res.status ? res.status : 0 }
  } catch (err) { return { ok: false, status: 0 } }
})
ipcMain.handle('invite:confirm', () => claimReceiptReady().then(ok => ({ ok: !!ok })).catch(() => ({ ok: false })))

process.on('uncaughtException', err => reportProcessError('crash', err))
process.on('unhandledRejection', err => reportProcessError('error', err))
app.on('will-quit', () => { killMinerChildrenSync(); if (tray) tray.destroy() })
process.on('exit', () => killMinerChildrenSync())

app.on('window-all-closed', function () {
  // 2.0.6: the wallet lives in the tray; it only quits through requestQuit()
  if (quitting && !quitPromise) app.quit()
})

app.on('activate', function () {
  if (mainWindow === null) {
    createWindow()
    applyLightRuntime()
    createMenu(mainWindow, uiLang())
  } else if (!mainWindow.isDestroyed() && !mainWindow.isVisible()) mainWindow.show()
})
