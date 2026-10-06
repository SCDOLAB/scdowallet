// SCDO Wallet preload. This repo's page still has Node (keyfiles, balances, miner UI).
// 2.0.12 匯款 does not use that: the page calls window.scdo, and only the channels below are allowed.
// Keyfile decryption, EIP-191 personal_sign and the bearer token stay in the main process.
'use strict'
const { contextBridge, ipcRenderer } = require('electron')

const INVOKE = Object.freeze([
  'app:info', 'shell:openExternal', 'dialog:open', 'menu:rebuild',
  'miner:start', 'miner:stop', 'miner:status', 'miner:gpu', 'miner:defender', 'miner:openLogs',
  'keyfile:paths', 'keyfile:backupDelete', 'keyfile:backupOnly', 'keyfile:openBackups',
  // 2.0.12: 匯款 sign-in (decrypt + personal_sign + token stay in main)
  'remit:info', 'remit:login', 'remit:ledger', 'remit:logout'
])
const EVENTS = Object.freeze(['miner:status', 'remit:step'])

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

const api = Object.freeze({ invoke, on, platform: process.platform })
if (process.contextIsolated) contextBridge.exposeInMainWorld('scdo', api)
else window.scdo = api
