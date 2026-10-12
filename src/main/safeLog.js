// 2.0.2 (EPIPE fix): main-process logging that can never crash the app.
// - stdout/stderr 'error' events (EPIPE / ERR_STREAM_DESTROYED when the launching console or pipe closes) are swallowed.
// - When stdout is not a TTY (packaged app, launched from a pipe/service/shortcut), console.* goes to a rotating file
//   %APPDATA%\ScdoWalletBeta\logs\main.log (1 MB x 3) instead of the console.
// - uncaughtException / unhandledRejection are logged and the app keeps running (no Electron error dialog).
'use strict'
const fs = require('fs')
const path = require('path')
const util = require('util')
const MAX = 1024 * 1024, KEEP = 3
let dir = null, file = null, size = -1
function logDir () {
  if (dir) return dir
  try { const { app } = require('electron'); dir = path.join(app.getPath('appData'), 'ScdoWalletBeta', 'logs') } catch (e) { dir = path.join(require('os').tmpdir(), 'ScdoWalletBeta-logs') }
  return dir
}
function rotate () {
  try {
    for (let i = KEEP - 1; i >= 1; i--) { const a = file + (i === 1 ? '' : '.' + (i - 1)), b = file + '.' + i; if (fs.existsSync(a)) fs.renameSync(a, b) }
  } catch (e) {}
  size = 0
}
function writeLine (level, args) {
  try {
    if (!file) { fs.mkdirSync(logDir(), { recursive: true }); file = path.join(logDir(), 'main.log') }
    if (size < 0) { try { size = fs.statSync(file).size } catch (e) { size = 0 } }
    const line = new Date().toISOString() + ' [' + level + '] ' + util.format.apply(null, args).replace(/\r?\n/g, '\n    ') + '\n'
    if (size + line.length > MAX) rotate()
    fs.appendFileSync(file, line); size += Buffer.byteLength(line)
  } catch (e) { /* logging must never throw */ }
}
function ignoreStreamErrors (st) {
  if (!st || st.__scdoSafe) return
  st.__scdoSafe = true
  try { st.on('error', err => { if (!err || (err.code !== 'EPIPE' && err.code !== 'ERR_STREAM_DESTROYED' && err.code !== 'EOF')) writeLine('error', ['stdio error', err && err.code, err && err.message]) }) } catch (e) {}
}
function install () {
  if (global.__scdoSafeLog) return global.__scdoSafeLog
  ignoreStreamErrors(process.stdout); ignoreStreamErrors(process.stderr)
  const tty = !!(process.stdout && process.stdout.isTTY)
  const orig = {}
  for (const lv of ['log', 'info', 'warn', 'error', 'debug']) {
    orig[lv] = console[lv].bind(console)
    console[lv] = (...a) => {
      if (!tty) return writeLine(lv, a)
      try { orig[lv](...a) } catch (e) { writeLine(lv, a) }
    }
  }
  process.on('uncaughtException', err => { writeLine('fatal', ['uncaughtException (kept running):', err && err.stack || err]) })
  process.on('unhandledRejection', r => { writeLine('fatal', ['unhandledRejection (kept running):', r && r.stack || r]) })
  global.__scdoSafeLog = { tty, file: () => file || path.join(logDir(), 'main.log'), write: writeLine }
  return global.__scdoSafeLog
}
module.exports = install()
