// Tray: show the window, a status line, and quit. Start and stop mining are the Home card.
// Keep mining stays on the mining settings page. Hashrate is in the tray tooltip.
// and a Windows taskbar overlay badge (green = mining, grey = stopped, red = error).
'use strict'
const path = require('path')
const { Tray, Menu, nativeImage, BrowserWindow, screen } = require('electron')
const { tooltipError, minersRunning } = require('../js/minerStartError')
const { TRAY_COPY } = require('../miner/guardPlan')

function humaneRate (h) {
  const n = Number(h)
  if (!Number.isFinite(n) || n <= 0) return '0 H/s'
  const trim = (x) => x.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
  if (n >= 1e9) return trim(n / 1e9) + ' GH/s'
  if (n >= 1e6) return trim(n / 1e6) + ' MH/s'
  if (n >= 1e3) return trim(n / 1e3) + ' kH/s'
  return Math.round(n).toLocaleString('en-US') + ' H/s'
}
function fmtHash (h, lang) {
  const rate = humaneRate(h)
  if (lang === 'CN') return '記帳速度 ' + rate
  return 'Bookkeeping speed ' + rate
}
// macOS uses a monochrome template glyph (never a solid colour square).
// Windows uses the coloured logo .ico, with a small corner dot for state.
function trayIconFile (platform, st) {
  const colour = st && st.guard && st.guard.colour
  const running = !!(st && (st.running || (st.classicNote && st.phase !== 'error')))
  if (platform === 'darwin') {
    if (colour === 'blue' || colour === 'yellow' || colour === 'red') return 'tray/trayTemplate-dot.png'
    if (colour === 'green' || running) return 'tray/trayTemplate-on.png'
    return 'tray/trayTemplate.png'
  }
  if (platform === 'win32') {
    if (colour === 'red') return 'tray/tray-error.ico'
    if (colour === 'blue' || colour === 'yellow') return 'tray/tray-pause.ico'
    if (colour === 'green' || running) return 'tray/tray-on.ico'
    return 'tray/tray.ico'
  }
  return 'icon-32.png'
}

// state of the badge for a miner status object
function badgeState (st) {
  if (st && st.guard && (st.guard.colour === 'green' || st.guard.colour === 'yellow' || st.guard.colour === 'blue' || st.guard.colour === 'red' || st.guard.colour === 'grey')) return st.guard.colour
  if (!st) return 'grey'
  if (st.phase === 'error') return 'red'
  if (st.running && (st.mode === 'mine' || st.mode === 'pool')) return 'green'
  if (st.classicNote) return 'green'
  return 'grey'
}
// 2.0.6: tray texts follow the wallet language ('CN' = 華語繁體)
const TL = {
  EN: { show: 'Show SCDO Wallet', notMining: 'Not bookkeeping', minerError: 'Bookkeeping node error', nodeOnly: 'Node only (not bookkeeping)', nodeOnlyShort: 'Node only', mining: 'Bookkeeping: ', starting: 'Bookkeeping node starting…', stop: 'Stop bookkeeping', keep: 'Keep bookkeeping (restart the bookkeeping node if it exits)', quit: 'Quit', pauseHour: 'Pause for 1 hour', pauseToday: 'Pause for today', pauseClear: 'Resume bookkeeping', modeLight: 'Mode: Light', modeFull: 'Mode: Full', login: 'Launch at login (start minimised in tray)', light: 'Light mode', paceGpu: 'Lower graphics card effort', paceIdle: 'Pause while I am using this computer', agentOnline: 'Online · keep app running', agentOffline: 'Offline · goes online when the wallet is open' },
  CN: { show: '顯示 SCDO Wallet', notMining: '未在記帳', minerError: '記帳節點出錯', nodeOnly: '只執行節點（未記帳）', nodeOnlyShort: '只執行節點', mining: '記帳中：', starting: '記帳節點啟動中…', stop: '停止記帳', keep: '持續記帳（記帳節點退出時自動重新啟動）', quit: '結束', pauseHour: '暫停 1 小時', pauseToday: '今天暫停', pauseClear: '恢復記帳', modeLight: '模式：輕量', modeFull: '模式：完整', login: '登入時啟動（最小化到系統匣）', light: '輕量模式', paceGpu: '降低顯卡出力', paceIdle: '我在用電腦時暫停記帳', agentOnline: '在線·請保持程式執行', agentOffline: '離線·開啟錢包後自動上線' }
}
// The tray paints guard.colour from the snapshot. It does not write the state machine.
function guardLine (st, lang) {
  const colour = st && st.guard && st.guard.colour
  const row = TRAY_COPY[colour]
  if (!row) return ''
  return row[lang === 'EN' ? 'EN' : 'CN']
}

