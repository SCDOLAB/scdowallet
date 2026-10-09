// SCDO Wallet 2.0.12: application menu follows wallet language (EN / CN=繁體中文).
// Menu items talk to the page with the allowlisted 'menu:action' event instead of executeJavaScript.
const { Menu, app, shell } = require('electron')
const { menuLang } = require('./uiLang')

const LABELS = {
  EN: {
    app: 'SCDO Wallet',
    toggleDevTools: 'Toggle Developer Tools',
    version: (v) => 'Version ' + v,
    minimize: 'Minimize Window',
    fullscreen: 'Toggle Fullscreen',
    close: 'Close Window (keep running in the tray)',
    file: 'File',
    create: 'Create a New Address (any of Shard0–Shard4)…',
    import: 'Import Wallet (keyfile or private key)…',
    backup: 'Back Up Accounts…',
    manage: 'Manage Accounts (rename, hide, delete)…',
    mineStart: 'Start Mining',
    mineStop: 'Stop Mining…',
    reward: 'Change the Block Reward Address…',
    mineSettings: 'Mining Settings (shard, graphics card or processor)…',
    send: 'Transfer…',
    remitItem: 'Remittance…',
    remitLogout: 'Sign Out of the Remittance Gateway',
    catShow: 'Show AI小貓',
    edit: 'Edit',
    copy: 'Copy',
    paste: 'Paste',
    selectAll: 'Select All',
    refresh: 'Refresh',
    view: 'View',
    home: 'Home',
    accounts: 'Accounts',
    mining: 'Mining',
    miningHome: 'Mining status',
    settings: 'Settings / Network Info…',
    remit: 'Remittance',
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
    create: '建立新地址（Shard0–Shard4 任選）…',
    import: '匯入錢包（帳戶檔案或私鑰）…',
    backup: '備份帳戶…',
    manage: '管理帳戶（改名稱、隱藏、刪除）…',
    mineStart: '開始挖礦',
    mineStop: '停止挖礦…',
    reward: '更改出塊獎勵地址…',
    mineSettings: '挖礦設定（分片、顯卡或處理器）…',
    send: '轉帳…',
    remitItem: '匯款…',
    remitLogout: '登出匯款閘道',
    catShow: '顯示 AI小貓',
    edit: '編輯',
    copy: '複製',
    paste: '貼上',
    selectAll: '全選',
    refresh: '重新整理',
    view: '檢視',
    home: '首頁',
    accounts: '帳戶',
    mining: '挖礦',
    miningHome: '挖礦狀態',
    settings: '設定 / 網路資訊…',
    remit: '匯款',
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
      label: L.mining,
      submenu: [
        { label: L.miningHome, click: act('mineHome') }
      ]
    },
    {
      label: L.file,
      submenu: [
        // 3.0.2: every action is reachable by hand here, so the wallet stays usable without AI小貓
        { label: L.create, accelerator: 'CmdOrCtrl+N', click: act('create') },
        { label: L.import, accelerator: 'CmdOrCtrl+I', click: act('import') },
        { label: L.backup, accelerator: 'CmdOrCtrl+B', click: act('backup') },
        { label: L.manage, click: act('manage') },
        { type: 'separator' },
        { label: L.mineStart, accelerator: 'CmdOrCtrl+G', click: act('mineStart') },
        { label: L.mineStop, accelerator: 'CmdOrCtrl+Shift+G', click: act('mineStop') },
        { label: L.reward, click: act('reward') },
        { label: L.mineSettings, click: act('mineSettings') }
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
        // 3.0.2: page switching lives here and on the Home cards (no tab bar)
        { label: L.home, accelerator: 'CmdOrCtrl+1', click: act('home') },
        { label: L.accounts, accelerator: 'CmdOrCtrl+2', click: act('acc') },
        { label: L.mining, accelerator: 'CmdOrCtrl+3', click: act('mine') },
        { label: L.remit, accelerator: 'CmdOrCtrl+4', click: () => openRemittance() },
        { type: 'separator' },
        { label: L.settings, accelerator: 'CmdOrCtrl+E', click: act('settings') }
      ]
    },
    {
      label: L.remit,
      submenu: [
        { label: L.send, accelerator: 'CmdOrCtrl+T', click: act('send') },
        { label: L.remitItem, accelerator: 'CmdOrCtrl+P', click: act('remit') },
        { label: L.remitLogout, click: act('remitLogout') }
      ]
    },
    {
      label: L.help,
      role: 'help',
      submenu: [
        { label: L.catShow, click: act('catShow') },
        { type: 'separator' },
        { label: L.learnMore, click: () => shell.openExternal('https://scdoscan.io/downloads/wallet/') }
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
