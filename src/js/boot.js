// SCDO Wallet 2.0.6: loading screen. Runs before everything else, uses only textContent, and shows the mining
// status (running / stopped, hashrate, pool) from the main process as soon as it is known - long before the wallet
// page itself has loaded its accounts. app112.js calls window.__scdoBootDone() after its first render.
'use strict'
;(function () {
  const api = window.scdo
  // Mac native look: src/css/mac-native.css applies only under this class.
  try { if (api && api.platform === 'darwin') document.documentElement.classList.add('mac-native') } catch (e) {}
  const $ = (id) => document.getElementById(id)
  const TX = {
    CN: { loading: '正在載入錢包…', mining: '記帳中', starting: '記帳節點啟動中…', stopped: '目前沒有在記帳', node: '只執行節點（未記帳）', error: '記帳節點出錯', pool: '記帳池', local: '本機節點（單獨記帳）', slow: '載入時間比平常久。記帳不受影響。', reload: '重新載入畫面', speed: '記帳速度 (H/s) 每秒 {n} 次' },
    EN: { loading: 'Loading wallet…', mining: 'Bookkeeping', starting: 'Bookkeeping node starting…', stopped: 'Not bookkeeping right now', node: 'Node only (not bookkeeping)', error: 'Bookkeeping node error', pool: 'pool', local: 'local node (solo)', slow: 'Loading is taking longer than usual. Bookkeeping is not affected.', reload: 'Reload the window', speed: 'Bookkeeping speed (H/s) {n} tries per second' }
  }
  let L = TX.CN, lang = 'CN', done = false, last = null, off = null
  function fmtHash (h) { const n = Math.round(Number(h) || 0).toLocaleString('en-US'); return String(L.speed || '').replace('{n}', n) }
  function mineText (m) {
    if (!m) return ''
    if (m.phase === 'error') return '⛏ ' + L.error
    if (!m.running) return '⛏ ' + L.stopped
    if (m.mode === 'node') return L.node
    const pool = m.mode === 'pool' && m.poolUrl ? String(m.poolUrl).replace(/^[a-z0-9+]+:\/\//i, '') : L.local
    return '⛏ ' + (m.code === 'MINING' ? L.mining : L.starting) + (m.code === 'MINING' && m.hashrate > 0 ? ' · ' + fmtHash(m.hashrate) : '') + ' · ' + L.pool + ' ' + pool
  }
  function paintMine (m) { last = m || last; const e = $('bootMine'); if (e && lang) e.textContent = mineText(last) }
  window.__scdoBootDone = function () {
    if (done) return; done = true
    try { if (off) off() } catch (e) {}
    const s = $('bootSplash'); if (s && s.parentNode) s.parentNode.removeChild(s)
  }
  if (!api) return
  try { off = api.on('miner:status', paintMine) } catch (e) {}
  api.invoke('app:info').then(info => {
    if (!info) return
    lang = info.lang === 'EN' ? 'EN' : 'CN'; L = TX[lang]
    const t = $('bootTitle'); if (t) t.textContent = 'SCDO Wallet ' + (info.version || '')
    const m = $('bootMsg'); if (m) m.textContent = L.loading
    paintMine(last)
  }).catch(() => {})
  api.invoke('miner:status').then(paintMine).catch(() => {})
  // if the page has not drawn itself after 15 s, say so and offer a reload (the miner runs in the main process)
  setTimeout(() => {
    if (done) return
    const s = $('bootSlow'); if (!s) return
    s.textContent = L.slow + ' '
    const b = document.createElement('button'); b.type = 'button'; b.className = 'bsbtn'; b.textContent = L.reload
    b.addEventListener('click', () => location.reload())
    s.appendChild(b)
  }, 15000)
})()
