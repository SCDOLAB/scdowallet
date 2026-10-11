// Tray: show the window, a status line, and quit. Start and stop mining are the Home card.
// Keep mining stays on the mining settings page. Hashrate is in the tray tooltip.
// and a Windows taskbar overlay badge (green = mining, grey = stopped, red = error).
'use strict'
const path = require('path')
const { Tray, Menu, nativeImage, BrowserWindow, screen } = require('electron')
const { tooltipError, minersRunning } = require('../js/minerStartError')

function fmtHash (h, lang) {
  const raw = Number(h)
  const n = Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 0
  const num = n.toLocaleString('en-US')
  if (lang === 'CN') return '挖礦速度 每秒 ' + num + ' 次'
  return 'Mining speed ' + num + ' tries per second'
}

// state of the badge for a miner status object
function badgeState (st) {
  if (st && st.guard && (st.guard.colour === 'green' || st.guard.colour === 'yellow' || st.guard.colour === 'red' || st.guard.colour === 'grey')) return st.guard.colour
  if (!st) return 'grey'
  if (st.phase === 'error') return 'red'
  if (st.running && (st.mode === 'mine' || st.mode === 'pool')) return 'green'
  if (st.classicNote) return 'green'
  return 'grey'
}
// 2.0.6: tray texts follow the wallet language ('CN' = 華語繁體)
const TL = {
  EN: { show: 'Show SCDO Wallet', notMining: 'Not mining', minerError: 'Miner error', nodeOnly: 'Node only (not mining)', nodeOnlyShort: 'Node only', mining: 'Mining: ', starting: 'Miner starting…', stop: 'Stop mining', keep: 'Keep mining (restart the miner if it exits)', quit: 'Quit' },
  CN: { show: '顯示 SCDO Wallet', notMining: '未在挖礦', minerError: '挖礦程式出錯', nodeOnly: '只執行節點（未挖礦）', nodeOnlyShort: '只執行節點', mining: '挖礦中：', starting: '挖礦程式啟動中…', stop: '停止挖礦', keep: '持續挖礦（挖礦程式退出時自動重新啟動）', quit: '結束' }
}
function tooltipText (version, st, lang) {
  const L = TL[lang] || TL.CN
  const head = 'SCDO Wallet ' + version
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

const REASON_EN = { '電池': 'battery', '全螢幕': 'full screen', '記憶體': 'memory', '溫度': 'temperature', '重新啟動': 'too many restarts' }
const ACTION_EN = {
  '因電池暫停': 'Paused because of the battery',
  '因全螢幕暫停': 'Paused because a program is full screen',
  '因溫度暫停': 'Paused because the graphics card is hot',
  '因記憶體暫停': 'Paused because memory is low',
  '重新啟動太多次，已暫停': 'Paused after too many restarts',
  '執行緒減半': 'Thread count cut in half',
  '恢復執行緒': 'Thread count restored',
  '重新啟動挖礦程式': 'Miner program restarted',
  '溫度過高，已降低強度': 'Graphics card is hot, so intensity is lower'
}

function panelHtml (guard, lang) {
  const g = guard || {}
  const cn = lang !== 'EN'
  const chains = Array.isArray(g.chains) ? g.chains : []
  const rows = chains.length ? chains.map(c => {
    const when = c.lastShareAt ? new Date(c.lastShareAt).toLocaleString() : (cn ? '—' : '-')
    const speed = c.hashrate > 0 ? fmtHash(c.hashrate, cn ? 'CN' : 'EN') : (cn ? '—' : '-')
    const name = (c.shard === 0 || c.shard) ? ('Shard' + c.shard) : (cn ? '挖礦' : 'Mining')
    return '<tr><td>' + escHtml(name) + '</td><td>' + escHtml(c.status || '') + '</td><td>' + escHtml(speed) + '</td><td>' + escHtml(when) + '</td></tr>'
  }).join('') : '<tr><td colspan="4">' + (cn ? '未在挖礦' : 'Not mining') + '</td></tr>'
  const title = cn ? '挖礦狀態' : 'Mining status'
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
    this.tray = new Tray(process.platform === 'win32' ? path.join(o.assetsDir, 'tray.ico') : this.img('icon-32.png'))
    this.lang = o.lang === 'EN' ? 'EN' : 'CN'
    this.tray.setToolTip(tooltipText(o.version, null, this.lang))
    this.tray.on('click', () => this.openPanel())
    this.guardColour = null
    this.icons = null
    this.rebuild()
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
      this.icons = { green: solid(29, 122, 52), yellow: solid(214, 164, 0), red: solid(180, 40, 40), grey: solid(142, 142, 147) }
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
  setLang (l) { const n = l === 'EN' ? 'EN' : 'CN'; if (n === this.lang) return; this.lang = n; this.sig = null; this.update(this.last); this.rebuild() }
  // 2.0.6: one-time Windows notification when the window is hidden to the tray
  balloon (title, content) { try { if (this.tray && !this.tray.isDestroyed() && process.platform === 'win32') this.tray.displayBalloon({ title, content, iconType: 'info', noSound: true }) } catch (e) {} }

  showWindow () { const w = this.o.getWindow(); if (w && !w.isDestroyed()) { if (w.isMinimized()) w.restore(); w.show(); w.focus() } }

  rebuild () {
    if (!this.tray || this.tray.isDestroyed()) return
    const st = this.last
    const L = this.L()
    const label = st && st.running ? (st.code === 'MINING' ? L.mining + fmtHash(st.hashrate, this.lang) : st.mode === 'node' ? L.nodeOnlyShort : L.starting) : (st && st.phase === 'error' ? L.minerError : st && st.classicNote ? L.mining + st.classicNote : L.notMining)
    this.tray.setContextMenu(Menu.buildFromTemplate([
      { label: L.show, click: () => this.showWindow() },
      { label, enabled: false },
      { type: 'separator' },
      { label: L.quit, click: () => this.o.onQuit() }
    ]))
  }

  update (st) {
    this.last = st
    if (!this.tray || this.tray.isDestroyed()) return
    this.tray.setToolTip(tooltipText(this.o.version, st, this.lang))
    const b = badgeState(st)
    if (st && st.guard && st.guard.colour && st.guard.colour !== this.guardColour) {
      this.guardColour = st.guard.colour
      const icon = this.colourIcon(st.guard.colour)
      if (icon) this.tray.setImage(icon)
    }
    const w = this.o.getWindow()
    const overlay = b === 'yellow' ? 'green' : b
    if (process.platform === 'win32' && w && !w.isDestroyed() && overlay !== this.lastBadge) {
      this.lastBadge = overlay
      w.setOverlayIcon(this.badges[overlay], overlay === 'green' ? 'Mining' : overlay === 'red' ? 'Miner error' : 'Not mining')
    }
    const sig = [minersRunning(st), st && st.classicNote, st && st.running, st && st.code, st && st.phase, this.o.getKeepMining(), Math.round(((st && st.hashrate) || 0) / 1e5)].join('|')
    if (sig !== this.sig) { this.sig = sig; this.rebuild() }
  }

  // re-apply the badge (e.g. after the window was re-created)
  reapply () { this.lastBadge = null; this.update(this.last) }
  destroy () { try { if (this.tray && !this.tray.isDestroyed()) this.tray.destroy() } catch (e) {} this.tray = null }
}

module.exports = { TrayStatus, badgeState, tooltipText, fmtHash }
