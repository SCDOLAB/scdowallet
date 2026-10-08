// SCDO Wallet 2.0.1 preload (runs with contextIsolation + sandbox).
// The renderer gets NO Node.js and NO raw ipcRenderer. It only sees window.scdo with:
//   invoke(channel, ...args)  - request/response, channel must be in INVOKE (allowlist)
//   on(channel, cb)           - main -> renderer events, channel must be in EVENTS (allowlist); returns an unsubscribe fn
//   platform                  - process.platform (string, read-only)
// Keyfile decryption, signing, file access and network calls all happen in the main process.
'use strict'
const { contextBridge, ipcRenderer } = require('electron')

const INVOKE = Object.freeze([
  // app / shell
  'app:info', 'app:mem', 'app:titles', 'app:updatedSeen', 'shell:openExternal', 'menu:rebuild',
  // wallet (main-process wallet service: keyfiles, balances, signing)
  'wallet:boot', 'wallet:accounts', 'wallet:saveUi', 'wallet:setLang',
  'acct:create', 'acct:unlock', 'acct:import',
  's0:chainInfo', 's0:balances', 's0:activity', 's0:refreshPending', 's0:waitReceipt', 's0:checkAddress', 's0:estimate', 's0:review', 's0:send', 's0:cancelReview',
  'old:balance', 'old:records', 'old:estimateGas', 'old:send',
  // keyfile backup / delete
  'keyfile:paths', 'keyfile:backupDelete', 'keyfile:backupOnly', 'keyfile:openBackups',
  // updater
  'update:check', 'update:download', 'update:install', 'update:skip', 'update:getChannel', 'update:setChannel', 'about:buildHash',
  // miner
  'miner:start', 'miner:stop', 'miner:confirmStop', 'miner:status', 'miner:gpu', 'miner:intent', 'miner:intentClear', 'miner:intentMigrate',
  'miner:otherRigels', 'miner:resumeCheck', 'miner:defender', 'miner:openLogs',
  'miner:caps', 'miner:classicStatus',
  // mining batch 1
  'mining:gpuPreflight', 'mining:gpuTemp', 'mining:networkStats', 'mining:exportLogs', 'mining:getConfig', 'mining:setConfig', 'mining:setKeepMining',
  // 2.0.7: mining notification toggles, pool payout card
  'notify:get', 'notify:set', 'pool:account',
  // 2.0.12: 匯款 sign-in (decrypt + personal_sign + token stay in main)
  'remit:info', 'remit:login', 'remit:ledger', 'remit:logout'
])
const EVENTS = Object.freeze(['miner:status', 'miner:classic', 'update:available', 'update:progress', 'update:done', 'menu:action', 'remit:step'])

function invoke (channel, ...args) {
  if (typeof channel !== 'string' || !INVOKE.includes(channel)) return Promise.reject(new Error('IPC channel not allowed: ' + String(channel)))
  return ipcRenderer.invoke(channel, ...args)
}
function on (channel, cb) {
  if (typeof channel !== 'string' || !EVENTS.includes(channel) || typeof cb !== 'function') throw new Error('IPC event not allowed: ' + String(channel))
  const h = (_e, ...args) => cb(...args) // never hand the IpcRendererEvent (it carries `sender`) to the page
  ipcRenderer.on(channel, h)
  return () => ipcRenderer.removeListener(channel, h)
}

contextBridge.exposeInMainWorld('scdo', Object.freeze({ invoke, on, platform: process.platform }))
