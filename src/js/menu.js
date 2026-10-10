// SCDO Wallet: application menu follows wallet language (EN / CN = 華語繁體).
// Menu items talk to the page with the allowlisted 'menu:action' event instead of executeJavaScript.
// The site list is src/js/siteNavMap.js, shared with the in-app bar and AI小貓.
const { Menu, app, shell } = require('electron')
const { menuLang } = require('./uiLang')
const siteNav = require('./siteNavMap')

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
    mining: '運算服務',
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
  const cn = menuLang(lang) !== 'EN'
  const act = (a) => () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('menu:action', a) }
  // Remittance stays on the allowlisted menu:action channel. The page opens the tab in openRemittance().
  function openRemittance () { act('remit')() }
  function openExternal (href) {
    const target = siteNav.url(href)
    if (shell && shell.openExternal) shell.openExternal(target)
  }
  function leaf (it) {
    if (it.action === 'home') return { label: L.home, accelerator: 'CmdOrCtrl+1', click: act('home') }
    if (it.action === 'recv') return { label: L.receive, accelerator: 'CmdOrCtrl+2', click: act('recv') }
    if (it.action === 'remit') return { label: L.remitItem, accelerator: 'CmdOrCtrl+T', click: () => openRemittance() }
    if (it.action === 'mineHome') return { label: L.mining, accelerator: 'CmdOrCtrl+3', click: act('mineHome') }
    if (it.action === 'settings') return { label: L.navSettings, accelerator: 'CmdOrCtrl+E', click: act('settings') }
    if (it.action === 'create') return { label: L.create, click: act('create') }
    if (it.action === 'import') return { label: L.import, click: act('import') }
    if (it.action) return { label: cn ? it.cn : it.en, click: act(it.action) }
    if (it.href) return { label: cn ? it.cn : it.en, click: () => openExternal(it.href) }
    return { label: cn ? it.cn : it.en, enabled: false }
  }
  function group (g) {
    const label = cn ? g.cn : g.en
    if (g.children && g.children.length) return { label: label, submenu: g.children.map(leaf) }
    return { label: label, submenu: [leaf(g)] }
  }
  const appMenu = {
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
  }
  const editMenu = {
    label: L.edit,
    submenu: [
      { label: L.copy, accelerator: 'CmdOrCtrl+C', role: 'copy' },
      { label: L.paste, accelerator: 'CmdOrCtrl+V', role: 'paste' },
      { label: L.selectAll, accelerator: 'CmdOrCtrl+A', role: 'selectAll' },
      { label: L.refresh, accelerator: 'CmdOrCtrl+R', click: () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload() } }
    ]
  }
  return [appMenu, editMenu].concat(siteNav.GROUPS.map(group))
}

function createMenu (mainWindow, lang) {
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildTemplate(mainWindow, menuLang(lang))))
}

module.exports.createMenu = createMenu
module.exports.buildTemplate = buildTemplate
module.exports.LABELS = LABELS
