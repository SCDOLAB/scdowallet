// SCDO Wallet 2.0.12: application menu follows wallet language (EN / CN=繁體中文).
// Menu items talk to the page with the allowlisted 'menu:action' event instead of executeJavaScript.
const { Menu, app } = require('electron')
const { menuLang } = require('./uiLang')

const LABELS = {
  EN: {
    app: 'SCDO Wallet',
    toggleDevTools: 'Toggle Developer Tools',
    version: (v) => 'Version ' + v,
    minimize: 'Minimize Window',
    fullscreen: 'Toggle Fullscreen',
    close: 'Close Window (keep running in the tray)',
    wallet: 'Wallet (balance, send, receive)',
    create: 'Create a New Address (any of Shard0–Shard4)…',
    import: 'Import Wallet (keyfile or private key)…',
    backupSec: 'Backup and security',
    backup: 'Back Up Accounts…',
    openBackups: 'Open the Backup Folder',
    manage: 'Manage Accounts (rename, hide, delete)…',
    mineSettings: 'Mining settings (shard, graphics card or processor)…',
    remitItem: 'Send…',
    remitLogout: 'Sign Out of the Remittance Gateway',
    catShow: 'Show AI小貓',
    edit: 'Edit',
    copy: 'Copy',
    paste: 'Paste',
    selectAll: 'Select All',
    refresh: 'Refresh',
    home: 'Home',
    receive: 'Receive',
    remit: 'Send',
    accounts: 'Accounts',
    mining: 'Mining',
    navSettings: 'Settings',
    miningHome: 'Mining status',
    settingsCat: 'Settings (language, notifications, updates)',
    settings: 'Language, notifications and updates…',
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
    wallet: '錢包（餘額・匯款・收款）',
    create: '建立新地址（Shard0–Shard4 任選）…',
    import: '匯入錢包（帳戶檔案或私鑰）…',
    backupSec: '備份與安全',
    backup: '備份帳戶…',
    openBackups: '開啟備份資料夾',
    manage: '管理帳戶（改名稱、隱藏、刪除）…',
    mineSettings: '挖礦設定（分片、顯卡或處理器）…',
    remitItem: '匯款…',
    remitLogout: '登出匯款閘道',
    catShow: '顯示 AI小貓',
    edit: '編輯',
    copy: '複製',
    paste: '貼上',
    selectAll: '全選',
    refresh: '重新整理',
    home: '首頁',
    receive: '收款',
    remit: '匯款',
    accounts: '帳戶',
    mining: '挖礦',
    navSettings: '設定',
    miningHome: '挖礦狀態',
    settingsCat: '設定（語言・通知・更新）',
    settings: '語言、通知與更新…',
    help: '說明',
    learnMore: '了解更多'
  }
}

function buildTemplate (mainWindow, lang) {
  const L = LABELS[menuLang(lang)]
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
      label: L.edit,
      submenu: [
        { label: L.copy, accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: L.paste, accelerator: 'CmdOrCtrl+V', role: 'paste' },
        { label: L.selectAll, accelerator: 'CmdOrCtrl+A', role: 'selectAll' },
        { label: L.refresh, accelerator: 'CmdOrCtrl+R', click: () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload() } }
      ]
    },
    {
      label: L.home,
      submenu: [
        { label: L.home, accelerator: 'CmdOrCtrl+1', click: act('home') }
      ]
    },
    {
      label: L.receive,
      submenu: [
        { label: L.receive, accelerator: 'CmdOrCtrl+2', click: act('recv') }
      ]
    },
    {
      label: L.remit,
      submenu: [
        { label: L.remitItem, accelerator: 'CmdOrCtrl+T', click: () => openRemittance() }
      ]
    },
    {
      label: L.mining,
      submenu: [
        { label: L.mining, accelerator: 'CmdOrCtrl+3', click: act('mineHome') }
      ]
    },
    {
      label: L.navSettings,
      submenu: [
        { label: L.navSettings, accelerator: 'CmdOrCtrl+E', click: act('settings') }
      ]
    }
  ]
}

function createMenu (mainWindow, lang) {
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildTemplate(mainWindow, menuLang(lang))))
}

module.exports.createMenu = createMenu
module.exports.buildTemplate = buildTemplate
module.exports.LABELS = LABELS
