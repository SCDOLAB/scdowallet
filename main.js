// ScdoWallet main process (2026-09 upgrade: Electron 44, no `remote`, shard0 EVM + built-in GPU miner)
const { shell, BrowserWindow, app, ipcMain, dialog, session } = require('electron')
const path = require('path')
const fs = require('fs')

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

// ---------------- built-in shard0 miner ----------------
const { MinerManager } = require('./src/miner/manager')
function minerBinDir () {
  if (app.isPackaged) return path.join(process.resourcesPath, 'miner', 'bin')
  return path.join(__dirname, 'miner-bin', process.platform)
}
let miner = null
function getMiner () {
  if (!miner) {
    const res = app.isPackaged ? path.join(process.resourcesPath, 'miner') : path.join(__dirname, 'miner-bin')
    miner = new MinerManager({
      binDir: minerBinDir(),
      genesis: path.join(res, 'scdo-shard0-genesis.json'),
      dataRoot: process.env.SCDO_MINER_DIR || minerDataRoot(),
      rigelExe: process.env.SCDO_RIGEL_EXE || undefined
    })
    miner.on('status', st => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('miner:status', st) })
  }
  return miner
}
ipcMain.handle('miner:start', async (e, wallet, opts) => {
  try { await getMiner().start(wallet, opts || {}); return { ok: true } } catch (err) { return { ok: false, error: err.message, code: err.code } }
})
ipcMain.handle('miner:gpu', async () => { try { return await getMiner().gpu() } catch (err) { return { nvidia: false, names: [], error: err.message } } })
ipcMain.handle('miner:stop', async () => { if (miner) await miner.stop(); return { ok: true } })
ipcMain.handle('miner:status', () => getMiner().status())
ipcMain.handle('miner:defender', async () => {
  try { await getMiner().defenderExclusion(); return { ok: true } } catch (err) { return { ok: false, error: err.message } }
})
ipcMain.handle('miner:openLogs', () => shell.openPath(path.join(getMiner().o.dataRoot, 'logs')))

// ---------------- keyfile backup + delete (1.1.2) ----------------
// Never lose a keyfile: copy it to Documents\ScdoWallet\备份\<YYYY-MM-DD>\, read the copy back and compare
// SHA-256 with the original, and only then remove the original. Any failure aborts before deletion.
const crypto = require('crypto')
const os = require('os')
function backupRoot () { return path.join(app.getPath('documents'), 'ScdoWallet', '备份') }
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
    title: 'ScdoWalletBeta ' + app.getVersion(),
    webPreferences: {
      // the 2020 UI code uses require() in the page; it only ever loads local files (see
      // will-navigate / window-open guards below), never remote content.
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
  })
}

let quitting = false
app.on('before-quit', (e) => {
  if (quitting || !miner || !miner.wantRunning) return
  e.preventDefault(); quitting = true
  miner.stop().finally(() => app.quit())
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
