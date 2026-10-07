// ScdoWallet main process (2026-09 upgrade: Electron 44, no `remote`, shard0 EVM + built-in GPU miner)
const { shell, BrowserWindow, Menu, Tray, app, ipcMain, dialog, session, nativeImage } = require('electron')
const path = require('path')
const fs = require('fs')

// 2.0.0 rename: the product is "SCDO Wallet", but Electron would otherwise derive
// userData from productName. 2.0.12 always pins %APPDATA%\ScdoWalletBeta (miner
// intent, updater state, Local Storage). 3.0.0 does the same, including a first
// launch that does not already have that folder. Keyfiles stay in
// %USERPROFILE%\.ScdoWallet and are not moved.
try { app.setPath('userData', path.join(app.getPath('appData'), 'ScdoWalletBeta')) } catch (e) { console.error('userData pin failed', e) }

ipcMain.on('compileContract', (event, input) => {
  var solc = require('solc')
  solc = solc.setupMethods(require('./src/api/solidity.js'))
  var output = JSON.parse(solc.compile(JSON.stringify(input)))
  var err = output.errors
  var byt; var abi
  var e = 0
  for (var contractName in output.contracts['test.sol']) {
    if (e == 0) {
      byt = output.contracts['test.sol'][contractName].evm.bytecode.object
      abi = output.contracts['test.sol'][contractName].abi
      e = 1
    }
  }
  event.sender.send('compiledContract', byt, abi, err)
})

// replaces require('electron').remote.dialog used by the 2020 renderer code
// Miner data dir: <userData>/miner, except on Windows when that path has spaces or non-ASCII
// characters (e.g. a Chinese user name) – GPU miners/geth are fragile there, so use
// C:\ProgramData\ScdoWalletBeta\miner (users may create folders there) instead.
// The folder name stays ScdoWalletBeta so a 2.0.12 miner database is reused.
function minerDataRoot () {
  const def = path.join(app.getPath('userData'), 'miner')
  if (process.platform !== 'win32' || /^[\x21-\x7e]+$/.test(def)) return def
  const alt = path.join(process.env.ProgramData || 'C:\\ProgramData', 'ScdoWalletBeta', 'miner')
  try { require('fs').mkdirSync(alt, { recursive: true }); return alt } catch (e) { return def }
}

