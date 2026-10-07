// SCDO Wallet 2.0.6: loading screen. Runs before everything else, uses only textContent, and shows the mining
// status (running / stopped, hashrate, pool) from the main process as soon as it is known - long before the wallet
// page itself has loaded its accounts. app112.js calls window.__scdoBootDone() after its first render.
'use strict'
;(function () {
  const api = window.scdo
  const $ = (id) => document.getElementById(id)
  const TX = {
    CN: { loading: '正在載入錢包…', mining: '挖礦中', starting: '挖礦程式啟動中…', stopped: '目前沒有在挖礦', node: '只執行節點（未挖礦）', error: '挖礦程式出錯', pool: '礦池', local: '本機節點（單獨挖礦）', slow: '載入時間比平常久。挖礦不受影響。', reload: '重新載入畫面' },
    EN: { loading: 'Loading wallet…', mining: 'Mining', starting: 'Miner starting…', stopped: 'Not mining right now', node: 'Node only (not mining)', error: 'Miner error', pool: 'pool', local: 'local node (solo)', slow: 'Loading is taking longer than usual. Mining is not affected.', reload: 'Reload the window' }
  }
  let L = TX.EN, lang = null, done = false, last = null, off = null
  function fmtHash (h) { const u = ['H/s', 'kH/s', 'MH/s', 'GH/s']; let i = 0; h = Number(h) || 0; while (h >= 1000 && i < 3) { h /= 1000; i++ } return h.toFixed(2) + ' ' + u[i] }
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
    lang = info.lang === 'CN' ? 'CN' : 'EN'; L = TX[lang]
    const t = $('bootTitle'); if (t) t.textContent = 'SCDO Wallet ' + (info.displayVersion || info.version || '')
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
