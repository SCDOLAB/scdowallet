// SCDO Wallet 2.0.12: application menu follows wallet language (EN / CN=繁體中文).
// Menu items talk to the page with the allowlisted 'menu:action' event instead of executeJavaScript.
const { Menu, app, shell } = require('electron')

const LABELS = {
  EN: {
    app: 'SCDO Wallet',
    toggleDevTools: 'Toggle Developer Tools',
    version: (v) => 'Version ' + v,
    minimize: 'Minimize Window',
    fullscreen: 'Toggle Fullscreen',
    close: 'Close Window (keep running in the tray)',
    file: 'File',
    create: 'Create Account',
    import: 'Import Keyfile(s)',
    edit: 'Edit',
    copy: 'Copy',
    paste: 'Paste',
    selectAll: 'Select All',
    refresh: 'Refresh',
    view: 'View',
    settings: 'Settings / Network Info',
    remit: 'Send',
    help: 'Help',
    learnMore: 'Learn More'
  },
  CN: {
    app: 'SCDO 錢包',
    toggleDevTools: '切換開發人員工具',
    version: (v) => '版本 ' + v,
    minimize: '最小化視窗',
    fullscreen: '切換全螢幕',
    close: '關閉視窗（繼續在系統匣執行）',
    file: '檔案',
    create: '建立帳戶',
    import: '匯入金鑰檔',
    edit: '編輯',
    copy: '複製',
    paste: '貼上',
    selectAll: '全選',
    refresh: '重新整理',
    view: '檢視',
    settings: '設定 / 網路資訊',
    remit: '匯款',
    help: '說明',
    learnMore: '了解更多'
  }
}

function buildTemplate (mainWindow, lang) {
  const L = LABELS[lang === 'CN' ? 'CN' : 'EN']
  const act = (a) => () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('menu:action', a) }
  // Remittance stays on the allowlisted menu:action channel. The page opens the tab in openRemittance().
  function openRemittance () { act('remit')() }
  return [
    {
      label: L.app,
      submenu: [
        { label: L.toggleDevTools, accelerator: 'CmdOrCtrl+Shift+I', role: 'toggleDevTools' },
        { label: L.version(app.getVersion()), enabled: false },
        { type: 'separator' },
        { label: L.minimize, accelerator: 'CmdOrCtrl+M', role: 'minimize' },
        { label: L.fullscreen, accelerator: 'CmdOrCtrl+Shift+F', role: 'togglefullscreen' },
        // 2.0.6: closing the window hides the wallet to the tray (mining keeps running); quitting is done from the tray menu
        { label: L.close, accelerator: 'CmdOrCtrl+W', role: 'close' }
      ]
    },
    {
      label: L.file,
      submenu: [
        { label: L.create, accelerator: 'CmdOrCtrl+N', click: act('create') },
        { label: L.import, accelerator: 'CmdOrCtrl+I', click: act('import') }
      ]
    },
    {
      label: L.edit,
      submenu: [
        { label: L.copy, accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: L.paste, accelerator: 'CmdOrCtrl+V', role: 'paste' },
        { label: L.selectAll, accelerator: 'CmdOrCtrl+A', role: 'selectAll' },
        { label: L.refresh, accelerator: 'CmdOrCtrl+R', click: () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload() } }
      ]
    },
    {
      label: L.view,
      submenu: [
        { label: L.settings, accelerator: 'CmdOrCtrl+E', click: act('settings') }
      ]
    },
    { label: L.remit, click: () => openRemittance() },
    {
      label: L.help,
      role: 'help',
      submenu: [
        { label: L.learnMore, click: () => shell.openExternal('https://scdoscan.io/downloads/wallet/') }
      ]
    }
  ]
}

function createMenu (mainWindow, lang) {
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildTemplate(mainWindow, lang === 'CN' ? 'CN' : 'EN')))
}

module.exports.createMenu = createMenu
module.exports.buildTemplate = buildTemplate
module.exports.LABELS = LABELS