ipcMain.handle('dialog:open', (event, opts) => dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), opts || {}))
ipcMain.handle('app:info', () => ({ version: app.getVersion(), platform: process.platform, arch: process.arch, userData: app.getPath('userData') }))
ipcMain.handle('shell:openExternal', (e, url) => {
  if (/^https:\/\/(scdoscan\.io|github\.com\/rigelminer)\//.test(url)) return shell.openExternal(url)
  return false
})

const ScdoClient = require('./src/api/scdoClient')
const createMenu = require('./src/js/menu.js').createMenu

// ---------------- built-in miners ----------------
// Shard0: Ethash GPU (geth + scdo-stratum + Rigel), bundled from miner-bin.
// Classic shards 1–4: zminer CPU to the pool, and the go-scdo CUDA node.
// Shard 1 pool is 82.223.19.88:3341. Shards 2–4 use 3342–3344.
// A saved CPU choice stays on zminer.
const { MinerManager } = require('./src/miner/manager')
const { ZpowManager } = require('./src/miner/zpow/manager')
function minerBinDir () {
  if (app.isPackaged) return path.join(process.resourcesPath, 'miner', 'bin')
  return path.join(__dirname, 'miner-bin', process.platform)
}
let miner = null
let zpowCpu = null
let zpowGpu = null
let tray = null
function zpowOptions () {
  return {
    binDir: minerBinDir(),
    dataRoot: process.env.SCDO_MINER_DIR || minerDataRoot(),
    root: __dirname
  }
}
function getMiner () {
  if (!miner) {
    const res = app.isPackaged ? path.join(process.resourcesPath, 'miner') : path.join(__dirname, 'miner-bin')
    miner = new MinerManager({
      binDir: minerBinDir(),
      genesis: path.join(res, 'scdo-shard0-genesis.json'),
      dataRoot: process.env.SCDO_MINER_DIR || minerDataRoot(),
      rigelExe: process.env.SCDO_RIGEL_EXE || undefined
    })
    miner.on('status', st => publishMiner(Object.assign({ chain: 'shard0' }, st)))
  }
  return miner
}
function getZpow (kind) {
  if (kind === 'cpu') {
    if (!zpowCpu) {
      zpowCpu = new ZpowManager(zpowOptions())
      zpowCpu.on('status', st => publishMiner(st))
    }
    return zpowCpu
  }
  if (!zpowGpu) {
    zpowGpu = new ZpowManager(zpowOptions())
    zpowGpu.on('status', st => publishMiner(st))
  }
  return zpowGpu
}
function publishMiner (st) {
  updateTray()
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('miner:status', st)
}
function minerSnapshot () {
  const idleClassic = (mode) => ({ chain: 'classic', mode, running: false, code: 'IDLE' })
  return {
    shard0: Object.assign({ chain: 'shard0' }, getMiner().status()),
    classicCpu: zpowCpu ? zpowCpu.status() : idleClassic('cpu'),
    classicGpu: zpowGpu ? zpowGpu.status() : idleClassic('gpu')
  }
}
function stopAllMiners () {
  const jobs = []
  if (zpowCpu && zpowCpu.wantRunning) jobs.push(zpowCpu.stop())
  if (zpowGpu && zpowGpu.wantRunning) jobs.push(zpowGpu.stop())
  if (miner && miner.wantRunning) jobs.push(miner.stop())
  return Promise.all(jobs)
}
ipcMain.handle('miner:start', async (e, wallet, opts) => {
  opts = opts || {}
  try {
    const classic = opts.chain === 'classic' || opts.backend === 'cpu' || opts.backend === 'gpu'
    if (classic) {
      const backend = opts.backend === 'gpu' ? 'gpu' : 'cpu'
      await getZpow(backend).start(wallet, Object.assign({}, opts, { chain: 'classic', backend }))
      return { ok: true }
    }
    await getMiner().start(wallet, opts)
    return { ok: true }
  } catch (err) { return { ok: false, error: err.message, code: err.code } }
})
ipcMain.handle('miner:gpu', async () => { try { return await getMiner().gpu() } catch (err) { return { nvidia: false, names: [], error: err.message } } })
ipcMain.handle('miner:caps', () => { try { return getZpow('cpu').capabilities() } catch (err) { return { cpu: { available: false }, gpu: { available: false }, error: err.message } } })
ipcMain.handle('miner:stop', async (e, opts) => {
  opts = opts || {}
  try {
    if (!opts.chain) { await stopAllMiners(); return { ok: true } }
    if (opts.chain === 'classic') {
      const slot = opts.backend === 'cpu' ? zpowCpu : zpowGpu
      if (slot && slot.wantRunning) await slot.stop()
      return { ok: true }
    }
    if (miner && miner.wantRunning) await miner.stop()
    return { ok: true }
  } catch (err) { return { ok: false, error: err.message } }
})
ipcMain.handle('miner:status', () => minerSnapshot())
ipcMain.handle('miner:defender', async () => {
  try { await getMiner().defenderExclusion(); return { ok: true } } catch (err) { return { ok: false, error: err.message } }
})
ipcMain.handle('miner:openLogs', () => shell.openPath(path.join(getMiner().o.dataRoot, 'logs')))

// ---------------- keyfile backup + delete (1.1.2) ----------------
// Never lose a keyfile: copy it to Documents\ScdoWallet\备份\<YYYY-MM-DD>\, read the copy back and compare
// SHA-256 with the original, and only then remove the original. Any failure aborts before deletion.
const crypto = require('crypto')
const os = require('os')
// 2.0.3: the folder name is Traditional Chinese (備份). An existing folder with the
// simplified name is renamed once; if it cannot be renamed, the old folder keeps being used.
let _backupRoot = null
function backupRoot () {
  if (_backupRoot) return _backupRoot
  const base = path.join(app.getPath('documents'), 'ScdoWallet')
  const now = path.join(base, '備份')
  const legacy = path.join(base, '备份')
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
ipcMain.handle('menu:rebuild', () => { if (mainWindow) createMenu(mainWindow); return true })
const walletService = require('./src/main/walletService')
require('./src/main/remitService').register(ipcMain, walletService.decryptForRemit) // 2.0.12 匯款 sign-in

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
    backgroundColor: '#f3f5ff',
    icon: path.join(__dirname, 'src', 'img', 'app-icon.png'), // build/ is not packaged by electron-builder
    resizable: true,
    title: 'SCDO Wallet ' + app.getVersion(),
    webPreferences: {
      // the 2020 UI code uses require() in the page; it only ever loads local files (see
      // will-navigate / window-open guards below), never remote content.
      // 2.0.12: preload exposes window.scdo. Remittance signing goes through that allowlist;
      // the private key and bearer token stay in the main process.
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
      webSecurity: true,
      spellcheck: false
    }
  })
  mainWindow.loadFile('index.html')
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) { e.preventDefault(); if (/^https:\/\//.test(url)) shell.openExternal(url) }
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.on('closed', () => { mainWindow = null })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus() } })
  app.whenReady().then(() => {
    fixCors()
    session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(perm === 'clipboard-sanitized-write' || perm === 'clipboard-read'))
    createWindow()
    createMenu(mainWindow)
    ensureTray()
  })
}

function ensureTray () {
  if (tray) return tray
  try {
    let img = nativeImage.createFromPath(path.join(__dirname, 'src', 'img', 'app-icon.png'))
    if (!img.isEmpty()) img = img.resize({ width: 16, height: 16 })
    tray = new Tray(img)
    tray.setToolTip('SCDO Wallet')
    updateTray()
  } catch (e) { tray = null }
  return tray
}
function updateTray () {
  if (!tray) return
  const parts = []
  if (miner && miner.wantRunning) parts.push('Shard0 ' + ((miner.status().mode) || ''))
  if (zpowCpu && zpowCpu.wantRunning) parts.push('Classic CPU')
  if (zpowGpu && zpowGpu.wantRunning) parts.push('Classic GPU')
  const running = parts.length > 0
  const label = running ? parts.join(' · ') : '未在挖礦 / Not mining'
  tray.setToolTip('SCDO Wallet — ' + label)
  tray.setContextMenu(Menu.buildFromTemplate([
    { label, enabled: false },
    { label: running ? '停止挖礦 / Stop mining' : '未在挖礦 / Not mining', enabled: running, click: () => { stopAllMiners().catch(() => {}) } },
    { type: 'separator' },
    { label: '顯示錢包 / Show wallet', click: () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus() } } }
  ]))
}

let quitting = false
app.on('before-quit', (e) => {
  const busy = (miner && miner.wantRunning) || (zpowCpu && zpowCpu.wantRunning) || (zpowGpu && zpowGpu.wantRunning)
  if (quitting || !busy) return
  e.preventDefault(); quitting = true
  stopAllMiners().finally(() => app.quit())
})

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', function () {
  if (mainWindow === null) {
    createWindow()
    createMenu(mainWindow)
  }
})
