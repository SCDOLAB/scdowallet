// SCDO Wallet 2.0.1 (P0 #3): tray icon with "Stop mining" / "Keep mining" / "Quit", hashrate in the tray tooltip,
// and a Windows taskbar overlay badge (green = mining, grey = stopped, red = error).
'use strict'
const path = require('path')
const { Tray, Menu, nativeImage } = require('electron')

function fmtHash (h, lang) {
  const raw = Number(h)
  const n = Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 0
  const num = n.toLocaleString('en-US')
  if (lang === 'CN') return '挖礦速度 每秒 ' + num + ' 次'
  return 'Mining speed ' + num + ' tries per second'
}

// state of the badge for a miner status object
function badgeState (st) {
  if (!st) return 'grey'
  if (st.phase === 'error') return 'red'
  if (st.running && (st.mode === 'mine' || st.mode === 'pool')) return 'green'
  if (st.classicNote) return 'green'
  return 'grey'
}
// 2.0.6: tray texts follow the wallet language ('CN' = 繁體中文)
const TL = {
  EN: { show: 'Show SCDO Wallet', notMining: 'Not mining', minerError: 'Miner error', nodeOnly: 'Node only (not mining)', nodeOnlyShort: 'Node only', mining: 'Mining: ', starting: 'Miner starting…', stop: 'Stop mining', keep: 'Keep mining (restart the miner if it exits)', quit: 'Quit' },
  CN: { show: '顯示 SCDO Wallet', notMining: '未在挖礦', minerError: '挖礦程式出錯', nodeOnly: '只執行節點（未挖礦）', nodeOnlyShort: '只執行節點', mining: '挖礦中：', starting: '挖礦程式啟動中…', stop: '停止挖礦', keep: '持續挖礦（挖礦程式退出時自動重新啟動）', quit: '結束' }
}
function tooltipText (version, st, lang) {
  const L = TL[lang] || TL.EN
  const head = 'SCDO Wallet ' + version
  let line
  if (!st || (!st.running && st.phase !== 'error')) line = head + '\n' + L.notMining
  else if (st.phase === 'error') line = head + '\n' + L.minerError + ': ' + String(st.code || st.message || 'error')
  else if (st.mode === 'node') line = head + '\n' + L.nodeOnly
  else if (st.code === 'MINING') line = head + '\n' + L.mining + fmtHash(st.hashrate, lang)
  else line = head + '\n' + L.starting + ' ' + (st.hashrate > 0 ? fmtHash(st.hashrate, lang) : '')
  if (st && st.classicNote) line += '\n' + st.classicNote
  return line.slice(0, 127)
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
    this.lang = o.lang === 'CN' ? 'CN' : 'EN'
    this.tray.setToolTip(tooltipText(o.version, null, this.lang))
    this.tray.on('click', () => this.showWindow())
    this.rebuild()
  }

  L () { return TL[this.lang] || TL.EN }
  setLang (l) { const n = l === 'CN' ? 'CN' : 'EN'; if (n === this.lang) return; this.lang = n; this.sig = null; this.update(this.last); this.rebuild() }
  // 2.0.6: one-time Windows notification when the window is hidden to the tray
  balloon (title, content) { try { if (this.tray && !this.tray.isDestroyed() && process.platform === 'win32') this.tray.displayBalloon({ title, content, iconType: 'info', noSound: true }) } catch (e) {} }

  showWindow () { const w = this.o.getWindow(); if (w && !w.isDestroyed()) { if (w.isMinimized()) w.restore(); w.show(); w.focus() } }

  rebuild () {
    if (!this.tray || this.tray.isDestroyed()) return
    const st = this.last
    const active = this.o.isMinerActive()
    const L = this.L()
    const label = st && st.running ? (st.code === 'MINING' ? L.mining + fmtHash(st.hashrate, this.lang) : st.mode === 'node' ? L.nodeOnlyShort : L.starting) : (st && st.phase === 'error' ? L.minerError : L.notMining)
    this.tray.setContextMenu(Menu.buildFromTemplate([
      { label: L.show, click: () => this.showWindow() },
      { label, enabled: false },
      { type: 'separator' },
      { label: L.stop, id: 'stop', enabled: active, click: () => this.o.onStop() },
      { label: L.keep, type: 'checkbox', checked: !!this.o.getKeepMining(), click: (mi) => this.o.onKeepMining(!!mi.checked) },
      { type: 'separator' },
      { label: L.quit, click: () => this.o.onQuit() }
    ]))
  }

  update (st) {
    this.last = st
    if (!this.tray || this.tray.isDestroyed()) return
    this.tray.setToolTip(tooltipText(this.o.version, st, this.lang))
    const b = badgeState(st)
    const w = this.o.getWindow()
    if (process.platform === 'win32' && w && !w.isDestroyed() && b !== this.lastBadge) {
      this.lastBadge = b
      w.setOverlayIcon(this.badges[b], b === 'green' ? 'Mining' : b === 'red' ? 'Miner error' : 'Not mining')
    }
    const sig = [st && st.running, st && st.code, st && st.phase, this.o.getKeepMining(), Math.round(((st && st.hashrate) || 0) / 1e5)].join('|')
    if (sig !== this.sig) { this.sig = sig; this.rebuild() }
  }

  // re-apply the badge (e.g. after the window was re-created)
  reapply () { this.lastBadge = null; this.update(this.last) }
  destroy () { try { if (this.tray && !this.tray.isDestroyed()) this.tray.destroy() } catch (e) {} this.tray = null }
}

module.exports = { TrayStatus, badgeState, tooltipText, fmtHash }