function tooltipText (version, st, lang, mode) {
  const line = tooltipBody(version, st, lang)
  if (mode !== 'light' && mode !== 'full') return line
  const extra = mode === 'light' ? (lang === 'EN' ? 'Mode: Light' : '模式：輕量') : (lang === 'EN' ? 'Mode: Full' : '模式：完整')
  return (line + '\n' + extra).slice(0, 127)
}

function tooltipBody (version, st, lang) {
  const L = TL[lang] || TL.CN
  const head = 'SCDO Wallet ' + version
  const promised = guardLine(st, lang)
  if (promised) return (head + '\n' + promised).slice(0, 127)
  let line
  const classic = st && st.classicNote
  if (classic && !st.running && st.phase !== 'error') {
    let held = head + '\n' + L.mining + classic
    if (st.guard && st.guard.reason) held += '\n' + st.guard.reason
    return held.slice(0, 127)
  }
  if (!st || (!st.running && st.phase !== 'error')) line = head + '\n' + L.notMining
  else if (st.phase === 'error') line = head + '\n' + tooltipError(lang, st.code, st.message)
  else if (st.mode === 'node') line = head + '\n' + L.nodeOnly
  else if (st.code === 'MINING') line = head + '\n' + L.mining + fmtHash(st.hashrate, lang)
  else line = head + '\n' + L.starting + ' ' + (st.hashrate > 0 ? fmtHash(st.hashrate, lang) : '')
  if (st && st.classicNote) line += '\n' + st.classicNote
  if (st && st.guard && st.guard.reason) line += '\n' + st.guard.reason
  return line.slice(0, 127)
}

