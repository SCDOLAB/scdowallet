// 2026-09 upgrade: shard0 (EVM, chainId 5680) accounts + built-in GPU miner panel.
// Rendered into #shard0panel / #minerpanel by getBalance.js loadAccount().
(function () {
  const { ipcRenderer } = require('electron')
  const { Shard0 } = require('./src/api/evm.js')
  const fsx = require('fs')

  const DICT = {
    EN: {
      quick: 'Quick actions', create: '+ Create account', import: 'Import keyfile',
      s0title: 'SCDO Shard0 (EVM) · chain ID 5680 — same key, 0x address',
      s0note: 'Every keyfile also controls one 0x address on shard0 (usable in MetaMask with the same private key). The 0x address is shown after you unlock the keyfile once.',
      unlockShow: 'Unlock to show 0x address', unlock: 'Unlock', password: 'keyfile password',
      send: 'Send', explorer: 'Explorer', copy: 'Copy', faucet: 'Faucet (0.01 test SCDO)',
      net: 'shard0 block', netdown: 'shard0 RPC not reachable',
      sendTitle: 'Send on shard0', asset: 'Asset', to: 'To (0x...)', amount: 'Amount', cancel: 'Cancel',
      sending: 'Signing and broadcasting ...', sent: 'Transaction sent', confirmed: 'Confirmed in block', failed: 'Failed',
      mTitle: 'GPU mining (shard0, NVIDIA)',
      mNote: 'Runs a local SCDO node + stratum proxy + Rigel miner on this PC. Block rewards (2 SCDO per block) go to the address below. First start downloads Rigel (~56 MB, SHA256-checked) and syncs the chain (1–5 min).',
      reward: 'Reward address', manual: '— enter a 0x address —', start: 'Start mining', stop: 'Stop mining',
      phase: 'Status', blocks: 'Local / network block', peers: 'Peers', hashrate: 'Hashrate', shares: 'Shares accepted / rejected',
      found: 'Blocks found', balance: 'Reward address balance', restarts: 'Miner restarts', defender: 'Allow miner in Windows Defender',
      logs: 'Open log folder', showlog: 'Show log', macNo: 'The built-in GPU miner is available in the Windows (NVIDIA) and Linux builds only; Rigel has no macOS version.', needAddr: 'Choose or enter a 0x reward address first (unlock a keyfile once to get its 0x address).',
      yes: 'Yes', no: 'No', defAsk: 'Windows Defender deletes every GPU miner (rigel.exe) as a "potentially unwanted app". Add an exclusion for the wallet\'s miner folder now? Windows will ask for administrator permission once.', defRetry: 'rigel.exe was removed by Windows Defender. Add an exclusion for the miner folder (administrator prompt) and start again?'
    },
    CN: {
      quick: '快捷操作', create: '+ 建立帳戶', import: '匯入帳戶檔案',
      s0title: 'SCDO Shard0 (EVM) · 鏈 ID 5680 — 同一把鑰匙的 0x 地址',
      s0note: '每個帳戶檔案同時控制 shard0 上的一個 0x 地址（同一私鑰也可匯入 MetaMask）。首次輸入密碼解鎖後顯示 0x 地址。',
      unlockShow: '解鎖以顯示 0x 地址', unlock: '解鎖', password: '帳戶檔案密碼',
      send: '轉帳', explorer: '瀏覽器', copy: '複製', faucet: '水龍頭（0.01 測試 SCDO）',
      net: 'shard0 區塊', netdown: '無法連線 shard0 節點',
      sendTitle: 'shard0 轉帳', asset: '幣種', to: '收款地址 (0x...)', amount: '數量', cancel: '取消',
      sending: '正在簽名並廣播 ...', sent: '交易已傳送', confirmed: '已確認，區塊', failed: '失敗',
      mTitle: 'GPU 挖礦（shard0，NVIDIA 顯示卡）',
      mNote: '在本機執行 SCDO 節點 + stratum 代理 + Rigel 挖礦程式。出塊獎勵（每塊 2 SCDO）進入下面的地址。首次啟動會下載 Rigel（約 56 MB，校驗 SHA256）並同步區塊（1–5 分鐘）。',
      reward: '出塊獎勵地址', manual: '— 手動輸入 0x 地址 —', start: '開始挖礦', stop: '停止挖礦',
      phase: '狀態', blocks: '本地 / 全網區塊', peers: '連線節點', hashrate: '算力', shares: '份額 接受 / 拒絕',
      found: '挖到的區塊', balance: '出塊獎勵地址餘額', restarts: '挖礦程式重啟次數', defender: '在 Windows Defender 中允許挖礦程式',
      logs: '開啟日誌資料夾', showlog: '顯示日誌', macNo: '內建 GPU 挖礦僅在 Windows（NVIDIA）和 Linux 版提供；Rigel 沒有 macOS 版本。', needAddr: '請先選擇或輸入 0x 出塊獎勵地址（帳戶檔案解鎖一次即可得到 0x 地址）。',
      yes: '是', no: '否', defAsk: 'Windows Defender 會把所有 GPU 挖礦程式（rigel.exe）當作“可能不需要的應用”刪除。現在為錢包的挖礦資料夾新增排除項嗎？Windows 會請求一次管理員權限。', defRetry: 'rigel.exe 被 Windows Defender 刪除了。為挖礦資料夾新增排除項（需要管理員權限）並重新開始嗎？'
    }
  }
  function lang () {
    try { return JSON.parse(fsx.readFileSync(client.configpath)).lang === 'EN' ? 'EN' : 'CN' } catch (e) { return 'CN' }
  }
  function T (k) { return (DICT[lang()] || DICT.EN)[k] || DICT.EN[k] || k }
  function esc (s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])) }
  function fmt (x, d) { const n = Number(x); if (!isFinite(n)) return String(x); return n.toLocaleString(undefined, { maximumFractionDigits: d == null ? 6 : d }) }
  function fmtHash (h) { if (h == null) return '–'; const u = ['H/s', 'kH/s', 'MH/s', 'GH/s']; let i = 0; while (h >= 1000 && i < 3) { h /= 1000; i++ } return h.toFixed(2) + ' ' + u[i] }

  let s0 = null
  function shard0 () {
    if (!s0) { const cfg = client.config || {}; s0 = new Shard0(Object.assign({}, cfg.shard0 || {}, { rpc: (cfg.connect && cfg.connect[0]) || 'https://scdoscan.io/rpc/0' })) }
    return s0
  }

  // ---------------- shard0 accounts ----------------
  function renderShard0 () {
    const el = document.getElementById('shard0panel'); if (!el) return
    const accs = client.accountArray || []
    const tb = document.getElementById('s0toolbar')
    let h = ''
    if (tb) tb.innerHTML = `<div class="s0-toolbar"><span class="s0-quick">${T('quick')}:</span>
      <button class="s0-btn" onclick="addKeyfilePopup()">${T('create')}</button>
      <button class="s0-btn" onclick="importAccounts()">${T('import')}</button></div>`
    h += `<h1 class="s0-h1">${T('s0title')}</h1><div class="s0-note">${T('s0note')} <span id="s0net" class="s0-net"></span></div><div class="s0-list">`
    accs.forEach((a, i) => {
      const evm = client.evmAddressOf(a.filename)
      h += `<div class="s0-card" data-file="${esc(a.filename)}"><div class="s0-card-top">
        <img class="s0-logo" src="./src/img/cryptologo-scdo.png"><div class="s0-src">${esc(a.pubkey)} <span class="s0-shard">(${esc(a.filename)})</span></div></div>`
      if (evm) {
        h += `<div class="s0-addr">${esc(evm)}</div>
          <div class="s0-bal" id="s0bal-${i}"><span>… SCDO</span></div>
          <div class="s0-actions">
            <button class="s0-btn" onclick="Shard0UI.openSend(${i})">${T('send')}</button>
            <button class="s0-btn s0-light" onclick="Shard0UI.copy('${esc(evm)}')">${T('copy')}</button>
            <button class="s0-btn s0-light" onclick="Shard0UI.explorer('${esc(evm)}')">${T('explorer')}</button>
            <button class="s0-btn s0-light" onclick="Shard0UI.faucet(${i})">${T('faucet')}</button></div>`
      } else {
        h += `<div class="s0-unlock">${T('unlockShow')}: <input type="password" id="s0pw-${i}" placeholder="${T('password')}">
          <button class="s0-btn" onclick="Shard0UI.unlock(${i})">${T('unlock')}</button></div>`
      }
      h += '</div>'
    })
    h += '</div>'
    el.innerHTML = h
    refreshShard0()
  }

  let refreshing = false
  async function refreshShard0 () {
    if (refreshing) return; refreshing = true
    try {
      const net = document.getElementById('s0net')
      try { const ci = await shard0().chainInfo(); if (net) net.textContent = T('net') + ' #' + ci.block + ' (chainId ' + ci.chainId + ')' } catch (e) { if (net) net.textContent = T('netdown') }
      const accs = client.accountArray || []
      await Promise.all(accs.map(async (a, i) => {
        const evm = client.evmAddressOf(a.filename); const box = document.getElementById('s0bal-' + i)
        if (!evm || !box) return
        try {
          const b = await shard0().balances(evm)
          box.innerHTML = `<span class="s0-main">${fmt(b.native)} SCDO</span>` + b.tokens.map(t => `<span class="s0-tok">${esc(fmt(t.balance, t.decimals))} ${esc(t.symbol)}</span>`).join('')
        } catch (e) { box.textContent = '? (' + (e.shortMessage || e.message) + ')' }
      }))
    } finally { refreshing = false }
  }

  async function unlock (i) {
    const a = client.accountArray[i]; const pw = document.getElementById('s0pw-' + i)
    const l = layer.load(0, { shade: false })
    try { await client.decKeyFile(a.filename.replace(/\[sPaCe\]/g, ' '), pw.value); pw.value = ''; layer.close(l); renderShard0(); renderMiner() } catch (e) { layer.close(l); layer.msg(String(e.message || e)) }
  }

  function copy (t) { navigator.clipboard.writeText(t).then(() => layer.msg(MSGJSON && MSGJSON[lang()] ? MSGJSON[lang()].copySucess : 'copied')) }
  function explorer (a) { ipcRenderer.invoke('shell:openExternal', shard0().explorerAddress(a)) }

  async function faucet (i) {
    const evm = client.evmAddressOf(client.accountArray[i].filename)
    try {
      const r = await fetch(shard0().cfg.faucet + '?addr=' + evm); const j = await r.json()
      layer.msg(j.status === 'ok' ? 'Faucet: ' + (j.txHash || 'ok') : 'Faucet: ' + (j.error || r.status) + (j.retryAfterSec ? ' (retry in ' + Math.ceil(j.retryAfterSec / 60) + ' min)' : ''), { time: 6000 })
    } catch (e) { layer.msg('Faucet error: ' + e.message) }
  }

  function openSend (i) {
    const a = client.accountArray[i]; const evm = client.evmAddressOf(a.filename)
    const toks = shard0().cfg.tokens.map(t => `<option value="${esc(t.symbol)}">${esc(t.symbol)}</option>`).join('')
    const html = `<div class="s0-send"><div><b>From</b> ${esc(evm)}</div>
      <label>${T('asset')}</label><select id="s0s-asset"><option value="SCDO">SCDO</option>${toks}</select>
      <label>${T('to')}</label><input id="s0s-to" type="text" placeholder="0x...">
      <label>${T('amount')}</label><input id="s0s-amt" type="text" placeholder="0.0">
      <label>${T('password')}</label><input id="s0s-pw" type="password">
      <div id="s0s-res" class="s0-res"></div></div>`
    layer.open({
      type: 1, title: T('sendTitle'), area: ['560px', '460px'], content: html, btn: [T('send'), T('cancel')],
      yes: async function () {
        const res = document.getElementById('s0s-res')
        const to = document.getElementById('s0s-to').value.trim(); const amt = document.getElementById('s0s-amt').value.trim()
        const asset = document.getElementById('s0s-asset').value; const pwEl = document.getElementById('s0s-pw')
        if (!Shard0.isAddress(to)) { res.textContent = 'Invalid 0x address'; return }
        if (!/^\d+(\.\d+)?$/.test(amt) || Number(amt) <= 0) { res.textContent = 'Invalid amount'; return }
        res.textContent = T('sending')
        try {
          const priv = await client.decKeyFile(a.filename.replace(/\[sPaCe\]/g, ' '), pwEl.value); pwEl.value = ''
          const r = await shard0().send(priv, to, amt, asset)
          res.innerHTML = T('sent') + ': <a href="#" onclick="Shard0UI.openTx(\'' + r.hash + '\');return false">' + r.hash + '</a>'
          const rc = await shard0().waitReceipt(r.hash, 240000)
          res.innerHTML += '<br>' + (rc && rc.status === 1 ? T('confirmed') + ' #' + rc.blockNumber : T('failed') + ' (status ' + (rc && rc.status) + ')')
          refreshShard0()
        } catch (e) { res.textContent = String(e.shortMessage || e.message || e) }
      }
    })
  }
  function openTx (h) { ipcRenderer.invoke('shell:openExternal', shard0().explorerTx(h)) }

  // ---------------- miner ----------------
  let minerStatus = null; let logOpen = false
  function rewardOptions () {
    const opts = []; const seen = {}
    ;(client.accountArray || []).forEach(a => { const e = client.evmAddressOf(a.filename); if (e && !seen[e]) { seen[e] = 1; opts.push({ v: e, l: e + '  (' + a.filename + ')' }) } })
    return opts
  }
  function renderMiner () {
    const el = document.getElementById('minerpanel'); if (!el) return
    if (process.platform === 'darwin') { el.innerHTML = `<h1 class="s0-h1">${T('mTitle')}</h1><div class="s0-note">${T('macNo')}</div>`; return }
    const opts = rewardOptions(); const st = minerStatus || {}
    const saved = localStorage.getItem('minerReward') || ''
    let sel = opts.map(o => `<option value="${esc(o.v)}" ${o.v === (st.wallet || saved) ? 'selected' : ''}>${esc(o.l)}</option>`).join('')
    sel += `<option value="" ${opts.length && !opts.some(o => o.v === (st.wallet || saved)) ? '' : ''}>${T('manual')}</option>`
    el.innerHTML = `<h1 class="s0-h1">${T('mTitle')}</h1><div class="s0-note">${T('mNote')}</div>
      <div class="m-row"><label>${T('reward')}</label><select id="m-reward" onchange="Shard0UI.rewardChanged()">${sel}</select>
      <input id="m-manual" type="text" placeholder="0x..." style="display:none"></div>
      <div class="m-row"><button id="m-start" class="s0-btn m-big" onclick="Shard0UI.startMining()">${T('start')}</button>
      <button id="m-stop" class="s0-btn s0-light m-big" onclick="Shard0UI.stopMining()">${T('stop')}</button>
      <button id="m-def" class="s0-btn s0-light" onclick="Shard0UI.defender()" style="display:none">${T('defender')}</button>
      <button class="s0-btn s0-light" onclick="Shard0UI.openLogs()">${T('logs')}</button>
      <button class="s0-btn s0-light" onclick="Shard0UI.toggleLog()">${T('showlog')}</button></div>
      <div class="m-grid">
        <div>${T('phase')}</div><div id="m-phase">–</div>
        <div>${T('blocks')}</div><div id="m-blocks">–</div>
        <div>${T('peers')}</div><div id="m-peers">–</div>
        <div>${T('hashrate')}</div><div id="m-hr">–</div>
        <div>${T('shares')}</div><div id="m-shares">–</div>
        <div>${T('found')}</div><div id="m-found">–</div>
        <div>${T('balance')}</div><div id="m-bal">–</div>
        <div>${T('restarts')}</div><div id="m-rs">–</div>
      </div><pre id="m-log" class="m-log" style="display:none"></pre>`
    rewardChanged(); updateMiner(minerStatus)
  }
  function rewardChanged () {
    const s = document.getElementById('m-reward'); const m = document.getElementById('m-manual'); if (!s) return
    m.style.display = s.value ? 'none' : 'inline-block'
  }
  function currentReward () {
    const s = document.getElementById('m-reward'); const m = document.getElementById('m-manual')
    return (s && s.value) || (m && m.value.trim()) || ''
  }
  function updateMiner (st) {
    minerStatus = st || minerStatus; st = minerStatus; if (!st || !document.getElementById('m-phase')) return
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v }
    set('m-phase', (st.phase || '–') + (st.message ? ' — ' + st.message : '') + (st.download && st.download.total ? ' (' + Math.round(100 * st.download.got / st.download.total) + '%)' : ''))
    set('m-blocks', (st.localBlock == null ? '–' : st.localBlock) + ' / ' + (st.networkBlock == null ? '–' : st.networkBlock))
    set('m-peers', st.peers == null ? '–' : st.peers)
    set('m-hr', fmtHash(st.hashrate) + (st.hashrateSource ? ' (' + st.hashrateSource + ')' : ''))
    const rs = st.rigelShares ? '  · Rigel: ' + st.rigelShares.accepted + ' / ' + st.rigelShares.rejected : ''
    set('m-shares', (st.sharesAccepted || 0) + ' / ' + (st.sharesRejected || 0) + rs)
    set('m-found', (st.blocksFound || 0) + (st.blocksFoundHeights && st.blocksFoundHeights.length ? '  (#' + st.blocksFoundHeights.slice(-5).join(', #') + ')' : ''))
    set('m-bal', st.balanceWei == null ? '–' : fmt(Number(BigInt(st.balanceWei) / 10n ** 12n) / 1e6) + ' SCDO')
    set('m-rs', st.rigelRestarts || 0)
    const running = !!st.running
    const b1 = document.getElementById('m-start'); const b2 = document.getElementById('m-stop')
    if (b1) b1.disabled = running; if (b2) b2.disabled = !running
    const d = document.getElementById('m-def'); if (d) d.style.display = (process.platform === 'win32') ? 'inline-block' : 'none'
    const lg = document.getElementById('m-log'); if (lg && logOpen) { lg.textContent = (st.logTail || []).slice(-80).join('\n'); lg.scrollTop = lg.scrollHeight }
  }
  function confirmP (msg) { return new Promise(resolve => { const i = layer.confirm(msg, { btn: [T('yes'), T('no')] }, () => { layer.close(i); resolve(true) }, () => { resolve(false) }) }) }
  async function startMining (auto) {
    const w = currentReward()
    if (!Shard0.isAddress(w)) { if (!auto) layer.msg(T('needAddr'), { time: 5000 }); return }
    localStorage.setItem('minerReward', w)
    // Windows: Defender deletes every GPU miner as "potentially unwanted" – offer the exclusion once, before the first download.
    if (process.platform === 'win32' && !auto && !window.__minerNoRigel && !localStorage.getItem('defenderAsked')) {
      localStorage.setItem('defenderAsked', '1')
      if (await confirmP(T('defAsk'))) await defender()
    }
    localStorage.setItem('minerAutoResume', '1')
    const r = await ipcRenderer.invoke('miner:start', w, { noRigel: !!window.__minerNoRigel })
    if (!r.ok && !/DEFENDER/.test(r.error || '')) layer.alert(r.error)
  }
  async function stopMining () { localStorage.setItem('minerAutoResume', '0'); await ipcRenderer.invoke('miner:stop') }
  let defPrompted = false
  function onStatus (st) {
    updateMiner(st)
    if (st && st.lastError === 'DEFENDER' && st.phase === 'error' && !defPrompted && process.platform === 'win32') {
      defPrompted = true
      confirmP(T('defRetry')).then(async ok => {
        if (ok) { if (st.running) await ipcRenderer.invoke('miner:stop'); const r = await defender(); if (r && r.ok) await startMining(true) }
        defPrompted = false
      })
    }
  }
  async function defender () { const r = await ipcRenderer.invoke('miner:defender'); layer.msg(r.ok ? 'OK' : r.error, { time: 6000 }); return r }
  function openLogs () { ipcRenderer.invoke('miner:openLogs') }
  function toggleLog () { logOpen = !logOpen; const lg = document.getElementById('m-log'); if (lg) lg.style.display = logOpen ? 'block' : 'none'; updateMiner() }

  ipcRenderer.on('miner:status', (e, st) => onStatus(st))
  ipcRenderer.invoke('miner:status').then(st => {
    updateMiner(st)
    // resume mining automatically if it was running when the app was closed (user did not press Stop)
    if (st && !st.running && localStorage.getItem('minerAutoResume') === '1' && process.platform !== 'darwin' && !window.__minerNoRigel) setTimeout(() => startMining(true), 4000)
  }).catch(() => {})
  setInterval(() => { if (document.getElementById('shard0panel')) refreshShard0() }, 15000)

  window.Shard0UI = { render: () => { renderShard0(); renderMiner() }, unlock, copy, explorer, faucet, openSend, openTx, startMining, stopMining, defender, openLogs, toggleLog, rewardChanged, refresh: refreshShard0 }
})()
