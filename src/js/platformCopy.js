// 3.0.8: a few settings lines name the operating system. Windows strings stay as written.
// Mac uses window.scdo.platform from preload.js ('darwin'). The backup folder the app
// writes is app.getPath('documents')/ScdoWallet/備份, shown as ~/Documents/ScdoWallet.
'use strict'
;(function () {
  const MAC_BACKUP_DISPLAY = '~/Documents/ScdoWallet'
  function copyText (pack, key, platform) {
    if (!pack) return undefined
    if (platform === 'darwin' && pack[key + 'Darwin'] != null) return pack[key + 'Darwin']
    return pack[key]
  }
  const api = { MAC_BACKUP_DISPLAY, copyText }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (typeof window !== 'undefined') window.SCDOPlatformCopy = api
})()