function escHtml (s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

const REASON_EN = { '電池': 'battery', '全螢幕': 'full screen', '記憶體': 'memory', '溫度': 'temperature', '重新啟動': 'too many restarts', '睡眠': 'sleep', '磁碟': 'disk space', '手動': 'paused by you', '異常': 'abnormal', '不適合': 'this computer is a poor fit', '虛擬機': 'virtual machine', '使用中': 'you are using this computer' }
const ACTION_EN = {
  '因電池暫停': 'Paused because of the battery',
  '因全螢幕暫停': 'Paused because a program is full screen',
  '因溫度暫停': 'Paused because the graphics card is hot',
  '因記憶體暫停': 'Paused because memory is low',
  '重新啟動太多次，已暫停': 'Paused after too many restarts',
  '執行緒減半': 'Thread count cut in half',
  '恢復執行緒': 'Thread count restored',
  '重新啟動記帳節點': 'Bookkeeping node restarted',
  '溫度過高，已降低強度': 'Graphics card is hot, so intensity is lower',
  '因睡眠暫停': 'Paused while the computer sleeps',
  '磁碟空間不足，已暫停記帳': 'Paused because the disk is nearly full',
  '已暫停一段時間': 'Paused for a while',
  '異常': 'abnormal',
  '記帳遇到麻煩，已停止重試。請將錢包加入防毒軟體的允許清單。': 'Bookkeeping stopped retrying. Allow the wallet in your security software.',
  '此裝置不適合記帳': 'This computer is a poor fit for bookkeeping',
  '我在用電腦，已暫停記帳': 'Paused while you are using this computer',
  '已降低顯卡出力': 'Graphics card effort is lower',
  '虛擬機中記帳效率極低，建議關閉': 'Bookkeeping inside a virtual machine is very slow. Leaving it off is recommended.'
}

function panelHtml (guard, lang) {
  const g = guard || {}
  const cn = lang !== 'EN'
  const chains = Array.isArray(g.chains) ? g.chains : []
  const rows = chains.length ? chains.map(c => {
    const when = c.lastShareAt ? new Date(c.lastShareAt).toLocaleString() : (cn ? '—' : '-')
    const speed = c.hashrate > 0 ? fmtHash(c.hashrate, cn ? 'CN' : 'EN') : (cn ? '—' : '-')
    const name = (c.shard === 0 || c.shard) ? ('Shard' + c.shard) : (cn ? '記帳' : 'Bookkeeping')
    return '<tr><td>' + escHtml(name) + '</td><td>' + escHtml(c.status || '') + '</td><td>' + escHtml(speed) + '</td><td>' + escHtml(when) + '</td></tr>'
  }).join('') : '<tr><td colspan="4">' + (cn ? '未在記帳' : 'Not bookkeeping') + '</td></tr>'
  const title = cn ? '記帳狀態' : 'Bookkeeping status'
  const heads = cn ? ['鏈', '狀態', '速度', '上次份額'] : ['Chain', 'Status', 'Speed', 'Last share']
  const actionRaw = g.lastAction ? (cn ? g.lastAction : (ACTION_EN[g.lastAction] || g.lastAction)) : ''
  const action = actionRaw ? escHtml(actionRaw) : (cn ? '—' : '-')
  const reasonRaw = g.reason ? (cn ? g.reason : (REASON_EN[g.reason] || g.reason)) : ''
  const reason = reasonRaw ? escHtml(reasonRaw) : ''
  return '<!doctype html><html><head><meta charset="utf-8"><title>' + title + '</title><style>body{font:14px/1.4 sans-serif;margin:16px;color:#1c1c1e;background:#F2F2F7}h1{font-size:18px;margin:0 0 8px}table{width:100%;border-collapse:collapse;background:#fff}td,th{text-align:left;padding:6px 8px;border-bottom:1px solid #e5e5ea;font-weight:400}th{color:#8e8e93}.note{margin-top:12px}</style></head><body><h1>' + title + (reason ? ' · ' + reason : '') + '</h1><table><tr>' + heads.map(h => '<th>' + h + '</th>').join('') + '</tr>' + rows + '</table><p class="note">' + (cn ? '剛才的調整' : 'Last adjustment') + ': ' + action + '</p></body></html>'
}

class TrayStatus {
  // o: { assetsDir, version, getWindow, onStop, onQuit, onKeepMining(bool), getKeepMining(), isMinerActive() }
  constructor (o) {
    this.o = o
    this.img = (n) => nativeImage.createFromPath(path.join(o.assetsDir, n))
    this.badges = { green: this.img('overlay-green.png'), grey: this.img('overlay-grey.png'), red: this.img('overlay-red.png') }
    this.last = null
    this.lastBadge = null
    this.iconFile = trayIconFile(process.platform, null)
    const initial = process.platform === 'win32' ? path.join(o.assetsDir, this.iconFile) : this.prepareIcon(this.img(this.iconFile))
    this.tray = new Tray(initial)
    this.lang = o.lang === 'EN' ? 'EN' : 'CN'
    this.tray.setToolTip(tooltipText(o.version, null, this.lang))
    this.tray.on('click', () => this.openPanel())
    this.guardColour = null
    this.icons = null
    this.rebuild()
  }

  prepareIcon (img) {
    if (process.platform === 'darwin' && img && img.setTemplateImage) img.setTemplateImage(true)
    return img
  }
  applyTrayIcon (st) {
    if (!this.tray || this.tray.isDestroyed()) return
    const file = trayIconFile(process.platform, st)
    this.iconFile = file
    if (process.platform === 'win32') this.tray.setImage(path.join(this.o.assetsDir, file))
    else {
      const img = this.prepareIcon(this.img(file))
      if (img) this.tray.setImage(img)
    }
  }
  colourIcon (colour) {
    if (!this.icons) {
      const solid = (r, g, b) => {
        const size = 16
        const buf = Buffer.alloc(size * size * 4)
        for (let i = 0; i < size * size; i++) {
          const o = i * 4
          buf[o] = b
          buf[o + 1] = g
          buf[o + 2] = r
          buf[o + 3] = 255
        }
        try { return nativeImage.createFromBitmap(buf, { width: size, height: size }) } catch (e) { return null }
      }
      this.icons = { green: solid(29, 122, 52), yellow: solid(214, 164, 0), blue: solid(20, 110, 210), red: solid(180, 40, 40), grey: solid(142, 142, 147) }
    }
    return this.icons[colour] || null
  }

  placePanel (win) {
    try {
      const area = screen.getPrimaryDisplay().workArea
      const width = 400
      const height = 280
      win.setBounds({
        x: Math.max(area.x, area.x + area.width - width - 12),
        y: Math.max(area.y, area.y + area.height - height - 12),
        width,
        height
      })
    } catch (e) {}
  }

  openPanel () {
    try {
      const guard = (this.last && this.last.guard) || { colour: 'grey', chains: [], lastAction: '', reason: '' }
      const html = 'data:text/html;charset=utf-8,' + encodeURIComponent(panelHtml(guard, this.lang))
      if (this.panel && !this.panel.isDestroyed()) {
        this.placePanel(this.panel)
        this.panel.loadURL(html)
        this.panel.showInactive()
        return
      }
      this.panel = new BrowserWindow({
        width: 400,
        height: 280,
        show: false,
        alwaysOnTop: false,
        skipTaskbar: true,
        resizable: false,
        minimizable: false,
        maximizable: false,
        title: 'SCDO',
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
      })
      this.panel.on('closed', () => { this.panel = null })
      this.panel.once('ready-to-show', () => {
        if (!this.panel || this.panel.isDestroyed()) return
        this.placePanel(this.panel)
        this.panel.showInactive()
      })
      this.panel.loadURL(html)
    } catch (e) {}
  }

  L () { return TL[this.lang] || TL.CN }
  copy (key, fallback) {
    try {
      if (typeof this.o.string === 'function') {
        const v = this.o.string(key, fallback)
        if (typeof v === 'string' && v) return v
      }
    } catch (e) {}
    return fallback
  }
  agentOnline () { try { return !!(this.o.getAgentOnline && this.o.getAgentOnline()) } catch (e) { return false } }
  presenceItem () {
    const online = this.agentOnline()
    const L = this.L()
    const label = online ? this.copy('agentOnlineLine', L.agentOnline) : this.copy('agentOfflineLine', L.agentOffline)
    const item = { label: label, enabled: false }
    const icon = online ? this.badges.green : this.badges.grey
    try { if (icon && !icon.isEmpty()) item.icon = icon } catch (e) {}
    return item
  }
  session () { try { return (this.o.getSession && this.o.getSession()) || {} } catch (e) { return {} } }
  setLang (l) { const n = l === 'EN' ? 'EN' : 'CN'; if (n === this.lang) return; this.lang = n; this.sig = null; this.update(this.last); this.rebuild() }
  // 2.0.6: one-time Windows notification when the window is hidden to the tray
  balloon (title, content) { try { if (this.tray && !this.tray.isDestroyed() && process.platform === 'win32') this.tray.displayBalloon({ title, content, iconType: 'info', noSound: true }) } catch (e) {} }

  showWindow () { const w = this.o.getWindow(); if (w && !w.isDestroyed()) { if (w.isMinimized()) w.restore(); w.show(); w.focus() } }

  rebuild () {
    if (!this.tray || this.tray.isDestroyed()) return
    const st = this.last
    const L = this.L()
    const sess = this.session()
    const light = !!sess.light
    if (process.platform === 'linux') {
      const items = [
        { label: L.show, click: () => this.showWindow() },
        this.presenceItem(),
        { type: 'separator' },
        { label: this.copy('loginToggle', L.login), type: 'checkbox', checked: !!sess.loginLaunch, click: (item) => { if (this.o.onLogin) this.o.onLogin(!!(item && item.checked)) } },
        { type: 'separator' },
        { label: L.quit, click: () => this.o.onQuit() }
      ]
      this.tray.setContextMenu(Menu.buildFromTemplate(items))
      return
    }
    const label = st && st.running ? (st.code === 'MINING' ? L.mining + fmtHash(st.hashrate, this.lang) : st.mode === 'node' ? L.nodeOnlyShort : L.starting) : (st && st.phase === 'error' ? L.minerError : st && st.classicNote ? L.mining + st.classicNote : L.notMining)
    const items = [
      { label: L.show, click: () => this.showWindow() },
      this.presenceItem(),
      { label, enabled: false },
      { label: light ? L.modeLight : L.modeFull, enabled: false },
      { type: 'separator' },
      { label: this.copy('loginToggle', L.login), type: 'checkbox', checked: !!sess.loginLaunch, click: (item) => { if (this.o.onLogin) this.o.onLogin(!!(item && item.checked)) } },
      { label: L.light, type: 'checkbox', checked: light, click: (item) => { if (this.o.onLight) this.o.onLight(!!(item && item.checked)) } }
    ]
    if (minersRunning(st)) {
      items.push({ label: L.paceGpu, type: 'checkbox', checked: !!sess.gpuLow, click: (item) => { if (this.o.onPace) this.o.onPace({ gpuLow: !!(item && item.checked) }) } })
      items.push({ label: L.paceIdle, type: 'checkbox', checked: !!sess.idleOnly, click: (item) => { if (this.o.onPace) this.o.onPace({ idleOnly: !!(item && item.checked) }) } })
    }
    items.push(
      { type: 'separator' },
      { label: L.pauseHour, click: () => { if (this.o.onPauseFor) this.o.onPauseFor(60 * 60 * 1000) } },
      { label: L.pauseToday, click: () => { if (this.o.onPauseFor) this.o.onPauseFor('today') } },
      { label: L.pauseClear, click: () => { if (this.o.onPauseClear) this.o.onPauseClear() } },
      { label: L.quit, click: () => this.o.onQuit() }
    )
    this.tray.setContextMenu(Menu.buildFromTemplate(items))
  }

  update (st) {
    this.last = st
    if (!this.tray || this.tray.isDestroyed()) return
    const sess = this.session()
    const mode = this.o.getSession ? (sess.light ? 'light' : 'full') : undefined
    this.tray.setToolTip(tooltipText(this.o.version, st, this.lang, mode))
    const b = badgeState(st)
    if (st && st.guard && st.guard.colour && st.guard.colour !== this.guardColour) {
      this.guardColour = st.guard.colour
      const line = guardLine(st, this.lang)
      if (line) this.balloon('SCDO Wallet', line)
    }
    const iconFile = trayIconFile(process.platform, st)
    if (iconFile !== this.iconFile) this.applyTrayIcon(st)
    const w = this.o.getWindow()
    const overlay = b === 'yellow' ? 'green' : b === 'blue' ? 'blue' : b
    if (process.platform === 'win32' && w && !w.isDestroyed() && overlay !== this.lastBadge) {
      this.lastBadge = overlay
      const badge = overlay === 'blue' ? this.colourIcon('blue') : this.badges[overlay]
      const caption = overlay === 'green' ? 'Bookkeeping' : overlay === 'red' ? 'Bookkeeping node error' : overlay === 'blue' ? 'Paused' : 'Not bookkeeping'
      if (badge) w.setOverlayIcon(badge, caption)
    }
    const sessNow = this.session()
    const sig = [minersRunning(st), st && st.classicNote, st && st.running, st && st.code, st && st.phase, this.o.getKeepMining(), Math.round(((st && st.hashrate) || 0) / 1e5), sessNow.light ? 1 : 0, sessNow.loginLaunch ? 1 : 0, sessNow.gpuLow ? 1 : 0, sessNow.idleOnly ? 1 : 0, this.agentOnline() ? 1 : 0].join('|')
    if (sig !== this.sig) { this.sig = sig; this.rebuild() }
  }

  // re-apply the badge (e.g. after the window was re-created)
  reapply () { this.lastBadge = null; this.update(this.last) }
  destroy () { try { if (this.tray && !this.tray.isDestroyed()) this.tray.destroy() } catch (e) {} this.tray = null }
}

function menuLines (lang, st, sess, platform) {
  const L = TL[lang === 'EN' ? 'EN' : 'CN']
  const online = !!(sess && sess.agentOnline)
  const presence = online ? L.agentOnline : L.agentOffline
  if (platform === 'linux') {
    return { icon: trayIconFile('linux', st), lines: [L.show, presence, L.login, L.quit] }
  }
  const running = !!(st && st.running && st.code === 'MINING')
  const speed = running ? L.mining + fmtHash(st.hashrate, lang === 'EN' ? 'EN' : 'CN') : (st && st.phase === 'error' ? L.minerError : L.notMining)
  return {
    icon: trayIconFile('darwin', st),
    lines: [
      L.show,
      presence,
      speed,
      sess && sess.light ? L.modeLight : L.modeFull,
      L.login,
      L.light,
      L.pauseHour,
      L.pauseToday,
      L.pauseClear,
      L.quit
    ]
  }
}

module.exports = { TrayStatus, badgeState, tooltipText, fmtHash, trayIconFile, menuLines }
