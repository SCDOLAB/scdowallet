// ScdoWalletBeta 1.1.4 renderer (1.1.4: network menu can switch to SCDO Shard1 (Classic), SCDO Shard2 (Classic), SCDO Shard3 (Classic) or SCDO Shard4 (Classic) and the choice is kept; names SCDO Shard0 (EVM) / Classic accounts.
// 1.1.3: MetaMask-style asset dropdown on the Send page): new UI modelled on mainstream wallets (MetaMask / Trust / OKX / Rabby / Exodus):
// account switcher at the top, big balance, Receive / Send action row, assets + activity, network selector,
// settings gear. Uses the existing APIs: src/api/scdoClient.js (keyfiles, Classic shards), src/api/evm.js (SCDO Shard0 (EVM)),
// main-process IPC for the miner and for keyfile backup + delete.
'use strict'
;(function () {
  const { ipcRenderer } = require('electron')
  const fs = require('fs')
  const os = require('os')
  const path = require('path')
  const ScdoClient = require('./src/api/scdoClient.js')
  const { Shard0 } = require('./src/api/evm.js')
  const { ethers } = require('ethers')
  const { miningGpuReady, readyNvidiaNames } = require('./src/miner/gpuSelect.js')

  const client = window.client = new ScdoClient()
  const UI_PATH = path.join(os.homedir(), '.ScdoWallet', 'ui112.json')
  const S0TX_PATH = path.join(os.homedir(), '.ScdoWallet', 's0tx.json')

  // ---------------- small helpers ----------------
  const $ = (id) => document.getElementById(id)
  function esc (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])) }
  function readJson (p, d) { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch (e) { return d } }
  function writeJson (p, v) { try { fs.writeFileSync(p, JSON.stringify(v, null, 2)) } catch (e) { console.error(e) } }
  function lang () { return (client.config && client.config.lang) === 'CN' ? 'CN' : 'EN' }
  function T (k, p) {
    let s = (window.I18N112[lang()] || {})[k]; if (s == null) s = window.I18N112.EN[k]; if (s == null) s = k
    if (p) s = s.replace(/\{(\w+)\}/g, (m, n) => p[n] != null ? p[n] : m)
    return s
  }
  // punctuation that follows the UI language (full-width in Chinese, ASCII in English)
  const PU = { c: () => lang() === 'CN' ? '：' : ': ', l: () => lang() === 'CN' ? '（' : ' (', r: () => lang() === 'CN' ? '）' : ')', bar: () => lang() === 'CN' ? ' ｜ ' : ' | ', com: () => lang() === 'CN' ? '，' : ', ' }
  function fmtNum (x, dMax) {
    const n = Number(x); if (!isFinite(n)) return String(x)
    const mx = Math.max(0, Math.min(20, dMax == null ? 6 : Number(dMax)))
    return n.toLocaleString('en-US', { minimumFractionDigits: Math.min(3, mx), maximumFractionDigits: mx })
  }
  function fmtWei (wei, dMax) { return fmtNum(ethers.formatEther(wei), dMax) }
  function fmtHash (h) { if (h == null) return '–'; const u = ['H/s', 'kH/s', 'MH/s', 'GH/s']; let i = 0; while (h >= 1000 && i < 3) { h /= 1000; i++ } return h.toFixed(2) + ' ' + u[i] }
  function toast (msg, ms) { const t = $('toast'); t.textContent = msg; t.style.display = 'block'; clearTimeout(toast._t); toast._t = setTimeout(() => { t.style.display = 'none' }, ms || 3500) }
  function copyText (t) { navigator.clipboard.writeText(t).then(() => toast(T('copied') + PU.c() + t)).catch(() => toast(t)) }
  function avatar (name) {
    let h = 0; for (const c of String(name)) h = (h * 31 + c.codePointAt(0)) >>> 0
    const hue = h % 360
    const ch = (String(name).trim()[0] || '?').toUpperCase()
    return `<div class="avatar" style="background:hsl(${hue},62%,48%)">${esc(ch)}</div>`
  }
  function openExternal (url) { ipcRenderer.invoke('shell:openExternal', url) }

  // ---------------- state ----------------
  const ui = readJson(UI_PATH, {})
  ui.hidden = ui.hidden || { new: [], old: [] }
  ui.hidden.new = ui.hidden.new || []; ui.hidden.old = ui.hidden.old || []
  ui.showHidden = !!ui.showHidden
  function saveUi () { writeJson(UI_PATH, ui) }
  // 1.1.4: account display names. Keyfiles are never renamed on disk; the label shown is ui.names[file] (Rename),
  // else the file name without its ".<timestamp>" suffix. Files without a usable name (empty, or the old "new …"
  // default) get a stable number: 账户 N / Account N.
  ui.names = (ui.names && typeof ui.names === 'object' && !Array.isArray(ui.names)) ? ui.names : {}
  ui.accNo = (ui.accNo && typeof ui.accNo === 'object' && !Array.isArray(ui.accNo)) ? ui.accNo : {}
  ui.rewardExtra = Array.isArray(ui.rewardExtra) ? ui.rewardExtra.filter(x => /^0x[0-9a-fA-F]{40}$/.test(x)) : []
  const stripTs = (f) => String(f).replace(/\.\d{10,}$/, '').trim()
  const needsNo = (f) => { const b = stripTs(f); return !b || /^new(\s|$|[-_.])/i.test(b) || /^account\d*$/i.test(b) }
  const nextNo = () => Math.max(0, ...Object.values(ui.accNo).map(Number).filter(Number.isFinite)) + 1
  function accLabel (a) {
    const f = typeof a === 'string' ? a : (a && a.filename) || ''
    if (ui.names[f]) return ui.names[f]
    if (ui.accNo[f]) return T('accountN', { n: ui.accNo[f] })
    return stripTs(f) || f
  }
  // Network shown in the top-right selector: 'new' = SCDO Shard0 (EVM) (chain ID 5680), 'old' = Classic shards; ui.shard = 1..4 (one shard) or 0 (all four).
  // Kept in ui112.json (synchronous file write) so the choice survives a restart even if localStorage is not flushed.
  const TABS = ['home', 'new', 'old', 'mine']
  let tab0 = TABS.includes(ui.tab) ? ui.tab : (localStorage.getItem('tab112') || 'home')
  if (!TABS.includes(tab0)) tab0 = 'home'
  if (ui.net !== 'old' && ui.net !== 'new') ui.net = tab0 === 'old' ? 'old' : 'new'
  ui.shard = [0, 1, 2, 3, 4].includes(Number(ui.shard)) ? Number(ui.shard) : 0
  const shardFilter = (l) => ui.shard ? l.filter(a => String(a.shard) === String(ui.shard)) : l
  if (ui.net === 'old' && (tab0 === 'home' || tab0 === 'new')) tab0 = 'old'
  if (ui.net === 'new' && tab0 === 'old') tab0 = 'home'
  const st = {
    tab: tab0,
    homeSub: localStorage.getItem('homeSub112') || 'assets',
    sel: localStorage.getItem('selAcc112') || '',
    accounts: [],
    s0: {}, // filename -> { nativeWei, tokens, err }
    old: {}, // pubkey -> number (SCDO) | null
    net: { s0Block: null, s0Ok: null, oldOk: null },
    miner: null, gpu: null, logOpen: false
  }
  let s0 = null
  function shard0 () {
    if (!s0) { const cfg = client.config || {}; s0 = new Shard0(Object.assign({}, cfg.shard0 || {}, { rpc: (cfg.connect && cfg.connect[0]) || 'https://scdoscan.io/rpc/0' })) }
    return s0
  }
  function loadAccounts () {
    client.accountList()
    st.accounts = client.accountArray.map(a => ({ filename: a.filename, pubkey: a.pubkey, shard: a.shard, evm: client.evmAddressOf(a.filename) }))
    const names = st.accounts.map(a => a.filename)
    ui.hidden.new = ui.hidden.new.filter(n => names.includes(n)); ui.hidden.old = ui.hidden.old.filter(n => names.includes(n))
    let changed = false
    for (const k of Object.keys(ui.accNo)) if (!names.includes(k)) { delete ui.accNo[k]; changed = true }
    for (const k of Object.keys(ui.names)) if (!names.includes(k)) { delete ui.names[k]; changed = true }
    const tsOf = (f) => { const m = /\.(\d{10,})$/.exec(f); return m ? Number(m[1]) : 0 }
    st.accounts.filter(a => !ui.names[a.filename] && !ui.accNo[a.filename] && needsNo(a.filename))
      .sort((x, y) => tsOf(x.filename) - tsOf(y.filename) || x.filename.localeCompare(y.filename))
      .forEach(a => { ui.accNo[a.filename] = nextNo(); changed = true })
    if (changed) saveUi()
  }
  const isHidden = (chain, f) => ui.hidden[chain].includes(f)
  const visible = (chain) => st.accounts.filter(a => !isHidden(chain, a.filename))
  const listed = (chain) => ui.showHidden ? st.accounts : visible(chain)
  function selected () {
    const vis = visible('new')
    let a = vis.find(x => x.filename === st.sel)
    if (!a) { a = vis.find(x => x.evm) || vis[0] || null; st.sel = a ? a.filename : ''; localStorage.setItem('selAcc112', st.sel) }
    return a
  }
  function accByFile (f) { return st.accounts.find(a => a.filename === f) }

  // ---------------- shard0 activity (local) ----------------
  function s0txAll () { return readJson(S0TX_PATH, []) }
  function s0txAdd (r) { const l = s0txAll(); l.unshift(r); writeJson(S0TX_PATH, l.slice(0, 500)) }
  function s0txUpdate (hash, patch) { const l = s0txAll(); const r = l.find(x => x.hash === hash); if (r) { Object.assign(r, patch); writeJson(S0TX_PATH, l) } }

  // ---------------- data refresh ----------------
  let refreshingS0 = false
  async function refreshS0 () {
    if (refreshingS0) return; refreshingS0 = true
    try {
      try { const ci = await shard0().chainInfo(); st.net.s0Block = ci.block; st.net.s0Ok = ci.chainId === 5680 } catch (e) { st.net.s0Ok = false }
      await Promise.all(st.accounts.filter(a => a.evm).map(async a => {
        try { const b = await shard0().balances(a.evm); st.s0[a.filename] = { nativeWei: b.nativeWei, tokens: b.tokens } } catch (e) { st.s0[a.filename] = Object.assign({}, st.s0[a.filename], { err: e.shortMessage || e.message }) }
      }))
      const pend = s0txAll().filter(r => r.status === 'pending').slice(0, 10)
      for (const r of pend) {
        try { const rc = await shard0().provider.getTransactionReceipt(r.hash); if (rc) s0txUpdate(r.hash, { status: rc.status === 1 ? 'done' : 'fail', block: rc.blockNumber }) } catch (e) {}
      }
    } finally { refreshingS0 = false; renderLive() }
  }
  let refreshingOld = false
  function refreshOld () {
    if (refreshingOld || !st.accounts.length) return; refreshingOld = true
    let left = st.accounts.length; let anyOk = false
    const doneOne = () => { if (--left <= 0) { refreshingOld = false; st.net.oldOk = anyOk; renderLive() } }
    st.accounts.forEach(a => {
      let answered = false
      const to = setTimeout(() => { if (!answered) { answered = true; doneOne() } }, 20000)
      try {
        client.getBalance({ pubkey: a.pubkey, shard: a.shard }, (info, err) => {
          if (answered) return; answered = true; clearTimeout(to)
          if (!err && info && info.Balance != null) { st.old[a.pubkey] = info.Balance / 1e8; anyOk = true }
          doneOne()
        })
      } catch (e) { if (!answered) { answered = true; clearTimeout(to); doneOne() } }
    })
  }
  function s0Total (list) { let t = 0n; let known = 0; for (const a of list) { const b = st.s0[a.filename]; if (b && b.nativeWei != null) { t += b.nativeWei; known++ } } return { wei: t, known } }
  function oldTotal (list) { let t = 0; let known = 0; for (const a of list) { const v = st.old[a.pubkey]; if (v != null) { t += v; known++ } } return { v: t, known } }

  // ---------------- header / tabs ----------------
  // switch tab; the account tabs also set the network (SCDO Shard0 (EVM) tab -> 'new', Classic accounts tab -> 'old'); Mining keeps it
  function setTab (v) {
    st.tab = TABS.includes(v) ? v : 'home'
    if (st.tab === 'old') ui.net = 'old'; else if (st.tab === 'home' || st.tab === 'new') ui.net = 'new'
    ui.tab = st.tab; localStorage.setItem('tab112', st.tab); saveUi()
  }
  function setNet (v, shard) {
    const net = v === 'old' ? 'old' : 'new'
    if (net === 'old') { ui.shard = [1, 2, 3, 4].includes(Number(shard)) ? Number(shard) : 0; setTab('old') } else setTab(st.tab === 'old' ? 'home' : st.tab === 'mine' ? 'mine' : st.tab)
    ui.net = net; saveUi()
  }
  const netOldName = () => ui.shard ? T('netOld', { n: ui.shard }) : T('netOldAll')
  function renderHeader () {
    const a = selected()
    const netOld = ui.net === 'old'
    const netOk = netOld ? st.net.oldOk : st.net.s0Ok
    let sw
    if (a) {
      sw = `<div class="acct-switch" data-act="accMenu" id="acctSwitch" title="${esc(T('switchAccount'))}">
        ${avatar(accLabel(a))}
        <div style="min-width:0"><div class="an">${esc(accLabel(a))} ▾</div>
        <div class="aa ${a.evm ? 'mono' : ''}">${a.evm ? esc(a.evm) : '🔒 ' + esc(T('locked'))}</div></div>
        ${a.evm ? `<button class="ico" data-act="copy" data-v="${esc(a.evm)}" title="${esc(T('copy'))}">⧉</button><button class="ico" data-act="receive" data-f="${esc(a.filename)}" data-chain="new" title="${esc(T('qr'))}">▦</button>` : ''}
      </div>`
    } else sw = `<div class="acct-switch" data-act="accMenu" id="acctSwitch">${avatar('?')}<div class="an">${esc(T('noAccount'))} ▾</div></div>`
    $('hdr').innerHTML = `<div class="brand"><img src="./src/img/app-icon.png" alt=""><div><div class="bt">${esc(T('appName'))}</div><div class="bv">ScdoWalletBeta ${esc(APPVER)}</div></div></div>
      ${sw}<div class="spacer"></div>
      <div class="netsel" data-act="netMenu" id="netSel"><span class="dot ${netOk == null ? '' : netOk ? 'ok' : 'bad'}"></span>${esc(netOld ? netOldName() : T('netNew'))} ▾</div>
      <div class="lang"><button class="${lang() === 'CN' ? 'on' : ''}" data-act="lang" data-v="CN" id="langCN">中文</button><button class="${lang() === 'EN' ? 'on' : ''}" data-act="lang" data-v="EN" id="langEN">English</button></div>
      <button class="gear" data-act="settings" id="gear" title="${esc(T('settings'))}">⚙</button>`
    const tabs = [['home', 'tabHome'], ['new', 'tabNew'], ['old', 'tabOld'], ['mine', 'tabMine']]
    $('tabs').innerHTML = tabs.map(([k, l]) => `<button class="${st.tab === k ? 'on' : ''}" data-act="tab" data-v="${k}" id="tab-${k}">${esc(T(l))}</button>`).join('')
  }

  // ---------------- pages ----------------
  function pageHome () {
    const a = selected()
    if (!st.accounts.length) {
      return `<div class="page"><div class="card welcome"><h2>${esc(T('welcomeTitle'))}</h2><div class="muted" style="font-size:21px">${esc(T('welcomeText'))}</div>
        <div class="actions"><button class="btn pri big" data-act="create">${esc(T('createAccount'))}</button><button class="btn sec big" data-act="import">${esc(T('importAccount'))}</button></div></div></div>`
    }
    const vis = visible('new')
    const tot = s0Total(vis)
    const hiddenN = ui.hidden.new.length
    let top
    if (!a) top = `<div class="balance-card card"><div class="bl">${esc(T('s0Balance'))}</div><div class="muted" style="margin-top:14px">${esc(T('hiddenHint', { n: hiddenN }))}</div></div>`
    else if (!a.evm) {
      top = `<div class="balance-card card"><div class="bl">${esc(T('s0Balance'))}</div>
        <div style="font-size:24px;font-weight:700;margin-top:16px">🔒 ${esc(T('unlockTitle'))}</div>
        <div class="unlockbox"><input class="inp" type="password" id="homePw" placeholder="${esc(T('password'))}" style="width:320px" data-enter="unlockHome">
        <button class="btn pri" data-act="unlock" data-f="${esc(a.filename)}" data-in="homePw">${esc(T('showAddress'))}</button></div></div>`
    } else {
      const b = st.s0[a.filename]
      const bal = b && b.nativeWei != null ? fmtWei(b.nativeWei) : '…'
      top = `<div class="balance-card card"><div class="bl">${esc(T('s0Balance'))}</div>
        <div class="bn" id="homeBal">${esc(bal)}<span>SCDO</span></div>
        <div class="bs">${esc(T('currentAccount'))}${PU.c()}<b class="wrap">${esc(accLabel(a))}</b>${PU.bar()}${esc(T('allNewTotal'))}${PU.c()}<span id="homeTot">${tot.known ? esc(fmtWei(tot.wei)) : '…'}</span> SCDO${PU.l()}${esc(T('nAccounts', { n: vis.length }))}${hiddenN ? PU.com() + esc(T('exclHidden')) : ''}${PU.r()}</div>
        <div class="actions"><button class="btn pri big" data-act="receive" data-f="${esc(a.filename)}" data-chain="new" id="btnReceive">⬇&nbsp; ${esc(T('receive'))}</button>
        <button class="btn pri big" data-act="send" data-f="${esc(a.filename)}" id="btnSend">⬆&nbsp; ${esc(T('send'))}</button></div></div>`
    }
    let lower = ''
    if (a && a.evm) {
      lower = `<div class="card" style="margin-top:22px"><div class="subtabs">
        <button class="${st.homeSub === 'assets' ? 'on' : ''}" data-act="homeSub" data-v="assets">${esc(T('assets'))}</button>
        <button class="${st.homeSub === 'activity' ? 'on' : ''}" data-act="homeSub" data-v="activity">${esc(T('activity'))}</button></div>
        <div id="homeLower">${st.homeSub === 'assets' ? assetsHtml(a) : activityHtml(a)}</div></div>`
    }
    const ot = oldTotal(visible('old'))
    const oldBox = `<div class="oldbox"><div style="flex:1;min-width:280px"><div class="lbl" style="font-size:17px">${esc(T('oldTotal'))}</div>
      <div class="ov" id="homeOld">${ot.known ? esc(fmtNum(ot.v)) : '…'} <span style="font-size:19px">SCDO</span></div></div>
      <button class="link" style="font-size:20px" data-act="tab" data-v="old">${esc(T('viewOld'))}</button></div>`
    return `<div class="page">${top}${lower}${oldBox}</div>`
  }
  // ----- assets of the current chain (shard0): native SCDO first, then the tokens configured for this chain -----
  const TOKEN_COLORS = { tUSDT: '#26a17b', tAUD: '#e8a317' }
  function assetIconHtml (sym) {
    if (sym === 'SCDO') return '<div class="ai"><img src="./src/img/app-icon.png" alt=""></div>'
    return `<div class="ai" style="background:${TOKEN_COLORS[sym] || '#8a8fa8'}">${esc(String(sym).replace(/^t/, '').slice(0, 2))}</div>`
  }
  // -> [{ symbol, name, bal: formatted balance | null (unknown yet) }]
  function chainAssets (a) {
    const b = (a && st.s0[a.filename]) || {}
    const out = [{ symbol: 'SCDO', name: T('assetScdo'), bal: b.nativeWei != null ? fmtWei(b.nativeWei) : null }]
    for (const t of (shard0().cfg.tokens || [])) {
      const bt = (b.tokens || []).find(x => x.symbol === t.symbol)
      out.push({ symbol: t.symbol, name: T('assetTest'), bal: bt && bt.balance != null ? (bt.balance === '?' ? '?' : fmtNum(bt.balance, bt.decimals)) : null })
    }
    return out
  }
  function assetsHtml (a) {
    return chainAssets(a).map(x => `<div class="asset">${assetIconHtml(x.symbol)}<div><div class="an">${esc(x.symbol)}</div><div class="lbl">${esc(x.name)}</div></div>
      <div class="av">${x.bal == null ? '…' : esc(x.bal)} <span class="lbl">${esc(x.symbol)}</span></div></div>`).join('')
  }
  // MetaMask-style asset dropdown used on the Send page: the button shows icon + symbol + balance of the chosen asset,
  // the menu lists every asset of the current chain (SCDO first) with icon, symbol, name and balance.
  function assetPickerHtml (a, cur) {
    const x = chainAssets(a).find(z => z.symbol === cur) || chainAssets(a)[0]
    return `<div class="assetsel" id="assetSel"><button type="button" class="assetbtn" id="assetBtn" aria-haspopup="listbox" aria-expanded="false" title="${esc(T('selectAsset'))}">
      ${assetIconHtml(x.symbol)}<div class="at"><div class="as">${esc(x.symbol)}</div><div class="lbl">${esc(T('balanceIs', { v: x.bal == null ? '…' : x.bal + ' ' + x.symbol }))}</div></div><span class="caret">▾</span></button>
      <div class="assetlist" id="assetList" role="listbox" hidden></div></div>`
  }
  function wireAssetPicker (a, getCur, onPick) {
    const btn = $('assetBtn'); const list = $('assetList'); if (!btn || !list) return
    const close = () => { list.hidden = true; btn.setAttribute('aria-expanded', 'false') }
    const open = () => {
      const cur = getCur()
      list.innerHTML = `<div class="lbl" style="padding:6px 14px">${esc(T('selectAsset'))}</div>` + chainAssets(a).map(x =>
        `<button type="button" class="ait ${x.symbol === cur ? 'on' : ''}" role="option" aria-selected="${x.symbol === cur}" data-pick="${esc(x.symbol)}">${assetIconHtml(x.symbol)}
          <div class="at"><div class="as">${esc(x.symbol)}</div><div class="lbl">${esc(x.name)}</div></div>
          <div class="ab">${x.bal == null ? '…' : esc(x.bal)} <span class="lbl">${esc(x.symbol)}</span></div><span class="ck">${x.symbol === cur ? '✓' : ''}</span></button>`).join('')
      list.hidden = false; btn.setAttribute('aria-expanded', 'true')
      try { list.scrollIntoView({ block: 'nearest' }) } catch (e) {}
      const on = list.querySelector('.ait.on') || list.querySelector('.ait'); if (on) on.focus()
      list.querySelectorAll('[data-pick]').forEach(it => { it.onclick = (e) => { e.stopPropagation(); close(); const v = it.getAttribute('data-pick'); if (v !== getCur()) onPick(v); else btn.focus() } })
    }
    btn.onclick = (e) => { e.stopPropagation(); if (list.hidden) open(); else close() }
    list.onkeydown = (e) => {
      const items = [...list.querySelectorAll('.ait')]; const i = items.indexOf(document.activeElement)
      if (e.key === 'ArrowDown') { e.preventDefault(); (items[i + 1] || items[0]).focus() } else if (e.key === 'ArrowUp') { e.preventDefault(); (items[i - 1] || items[items.length - 1]).focus() }
    }
    $('md').addEventListener('mousedown', (e) => { if (!list.hidden && !e.target.closest('#assetSel')) close() })
  }
  window.__closeAssetList = () => { const l = $('assetList'); if (l && !l.hidden) { l.hidden = true; const b = $('assetBtn'); if (b) { b.setAttribute('aria-expanded', 'false'); b.focus() } return true } return false }
  function activityHtml (a) {
    const l = s0txAll().filter(r => r.from && a.evm && r.from.toLowerCase() === a.evm.toLowerCase()).slice(0, 30)
    let h = ''
    if (!l.length) h = `<div style="padding:22px 26px" class="muted">${esc(T('noActivity'))}</div>`
    l.forEach(r => {
      const stt = r.status === 'done' ? `<span class="tag" style="background:#e8f7ee;color:#146c2e">${esc(T('txDone'))}</span>` : r.status === 'fail' ? `<span class="tag" style="background:#fff1f0;color:#a3160c">${esc(T('txFail'))}</span>` : `<span class="tag grey">${esc(T('txPending'))}</span>`
      h += `<div class="txrow" data-act="openTx" data-v="${esc(r.hash)}"><div style="font-size:26px">⬆</div><div style="flex:1;min-width:0"><div style="font-weight:700;font-size:19px">${esc(T('txSent'))} → <span class="mono" style="font-weight:400;font-size:17px">${esc(r.to)}</span></div>
        <div class="lbl">${esc(new Date(r.t).toLocaleString(lang() === 'CN' ? 'zh-CN' : 'en-GB'))}${r.block ? ' · #' + esc(r.block) : ''}</div></div>
        <div style="text-align:right"><div style="font-size:21px;font-weight:700">−${esc(fmtNum(r.amount))} ${esc(r.asset)}</div>${stt}</div></div>`
    })
    h += `<div style="padding:14px 26px"><button class="link" data-act="explorerAddr" data-v="${esc(a.evm)}">${esc(T('viewExplorer'))}</button></div>`
    return h
  }

  function pageNew () {
    const list = listed('new')
    const hiddenN = ui.hidden.new.length
    let h = `<div class="page"><div class="list-head"><div style="flex:1;min-width:300px"><div class="h1">${esc(T('newTitle'))}</div><div class="muted" style="font-size:17px;margin-top:4px">${esc(T('newNote'))}</div></div>
      <button class="toggle" data-act="toggleHidden" id="toggleHidden"><span class="sw ${ui.showHidden ? 'on' : ''}"></span>${esc(T('showHidden', { n: hiddenN }))}</button>
      <button class="btn sec" data-act="create">${esc(T('createAccount'))}</button><button class="btn sec" data-act="import">${esc(T('importAccount'))}</button></div>`
    if (!st.accounts.length) h += `<div class="hint-box">${esc(T('emptyList'))}</div>`
    list.forEach((a, i) => {
      const hid = isHidden('new', a.filename)
      const b = st.s0[a.filename]
      let mid; let right
      if (a.evm) {
        mid = `<div class="lbl" style="margin-top:4px">${esc(T('newAddrLabel'))}</div><div class="row" style="margin-top:2px;flex-wrap:wrap"><span class="mono addr">${esc(a.evm)}</span>
          <button class="btn ghost small" data-act="copy" data-v="${esc(a.evm)}">${esc(T('copy'))}</button><button class="btn ghost small" data-act="receive" data-f="${esc(a.filename)}" data-chain="new">${esc(T('qr'))}</button></div>`
        right = `<div class="bal"><div class="lbl">${esc(T('balance'))}</div><div class="v" data-bal="${esc(a.filename)}">${b && b.nativeWei != null ? esc(fmtWei(b.nativeWei)) : '…'} <span>SCDO</span></div></div>`
      } else {
        mid = `<div class="lbl" style="margin-top:4px">${esc(T('newAddrLabel'))}</div><div class="row" style="margin-top:6px;flex-wrap:wrap"><span class="lockline">🔒 ${esc(T('locked'))}</span>
          <input class="inp" type="password" id="pw-n-${i}" placeholder="${esc(T('password'))}" style="width:250px;height:46px">
          <button class="btn sec" data-act="unlock" data-f="${esc(a.filename)}" data-in="pw-n-${i}">${esc(T('showAddress'))}</button></div>`
        right = `<div class="bal"><div class="lbl">${esc(T('balance'))}</div><div class="muted" style="font-size:17px">${esc(T('balanceAfterUnlock'))}</div></div>`
      }
      h += `<div class="card acc ${hid ? 'hidden-acc' : ''}" data-row="${esc(a.filename)}"><div class="main"><div class="nm">${esc(accLabel(a))} ${hid ? `<span class="tag grey">${esc(T('hiddenTag'))}</span>` : ''}</div>${mid}</div>${right}
        <div class="ops one"><button class="btn ghost small" data-act="rename" data-f="${esc(a.filename)}">${esc(T('rename'))}</button><button class="btn ghost small" data-act="${hid ? 'unhide' : 'hide'}" data-chain="new" data-f="${esc(a.filename)}">${esc(hid ? T('unhide') : T('hide'))}</button>
        <button class="btn danl small" data-act="delete" data-f="${esc(a.filename)}">${esc(T('del'))}</button></div></div>`
    })
    if (hiddenN && !ui.showHidden) h += `<div class="hint-box">👁 ${esc(T('hiddenHint', { n: hiddenN }))}</div>`
    return h + '</div>'
  }

  function pageOld () {
    const list = shardFilter(listed('old'))
    const hiddenN = ui.hidden.old.length
    const chips = `<div class="shardchips" id="shardChips">${[0, 1, 2, 3, 4].map(n => `<button class="${ui.shard === n ? 'on' : ''}" data-act="pickShard" data-v="${n}" id="chip-${n}">${esc(n ? T('shardN', { n }) : T('shardAll'))}</button>`).join('')}</div>`
    let h = `<div class="page"><div class="list-head"><div style="flex:1;min-width:300px"><div class="h1">${esc(ui.shard ? T('oldTitleN', { n: ui.shard }) : T('oldTitle'))} <span style="font-size:20px;color:#5f6482;font-weight:500">${esc(ui.shard ? T('oldSubN', { n: ui.shard }) : T('oldSub'))}</span></div>
      <div class="muted" style="font-size:17px;margin-top:4px">${esc(T('oldNote'))}</div></div>
      <button class="toggle" data-act="toggleHidden"><span class="sw ${ui.showHidden ? 'on' : ''}"></span>${esc(T('showHidden', { n: hiddenN }))}</button></div>${chips}`
    if (!st.accounts.length) h += `<div class="hint-box">${esc(T('emptyList'))}</div>`
    else if (!list.length) h += `<div class="hint-box">${esc(T('noShardAcc'))}</div>`
    list.forEach(a => {
      const hid = isHidden('old', a.filename)
      const v = st.old[a.pubkey]
      h += `<div class="card acc ${hid ? 'hidden-acc' : ''}"><div class="main"><div class="nm">${esc(accLabel(a))} <span class="tag">${esc(T('shardN', { n: a.shard }))}</span> ${hid ? `<span class="tag grey">${esc(T('hiddenTag'))}</span>` : ''}</div>
        <div class="lbl" style="margin-top:4px">${esc(T('oldAddrLabel', { n: a.shard }))}</div><div class="row" style="margin-top:2px;flex-wrap:wrap"><span class="mono addr">${esc(a.pubkey)}</span>
        <button class="btn ghost small" data-act="copy" data-v="${esc(a.pubkey)}">${esc(T('copy'))}</button></div></div>
        <div class="bal"><div class="lbl">${esc(T('balance'))}</div><div class="v" style="color:#3d4160" data-oldbal="${esc(a.pubkey)}">${v != null ? esc(fmtNum(v)) : '…'} <span>SCDO</span></div></div>
        <div class="ops"><button class="btn sec small" data-act="receive" data-f="${esc(a.filename)}" data-chain="old">${esc(T('receive'))}</button>
        <button class="btn sec small" data-act="sendOld" data-f="${esc(a.filename)}">${esc(T('send'))}</button>
        <button class="btn ghost small" data-act="rename" data-f="${esc(a.filename)}">${esc(T('rename'))}</button>
        <button class="btn ghost small" data-act="${hid ? 'unhide' : 'hide'}" data-chain="old" data-f="${esc(a.filename)}">${esc(hid ? T('unhide') : T('hide'))}</button>
        <button class="btn danl small" data-act="delete" data-f="${esc(a.filename)}">${esc(T('del'))}</button></div></div>`
    })
    if (hiddenN && !ui.showHidden) h += `<div class="hint-box">👁 ${esc(T('hiddenHint', { n: hiddenN }))}</div>`
    const ot = oldTotal(shardFilter(visible('old')))
    h += `<div class="total-line"><span style="font-size:20px;color:#3d4160">${esc(ui.shard ? T('oldSumN', { n: ui.shard }) : T('oldSum'))}</span><span style="font-size:30px;font-weight:800;color:#3d4160" id="oldTot">${ot.known ? esc(fmtNum(ot.v)) : '…'} SCDO</span></div>`
    try { client.getRecords() } catch (e) {}
    const recs = (client.txRecords || []).filter(Boolean).slice(0, 20)
    h += `<div class="card" style="margin-top:22px;padding:18px 24px"><div style="font-size:22px;font-weight:700">${esc(T('oldRecords'))}</div>`
    if (!recs.length) h += `<div class="muted" style="margin-top:8px">${esc(T('noOldRecords'))}</div>`
    recs.forEach(r => {
      const s = r.u == 1 ? T('txDone') : r.u == 0 ? T('txFail') : T('txPending') // eslint-disable-line eqeqeq
      h += `<div style="padding:10px 0;border-bottom:1px solid #f0f1f7"><div class="row" style="flex-wrap:wrap"><b>${esc(fmtNum(r.m / 1e8))} SCDO</b><span class="tag grey">${esc(s)}</span><span class="lbl">${esc(new Date(r.t).toLocaleString(lang() === 'CN' ? 'zh-CN' : 'en-GB'))}</span></div>
        <div class="mono lbl">${esc(r.fa)} → ${esc(r.ta)}</div><div class="mono lbl">${esc(r.s)}</div></div>`
    })
    return h + '</div></div>'
  }

  // ---------------- mining ----------------
  function minerText (m) {
    if (!m) return T('st_IDLE')
    const code = m.code || 'IDLE'
    const p = { l: m.localBlock == null ? '?' : m.localBlock, n: m.networkBlock == null ? '?' : m.networkBlock, w: m.wallet || '', m: m.message || '' }
    let s = T('st_' + code, p)
    if (s === 'st_' + code) s = m.message || code
    if (code === 'DOWNLOADING' && m.download && m.download.total) s += ' ' + Math.round(100 * m.download.got / m.download.total) + '%'
    return s
  }
  function minerClass (m) {
    if (!m) return ''
    if (m.phase === 'error') return 'bad'
    if (['MINING', 'NODE_RUNNING', 'EXTERNAL_NODE'].includes(m.code)) return 'good'
    if (['SYNCING', 'NO_PEERS', 'MINING_STARTING', 'STARTING', 'DOWNLOADING', 'EXTRACTING', 'INIT', 'STOPPING', 'PAUSED', 'EXTERNAL_DOWN'].includes(m.code)) return 'warn'
    return ''
  }
  function rewardOptions () {
    const l = visible('new').filter(a => a.evm).map(a => ({ v: a.evm, l: accLabel(a) }))
    const extra = ui.rewardExtra.slice()
    for (const k of ['minerReward', 'nodePayout']) { const x = localStorage.getItem(k); if (x && /^0x[0-9a-fA-F]{40}$/.test(x) && !extra.some(y => y.toLowerCase() === x.toLowerCase())) extra.push(x) }
    for (const x of extra) if (!l.some(o => o.v.toLowerCase() === x.toLowerCase())) l.push({ v: x, l: T('rewardOtherLabel') })
    return l
  }
  // address <select>: placeholder when nothing is chosen (never silently preselect an account), wallet accounts by
  // name, saved external addresses, and "other address…" which opens a paste field
  function addrSelect (id, opts, cur, disabled) {
    const has = !!cur && opts.some(o => o.v.toLowerCase() === String(cur).toLowerCase())
    const open = !!(st.otherOpen && st.otherOpen[id])
    return `<select class="inp" id="${id}" ${disabled ? 'disabled' : ''}><option value="" ${has ? '' : 'selected'} disabled>${esc(T('pickAddr'))}</option>${opts.map(o => `<option value="${esc(o.v)}" ${has && o.v.toLowerCase() === String(cur).toLowerCase() ? 'selected' : ''}>${esc(o.l)} — ${esc(o.v)}</option>`).join('')}<option value="__other">${esc(T('rewardOther'))}</option></select>
      <div class="row" id="${id}-oth" style="display:${open && !disabled ? 'flex' : 'none'};margin-top:8px;gap:10px;flex-wrap:wrap"><input class="inp mono" id="${id}-in" placeholder="0x…" style="flex:1;min-width:320px" autocomplete="off"><button class="btn sec" data-act="useOtherAddr" data-v="${id}">${esc(T('rewardOtherUse'))}</button></div>`
  }
  function nodeStateText (m) { return m.running ? (m.phase === 'external' ? T('nodeExternal') : minerClass(m) === 'good' ? '✔ ' + T('nodeRunning') : minerClass(m) === 'bad' ? '✖ ' + T('nodeError') : T('nodeStarting')) : T('notRunning') }
  function payoutDefault () {
    const opts = rewardOptions(); const saved = localStorage.getItem('nodePayout') || ''
    if (saved && opts.some(o => o.v.toLowerCase() === saved.toLowerCase())) return saved
    const a = selected(); return a && a.evm ? a.evm : ''
  }
  function payoutField (m, running) {
    if (running && m.mode === 'node') return m.payout ? `<div class="infobox" style="font-size:18px">${esc(T('payoutNow', { a: m.payout }))}</div>` : ''
    const opts = rewardOptions(); const cur = payoutDefault()
    return `<div class="field" style="margin-top:14px"><div class="lbl" style="font-weight:600">${esc(T('payoutAddr'))}</div>${addrSelect('nPayout', opts, cur, running)}${opts.length ? '' : `<div class="lbl" style="margin-top:6px">${esc(T('payoutNone'))}</div>`}</div>`
  }
  function pageMine () {
    const m = st.miner || {}
    const running = !!m.running
    let h = `<div class="page"><div class="card mine-card"><div style="font-size:30px;font-weight:700">${esc(T('mineTitle'))}</div>`
    if (process.platform === 'darwin') return h + `<div class="nogpu">${esc(T('macNo'))}</div></div></div>`
    if (!st.gpu) return h + `<div class="statusbar"><span class="spin"></span> ${esc(T('detecting'))}</div></div></div>`
    const g = st.gpu
    const nodeMode = m.mode === 'node' && running
    const mineMode = m.mode === 'mine' && running
    const statusBar = `<div class="statusbar ${minerClass(m)}" id="minerStatus">${esc(minerText(m))}</div>`
    const blocks = `<div class="stat"><div class="lbl">${esc(T('localNet'))}</div><div class="v" id="mBlocks">${m.localBlock == null ? '–' : esc(m.localBlock)} / ${m.networkBlock == null ? (st.net.s0Block == null ? '–' : esc(st.net.s0Block)) : esc(m.networkBlock)}</div></div>
      <div class="stat"><div class="lbl">${esc(T('peers'))}</div><div class="v" id="mPeers">${m.peers == null ? '–' : esc(m.peers)}</div></div>`
    if (miningGpuReady(g)) {
      const opts = rewardOptions()
      const saved = localStorage.getItem('minerReward') || ''
      const cur = m.wallet || saved
      const sel = addrSelect('mReward', opts, cur, running) + (opts.length ? '' : `<div class="lbl" style="margin-top:6px">${esc(T('noRewardAddr'))}</div>`)
      h += `<div class="tag" style="background:#e8f7ee;color:#146c2e;margin-top:12px">${esc(T('gpuYes'))}</div>
        <div style="font-size:21px;margin-top:10px">${esc(T('gpuName', { n: readyNvidiaNames(g).join(', ') }))}</div>
        <div class="field" style="margin-top:14px"><div class="lbl" style="font-weight:600">${esc(T('rewardAddr'))}</div>${sel}</div>
        ${statusBar}
        <div class="stats"><div class="stat"><div class="lbl">${esc(T('hashrate'))} ${mineMode ? '' : esc(T('hashrateHint'))}</div><div class="v" id="mHr">${mineMode && m.hashrate != null ? esc(fmtHash(m.hashrate)) : '–'}</div></div>
        <div class="stat"><div class="lbl">${esc(T('blocksFound'))}</div><div class="v" id="mFound">${esc(m.blocksFound || 0)}</div></div>${blocks}</div>
        <div class="row" style="margin-top:22px;flex-wrap:wrap;gap:18px">
          ${mineMode ? `<button class="btn dan big" data-act="minerStop" id="btnMine">${esc(T('stopMining'))}</button>` : `<button class="btn pri big" data-act="mineStart" id="btnMine" ${running ? 'disabled' : ''}>${esc(T('startMining'))}</button>`}
          ${nodeMode ? `<button class="btn dan" data-act="minerStop">${esc(T('stopNode'))}</button>` : `<button class="btn ghost" data-act="nodeStart" ${running ? 'disabled' : ''}>${esc(T('nodeOnlyToo'))}</button>`}
        </div><div class="lbl" style="margin-top:10px">${esc(T('mineFirst'))}</div>
        ${mineMode ? '' : payoutField(m, running)}<div class="lbl" style="margin-top:6px">${esc(T('nodeHint'))}</div>`
    } else {
      h += `<div class="nogpu" id="noGpuMsg">${esc(T('noGpu'))}</div>`
      if (g.nvidiaNoDriver) h += `<div class="infobox">${esc(T('noGpuDriver', { n: (g.nvidiaNames || []).join(', ') }))}</div>`
      const ext = m.phase === 'external' && running
      const extOk = ext && m.code !== 'EXTERNAL_DOWN'
      // external node answering: one green line only (no separate status bar that could contradict it)
      if (extOk) h += `<div class="infobox" style="font-size:20px" id="extOk">${esc(T('externalNode', { u: '127.0.0.1:' + ((m.ports && m.ports.http) || 18545) }))}</div>`
      h += ext ? `<div class="lbl" style="margin-top:8px">${esc(T('extPayout'))}</div>` : payoutField(m, running)
      h += `${extOk ? '' : statusBar}<div class="stats"><div class="stat"><div class="lbl">${esc(T('nodeState'))}</div><div class="v" style="font-size:24px" id="mNodeState">${esc(nodeStateText(m))}</div></div>${blocks}</div>
        <div class="row" style="margin-top:22px;flex-wrap:wrap">
        ${ext ? `<button class="btn ghost" data-act="minerStop" id="btnNode">${esc(T('stopWatch'))}</button>` : running ? `<button class="btn dan big" data-act="minerStop" id="btnNode">${esc(T('stopNode'))}</button>` : `<button class="btn pri big" data-act="nodeStart" id="btnNode">${esc(T('runNode'))}</button>`}</div>
        <div class="lbl" style="margin-top:10px">${esc(ext ? T('extNoStop') : T('nodeHint'))}</div>`
    }
    h += `<details class="adv" id="advBox" ${st.advOpen ? 'open' : ''}><summary>${esc(T('advanced'))} <span>${esc(T('advHint'))}</span></summary>
      <div class="row" style="margin-top:14px;flex-wrap:wrap"><button class="btn ghost small" data-act="toggleLog">${esc(st.logOpen ? T('hideLog') : T('showLog'))}</button>
      <button class="btn ghost small" data-act="openLogs">${esc(T('openLogs'))}</button>
      ${process.platform === 'win32' && miningGpuReady(g) ? `<button class="btn ghost small" data-act="defender">${esc(T('defender'))}</button>` : ''}</div>
      <div class="lbl" style="margin-top:10px">${esc(T('cpuNote'))}</div>
      <pre class="log" id="mLog" style="display:${st.logOpen ? 'block' : 'none'}">${esc(((m.logTail) || []).slice(-80).join('\n'))}</pre></details>`
    return h + '</div></div>'
  }

  // ---------------- render ----------------
  function render () {
    loadAccounts()
    renderHeader()
    const main = $('main')
    const y = main.scrollTop
    const pages = { home: pageHome, new: pageNew, old: pageOld, mine: pageMine }
    main.innerHTML = (pages[st.tab] || pageHome)()
    main.scrollTop = y
    document.title = 'ScdoWalletBeta ' + APPVER
  }
  // cheap updates of numbers without re-rendering inputs the user may be typing into
  function renderLive () {
    renderHeaderNetOnly()
    if ($('md')) return
    if (st.tab === 'home') {
      const active = document.activeElement
      if (active && active.tagName === 'INPUT') return
      render()
    } else if (st.tab === 'new') {
      document.querySelectorAll('[data-bal]').forEach(el => { const b = st.s0[el.getAttribute('data-bal')]; if (b && b.nativeWei != null) el.innerHTML = esc(fmtWei(b.nativeWei)) + ' <span>SCDO</span>' })
    } else if (st.tab === 'old') {
      document.querySelectorAll('[data-oldbal]').forEach(el => { const v = st.old[el.getAttribute('data-oldbal')]; if (v != null) el.innerHTML = esc(fmtNum(v)) + ' <span>SCDO</span>' })
      const ot = oldTotal(shardFilter(visible('old'))); const e = $('oldTot'); if (e && ot.known) e.textContent = fmtNum(ot.v) + ' SCDO'
    }
  }
  function renderHeaderNetOnly () {
    const d = document.querySelector('.netsel .dot'); if (!d) return
    const ok = ui.net === 'old' ? st.net.oldOk : st.net.s0Ok
    d.className = 'dot ' + (ok == null ? '' : ok ? 'ok' : 'bad')
  }
  function renderMinerLive () {
    if (st.tab !== 'mine' || $('md')) return
    const m = st.miner || {}
    const e = $('minerStatus')
    const sig = [!!m.running, m.mode, m.phase === 'error', m.phase === 'external', m.code === 'EXTERNAL_DOWN'].join('|')
    if (sig !== renderMinerLive.sig || (!e && !$('extOk'))) { renderMinerLive.sig = sig; if (!(document.activeElement && ['mReward', 'nPayout', 'mReward-in', 'nPayout-in'].includes(document.activeElement.id))) render(); return }
    if (e) { e.className = 'statusbar ' + minerClass(m); e.textContent = minerText(m) }
    const set = (id, v) => { const x = $(id); if (x) x.textContent = v }
    set('mBlocks', (m.localBlock == null ? '–' : m.localBlock) + ' / ' + (m.networkBlock == null ? (st.net.s0Block == null ? '–' : st.net.s0Block) : m.networkBlock))
    set('mPeers', m.peers == null ? '–' : m.peers)
    if (m.mode === 'mine' && m.running) set('mHr', m.hashrate != null ? fmtHash(m.hashrate) : '–')
    set('mFound', m.blocksFound || 0)
    const ns = $('mNodeState'); if (ns) ns.textContent = nodeStateText(m)
    const lg = $('mLog'); if (lg && st.logOpen) { lg.textContent = (m.logTail || []).slice(-80).join('\n'); lg.scrollTop = lg.scrollHeight }
  }

  // ---------------- dropdowns ----------------
  function closeDd () { $('ddRoot').innerHTML = '' }
  function openDd (anchor, html, alignRight) {
    const r = anchor.getBoundingClientRect()
    // 1.1.4 fix: the click-away backdrop has its own class (.ddov, z-index below .dd). In 1.1.1-1.1.3 it reused the modal
    // .overlay (z-index 50 > .dd 40), so it covered the menu and every click on a menu item only closed the menu.
    $('ddRoot').innerHTML = `<div class="ddov" data-act="ddClose"></div><div class="dd" id="dd" style="top:${r.bottom + 8}px;${alignRight ? 'right:' + Math.max(10, window.innerWidth - r.right) + 'px' : 'left:' + r.left + 'px'};min-width:${Math.max(r.width, 320)}px;max-width:760px">${html}</div>`
  }
  function accMenu (anchor) {
    const vis = visible('new')
    let h = `<div class="lbl" style="padding:6px 14px">${esc(T('switchAccount'))}</div>`
    vis.forEach(a => {
      const b = st.s0[a.filename]
      h += `<div class="it ${a.filename === st.sel ? 'on' : ''}" data-act="pickAcc" data-f="${esc(a.filename)}">${avatar(accLabel(a))}<div style="flex:1;min-width:0"><div style="font-weight:700;font-size:19px" class="wrap">${esc(accLabel(a))}</div>
        <div class="${a.evm ? 'mono' : 'lockline'}" style="font-size:15px">${a.evm ? esc(a.evm) : '🔒 ' + esc(T('locked'))}</div></div>
        <div style="font-weight:700;white-space:nowrap">${b && b.nativeWei != null ? esc(fmtWei(b.nativeWei, 3)) + ' SCDO' : ''}</div></div>`
    })
    if (!vis.length) h += `<div class="it muted">${esc(T('noAccount'))}</div>`
    h += `<div class="sep"></div><div class="it" data-act="create">＋ ${esc(T('createTitle'))}</div><div class="it" data-act="import">⤓ ${esc(T('importAccount'))}</div><div class="it" data-act="tab" data-v="new">⚙ ${esc(T('manageAccounts'))}</div>`
    openDd(anchor, h)
  }
  function netMenu (anchor) {
    const h = `<div class="lbl" style="padding:6px 14px">${esc(T('netPick'))}</div>
      <div class="it ${ui.net !== 'old' ? 'on' : ''}" data-act="pickNet" data-v="new" id="net-new" title="${esc(st.net.s0Ok ? T('netBlock', { n: st.net.s0Block }) : st.net.s0Ok === false ? T('netDown') : '')}"><span class="dot ${st.net.s0Ok == null ? '' : st.net.s0Ok ? 'ok' : 'bad'}"></span><div style="flex:1"><div style="font-weight:700">${esc(T('netNewLong'))}</div><div class="lbl">${esc(T('netNewSub'))}</div></div><span class="ck">${ui.net !== 'old' ? '✓' : ''}</span></div>
      ${[1, 2, 3, 4].map(n => `<div class="it ${ui.net === 'old' && ui.shard === n ? 'on' : ''}" data-act="pickNet" data-v="old" data-shard="${n}" id="net-s${n}" title="${esc(st.net.oldOk === false ? T('netDown') : '')}"><span class="dot ${st.net.oldOk == null ? '' : st.net.oldOk ? 'ok' : 'bad'}"></span><div style="flex:1"><div style="font-weight:700">${esc(T('netOldLong', { n }))}</div><div class="lbl">${esc(T('netOldSub', { n }))}</div></div><span class="ck">${ui.net === 'old' && ui.shard === n ? '✓' : ''}</span></div>`).join('')}`
    openDd(anchor, h, true)
  }

  // ---------------- modals ----------------
  function modal (html, opts) {
    opts = opts || {}
    $('modalRoot').innerHTML = `<div class="overlay" id="ov"><div class="modal" id="md" style="${opts.width ? 'width:' + opts.width + 'px' : ''}">${html}</div></div>`
    const first = $('md').querySelector('input:not([type=checkbox]):not([disabled])'); if (first && !opts.noFocus) setTimeout(() => first.focus(), 30)
  }
  function closeModal () { $('modalRoot').innerHTML = ''; render() }
  function confirmBox (title, text, yes, no, danger) {
    return new Promise(resolve => {
      modal(`<div class="mh"><h2>${esc(title)}</h2></div><div style="font-size:20px">${esc(text)}</div>
        <div class="foot"><button class="btn ghost" id="cbNo">${esc(no || T('cancel'))}</button><button class="btn ${danger ? 'dan' : 'pri'}" id="cbYes">${esc(yes || T('yes'))}</button></div>`, { width: 600 })
      $('cbNo').onclick = () => { $('modalRoot').innerHTML = ''; resolve(false) }
      $('cbYes').onclick = () => { $('modalRoot').innerHTML = ''; resolve(true) }
    })
  }

  function receiveModal (f, chain) {
    const a = accByFile(f); if (!a) return
    const addr = chain === 'old' ? a.pubkey : a.evm
    if (!addr) return
    modal(`<div class="mh">${avatar(accLabel(a))}<h2>${esc(T('receiveTitle'))}</h2><button class="btn ghost small" data-act="closeModal">✕</button></div>
      <div style="font-size:20px;font-weight:700" class="wrap">${esc(accLabel(a))}</div>
      <div class="lbl">${esc(chain === 'old' ? T('oldAddrLabel', { n: a.shard }) : T('newAddrLabel'))}</div>
      <div class="qrwrap"><div id="qrBox"></div></div>
      <div class="addrbox mono" id="rcvAddr">${esc(addr)}</div>
      <div class="infobox">${esc(chain === 'old' ? T('receiveOld', { n: a.shard }) : T('receiveNew'))}</div>
      <div class="foot"><button class="btn sec" data-act="copy" data-v="${esc(addr)}">⧉ ${esc(T('copyAddress'))}</button><button class="btn pri" data-act="closeModal">${esc(T('done'))}</button></div>`, { width: 640 })
    try { new window.QRCode($('qrBox'), { text: addr, width: 220, height: 220, correctLevel: window.QRCode.CorrectLevel.M }) } catch (e) { console.error(e) } // eslint-disable-line no-new
  }

  // ----- send (shard0), stepped: address -> amount (Max) -> review (fee, password) -> status -----
  function stepsHtml (i) {
    const names = [T('stepAddr'), T('stepAmount'), T('stepReview'), T('stepResult')]
    return `<div class="steps">${names.map((n, k) => (k === i ? `<b>${k + 1}. ${esc(n)}</b>` : `<span>${k + 1}. ${esc(n)}</span>`)).join('<span>→</span>')}</div>`
  }
  function sendModal (f) {
    const a = accByFile(f); if (!a || !a.evm) return
    const s = { asset: 'SCDO', to: '', amount: '', fee: null }
    const bal = () => { const b = st.s0[a.filename] || {}; if (s.asset === 'SCDO') return { wei: b.nativeWei, dec: 18 }; const t = (b.tokens || []).find(x => x.symbol === s.asset); return { raw: t && t.raw, dec: t ? t.decimals : 18, t } }
    const balText = () => { const b = bal(); if (s.asset === 'SCDO') return b.wei != null ? fmtWei(b.wei) + ' SCDO' : '…'; return b.t && b.t.balance != null ? fmtNum(b.t.balance, b.dec) + ' ' + s.asset : '…' }
    const head = (i) => `<div class="mh"><h2>${esc(T('sendTitle'))}</h2>${stepsHtml(i)}</div>`
    const fromLine = `<div class="infobox"><div class="lbl">${esc(T('from'))}</div><b class="wrap">${esc(accLabel(a))}</b><div class="mono">${esc(a.evm)}</div></div>`
    function step1 () {
      modal(`${head(0)}${fromLine}
        <div class="field"><div class="lbl">${esc(T('asset'))}</div>${assetPickerHtml(a, s.asset)}</div>
        <div class="field"><div class="lbl">${esc(T('to'))}</div><input class="inp mono" id="sTo" placeholder="${esc(T('toPh'))}" value="${esc(s.to)}"></div>
        <div class="err" id="sErr"></div>
        <div class="foot"><button class="btn ghost" data-act="closeModal">${esc(T('cancel'))}</button><button class="btn pri" id="sNext">${esc(T('next'))}</button></div>`)
      wireAssetPicker(a, () => s.asset, (v) => { s.to = $('sTo').value.trim(); s.asset = v; s.amount = ''; s.fee = null; step1() })
      const go = () => {
        const to = $('sTo').value.trim()
        if (/^[1-4]S[0-9a-fA-F]{40}$/.test(to)) { $('sErr').textContent = T('errOldAddrToNew'); return }
        if (!Shard0.isAddress(to)) { $('sErr').textContent = T('errAddr'); return }
        if (to.toLowerCase() === a.evm.toLowerCase()) { $('sErr').textContent = T('errSelf'); return }
        s.to = ethers.getAddress(to); step2()
      }
      $('sNext').onclick = go; $('sTo').onkeydown = (e) => { if (e.key === 'Enter') go() }
    }
    async function estimate () {
      try { s.fee = await shard0().estimateSend(a.evm, s.to, s.amount && Number(s.amount) > 0 ? s.amount : '0', s.asset) } catch (e) { s.fee = null }
      return s.fee
    }
    function feeText () { return s.fee ? T('feeAbout', { v: fmtWei(s.fee.estFeeWei, 8) }) + PU.l() + T('feeMax', { v: fmtWei(s.fee.maxFeeWei, 8) }) + PU.r() : '…' }
    function step2 () {
      modal(`${head(1)}<div class="infobox"><div class="lbl">${esc(T('to'))}</div><div class="mono" style="font-size:19px">${esc(s.to)}</div></div>
        <div class="field"><div class="lbl">${esc(T('asset'))}</div>${assetPickerHtml(a, s.asset)}</div>
        <div class="field"><div class="row"><div class="lbl" style="flex:1">${esc(T('amount'))}${PU.l()}${esc(s.asset)}${PU.r()}</div><div class="lbl">${esc(T('available', { v: balText() }))}</div></div>
        <div class="row"><input class="inp" id="sAmt" inputmode="decimal" placeholder="0.0" value="${esc(s.amount)}" style="font-size:28px;height:62px"><button class="btn sec" id="sMax" style="height:62px">${esc(T('max'))}</button></div></div>
        <div class="field"><div class="lbl">${esc(T('fee'))}</div><div id="sFee" style="font-size:19px">${esc(feeText())}</div></div>
        <div class="err" id="sErr"></div>
        <div class="foot"><button class="btn ghost" id="sBack">${esc(T('back'))}</button><button class="btn pri" id="sNext">${esc(T('next'))}</button></div>`)
      estimate().then(() => { const e = $('sFee'); if (e) e.textContent = feeText() })
      wireAssetPicker(a, () => s.asset, (v) => { s.asset = v; s.amount = ''; s.fee = null; step2() })
      $('sBack').onclick = () => { s.amount = $('sAmt').value.trim(); step1() }
      $('sMax').onclick = async () => {
        const b = bal()
        if (s.asset === 'SCDO') {
          if (b.wei == null) return
          const fee = (await estimate()) || { maxFeeWei: 0n }
          let v = b.wei - fee.maxFeeWei; if (v < 0n) v = 0n
          $('sAmt').value = ethers.formatEther(v)
        } else if (b.raw != null) $('sAmt').value = ethers.formatUnits(b.raw, b.dec)
        const e = $('sFee'); if (e) e.textContent = feeText()
      }
      const go = async () => {
        const v = $('sAmt').value.trim().replace(/,/g, '')
        const b = bal()
        let amt
        try { if (!/^\d+(\.\d+)?$/.test(v)) throw new Error('x'); amt = ethers.parseUnits(v, b.dec); if (amt <= 0n) throw new Error('x') } catch (e) { $('sErr').textContent = T('errAmount'); return }
        s.amount = v
        const fee = (await estimate()) || { maxFeeWei: 0n }
        const scdoWei = (st.s0[a.filename] || {}).nativeWei
        if (s.asset === 'SCDO') { if (scdoWei != null && amt + fee.maxFeeWei > scdoWei) { $('sErr').textContent = T('errTooMuch'); return } } else {
          if (b.raw != null && amt > b.raw) { $('sErr').textContent = T('errTooMuch'); return }
          if (scdoWei != null && fee.maxFeeWei > scdoWei) { $('sErr').textContent = T('errNoFeeBal'); return }
        }
        step3()
      }
      $('sNext').onclick = go; $('sAmt').onkeydown = (e) => { if (e.key === 'Enter') go() }
    }
    function step3 () {
      const total = s.asset === 'SCDO' && s.fee ? fmtNum(ethers.formatEther(ethers.parseEther(s.amount) + s.fee.estFeeWei), 8) + ' SCDO' : null
      modal(`${head(2)}<div class="review">
        <div class="r"><div class="k">${esc(T('from'))}</div><div class="v"><div class="wrap">${esc(accLabel(a))}</div><div class="mono" style="font-weight:400;font-size:17px">${esc(a.evm)}</div></div></div>
        <div class="r"><div class="k">${esc(T('to'))}</div><div class="v mono" style="font-size:19px">${esc(s.to)}</div></div>
        <div class="r"><div class="k">${esc(T('amount'))}</div><div class="v" style="font-size:28px;color:#2933ff">${esc(fmtNum(s.amount, 18))} ${esc(s.asset)}</div></div>
        <div class="r"><div class="k">${esc(T('fee'))}</div><div class="v" style="font-weight:400">${esc(feeText())}</div></div>
        ${total ? `<div class="r"><div class="k">${esc(T('total'))}</div><div class="v">${esc(total)}</div></div>` : ''}</div>
        <div class="infobox">⚠ ${esc(T('reviewNote'))}</div>
        <div class="field"><div class="lbl">${esc(T('password'))}</div><input class="inp" type="password" id="sPw"></div>
        <div class="err" id="sErr"></div>
        <div class="foot"><button class="btn ghost" id="sBack">${esc(T('back'))}</button><button class="btn pri" id="sGo">${esc(T('confirmSend'))}</button></div>`)
      $('sBack').onclick = step2
      const go = async () => {
        const pw = $('sPw').value; if (!pw) { $('sErr').textContent = T('errPw'); return }
        $('sGo').disabled = true; $('sBack').disabled = true; $('sErr').innerHTML = `<span class="spin"></span> ${esc(T('sending'))}`
        let priv
        try { priv = await client.decKeyFile(a.filename, pw) } catch (e) { $('sErr').textContent = T('wrongPw'); $('sGo').disabled = false; $('sBack').disabled = false; return }
        $('sPw').value = ''
        try {
          const r = await shard0().send(priv, s.to, s.amount, s.asset)
          priv = null
          s0txAdd({ t: Date.now(), from: a.evm, to: s.to, amount: s.amount, asset: s.asset, hash: r.hash, status: 'pending' })
          step4(r.hash)
        } catch (e) { priv = null; $('sErr').textContent = String(e.shortMessage || e.message || e); $('sGo').disabled = false; $('sBack').disabled = false }
      }
      $('sGo').onclick = go; $('sPw').onkeydown = (e) => { if (e.key === 'Enter') go() }
    }
    function step4 (hash) {
      modal(`${head(3)}<div class="statusbar warn" id="sStat" style="font-size:24px"><span class="spin"></span> ${esc(T('waiting'))}</div>
        <div class="field"><div class="lbl">${esc(T('txHash'))}</div><div class="mono" style="font-size:17px">${esc(hash)}</div></div>
        <div style="margin-top:10px"><button class="link" data-act="openTx" data-v="${esc(hash)}">${esc(T('openExplorer'))} →</button></div>
        <div class="foot"><button class="btn pri" data-act="closeModal">${esc(T('done'))}</button></div>`, { noFocus: true })
      shard0().waitReceipt(hash, 240000).then(rc => {
        const ok = rc && rc.status === 1
        s0txUpdate(hash, { status: ok ? 'done' : 'fail', block: rc && rc.blockNumber })
        const e = $('sStat'); if (e) { e.className = 'statusbar ' + (ok ? 'good' : 'bad'); e.textContent = ok ? '✅ ' + T('confirmed', { n: rc.blockNumber }) : '❌ ' + T('failed') }
        refreshS0()
      }).catch(() => {})
    }
    step1()
  }

  // ----- send on a Classic shard (same shard only), same stepped pattern -----
  function sendOldModal (f) {
    const a = accByFile(f); if (!a) return
    const s = { to: '', amount: '', gas: null, price: 1 }
    const head = (i) => `<div class="mh"><h2>${esc(T('sendOldTitle', { n: a.shard }))}</h2>${stepsHtml(i)}</div>`
    const balV = () => st.old[a.pubkey]
    const feeScdo = () => s.gas == null ? null : s.gas * s.price / 1e8
    const feeLine = () => feeScdo() == null ? '…' : T('feeAbout', { v: fmtNum(feeScdo(), 8) })
    function step1 () {
      modal(`${head(0)}<div class="infobox"><div class="lbl">${esc(T('from'))}</div><b class="wrap">${esc(accLabel(a))}</b><div class="mono">${esc(a.pubkey)}</div></div>
        <div class="field"><div class="lbl">${esc(T('to'))}</div><input class="inp mono" id="sTo" placeholder="${esc(T('toPhOld', { n: a.shard }))}" value="${esc(s.to)}"></div>
        <div class="err" id="sErr"></div>
        <div class="foot"><button class="btn ghost" data-act="closeModal">${esc(T('cancel'))}</button><button class="btn pri" id="sNext">${esc(T('next'))}</button></div>`)
      const go = () => {
        const to = $('sTo').value.trim()
        if (!/^[1-4]S[0-9a-fA-F]{40}$/.test(to)) { $('sErr').textContent = T('errAddrOld'); return }
        if (String(to[0]) !== String(a.shard) && !(client.config && client.config.allowCrossShard)) { $('sErr').textContent = T('errCross', { n: a.shard }); return }
        if (to.toLowerCase() === a.pubkey.toLowerCase()) { $('sErr').textContent = T('errSelf'); return }
        s.to = to
        try { client.estimateGas(a.pubkey, to, '', (info, err) => { if (!err && info) s.gas = Number(info); const e = $('sFee'); if (e) e.textContent = feeLine() }) } catch (e) {}
        step2()
      }
      $('sNext').onclick = go; $('sTo').onkeydown = (e) => { if (e.key === 'Enter') go() }
    }
    function step2 () {
      const b = balV()
      modal(`${head(1)}<div class="infobox"><div class="lbl">${esc(T('to'))}</div><div class="mono">${esc(s.to)}</div></div>
        <div class="field"><div class="row"><div class="lbl" style="flex:1">${esc(T('amount'))}${PU.l()}SCDO${PU.r()}</div><div class="lbl">${esc(T('available', { v: b == null ? '…' : fmtNum(b) + ' SCDO' }))}</div></div>
        <div class="row"><input class="inp" id="sAmt" inputmode="decimal" placeholder="0.0" value="${esc(s.amount)}" style="font-size:28px;height:62px"><button class="btn sec" id="sMax" style="height:62px">${esc(T('max'))}</button></div></div>
        <div class="field"><div class="lbl">${esc(T('fee'))}</div><div id="sFee" style="font-size:19px">${esc(feeLine())}</div></div>
        <div class="err" id="sErr"></div>
        <div class="foot"><button class="btn ghost" id="sBack">${esc(T('back'))}</button><button class="btn pri" id="sNext">${esc(T('next'))}</button></div>`)
      $('sBack').onclick = () => { s.amount = $('sAmt').value.trim(); step1() }
      $('sMax').onclick = () => { const bb = balV(); if (bb == null) return; const v = Math.max(0, bb - (feeScdo() || 0.00021)); $('sAmt').value = String(Math.floor(v * 1e8) / 1e8) }
      const go = () => {
        const v = $('sAmt').value.trim().replace(/,/g, '')
        if (!/^\d+(\.\d{1,8})?$/.test(v) || Number(v) <= 0) { $('sErr').textContent = T('errAmount'); return }
        const bb = balV(); if (bb != null && Number(v) + (feeScdo() || 0) > bb) { $('sErr').textContent = T('errTooMuch'); return }
        s.amount = v; step3()
      }
      $('sNext').onclick = go; $('sAmt').onkeydown = (e) => { if (e.key === 'Enter') go() }
    }
    function step3 () {
      modal(`${head(2)}<div class="review">
        <div class="r"><div class="k">${esc(T('from'))}</div><div class="v"><div class="wrap">${esc(accLabel(a))}</div><div class="mono" style="font-weight:400;font-size:17px">${esc(a.pubkey)}</div></div></div>
        <div class="r"><div class="k">${esc(T('to'))}</div><div class="v mono" style="font-size:19px">${esc(s.to)}</div></div>
        <div class="r"><div class="k">${esc(T('amount'))}</div><div class="v" style="font-size:28px;color:#2933ff">${esc(fmtNum(s.amount, 8))} SCDO</div></div>
        <div class="r"><div class="k">${esc(T('fee'))}</div><div class="v" style="font-weight:400">${esc(feeLine())}</div></div></div>
        <div class="infobox">⚠ ${esc(T('reviewNote'))}</div>
        <div class="field"><div class="lbl">${esc(T('password'))}</div><input class="inp" type="password" id="sPw"></div>
        <div class="err" id="sErr"></div>
        <div class="foot"><button class="btn ghost" id="sBack">${esc(T('back'))}</button><button class="btn pri" id="sGo">${esc(T('confirmSend'))}</button></div>`)
      $('sBack').onclick = step2
      const go = () => {
        const pw = $('sPw').value; if (!pw) { $('sErr').textContent = T('errPw'); return }
        $('sGo').disabled = true; $('sErr').innerHTML = `<span class="spin"></span> ${esc(T('sending'))}`
        const accStr = JSON.stringify({ pubkey: a.pubkey, shard: a.shard, filename: a.filename.split(' ').join('[sPaCe]') })
        client.sendtx(accStr, pw, s.to, s.amount, s.price, s.gas || 21000, '', (result, err, hash, txRecord) => {
          if (err) { const em = String((err && err.message) || err); $('sErr').textContent = /decrypt|passphrase/i.test(em) ? T('wrongPw') : em; $('sGo').disabled = false; return }
          try { if (txRecord) client.saveRecord(txRecord) } catch (e) {}
          modal(`${head(3)}<div class="statusbar good" style="font-size:22px">✅ ${esc(T('sentOld'))}</div>
            <div class="field"><div class="lbl">${esc(T('txHash'))}</div><div class="mono" style="font-size:17px">${esc(hash)}</div></div>
            <div class="foot"><button class="btn pri" data-act="closeModal">${esc(T('done'))}</button></div>`, { noFocus: true })
        })
        $('sPw').value = ''
      }
      $('sGo').onclick = go; $('sPw').onkeydown = (e) => { if (e.key === 'Enter') go() }
    }
    step1()
  }

  // ----- create / import -----
  function createModal () {
    modal(`<div class="mh"><h2>${esc(T('createTitle'))}</h2></div>
      <div class="field"><div class="lbl">${esc(T('accName'))}</div><input class="inp" id="cName" maxlength="40" placeholder="${esc(T('accountN', { n: nextNo() }))}"></div>
      <div class="field"><div class="lbl">${esc(T('pw1'))}</div><input class="inp" type="password" id="cPw1"></div>
      <div class="field"><div class="lbl">${esc(T('pw2'))}</div><input class="inp" type="password" id="cPw2"><div class="lbl" style="margin-top:6px">${esc(T('pwRule'))}</div></div>
      <details style="margin-top:14px"><summary style="font-size:18px;cursor:pointer;color:#3d4160">${esc(T('advanced'))}</summary>
        <div class="field"><div class="lbl">${esc(T('createShard'))}</div><input class="inp" id="cShard" value="1" style="width:120px"></div>
        <div class="field"><div class="lbl">${esc(T('createPriv'))}</div><input class="inp mono" id="cPriv" type="password" placeholder="0x…" autocomplete="off"></div></details>
      <div class="infobox">${esc(T('createSave'))}</div>
      <div class="err" id="cErr"></div>
      <div class="foot"><button class="btn ghost" data-act="closeModal">${esc(T('cancel'))}</button><button class="btn pri" id="cGo">${esc(T('create'))}</button></div>`)
    $('cGo').onclick = async () => {
      const name = $('cName').value.trim(); const pw = $('cPw1').value; const pw2 = $('cPw2').value
      const shard = ($('cShard').value.trim() || '1'); let priv = $('cPriv').value.trim()
      const errs = []
      if (name.length > 40 || /[\\/:*?"<>|\u0000-\u001f]/.test(name)) errs.push(T('errName'))
      if (!/(?=.*[0-9])(?=.*[A-Z])(?=.*[a-z])(?=.*[^a-zA-Z0-9]).{8,15}/.test(pw)) errs.push(T('pwRule'))
      if (pw !== pw2) errs.push(T('pwMismatch'))
      if (!/^[1-4]$/.test(shard)) errs.push(T('errShard'))
      if (priv) { if (/^[0-9a-fA-F]{64}$/.test(priv)) priv = '0x' + priv; priv = priv.toLowerCase(); if (!/^0x[0-9a-f]{64}$/.test(priv)) errs.push(T('errKey')) }
      if (errs.length) { $('cErr').textContent = errs.join(PU.bar()); return }
      try {
        if (!priv) priv = client.keyTool.generateKeys(shard).privatekey
        else { const addr = client.getAddressFromPriKey(priv, shard); if (st.accounts.some(x => x.pubkey === addr)) { $('cErr').textContent = T('errExist'); return } }
      } catch (e) { $('cErr').textContent = T('errKey'); return }
      $('cGo').disabled = true; $('cErr').innerHTML = '<span class="spin"></span>'
      const no = name ? 0 : nextNo()
      const file = (name || 'account' + no) + '.' + Date.now()
      try {
        await client.keyStore(file, priv, pw, shard)
        if (name) ui.names[file] = name; else ui.accNo[file] = no
        saveUi()
        client.rememberEvmAddress(file, priv)
        priv = null
        st.sel = file; localStorage.setItem('selAcc112', file)
        closeModal(); toast(T('createOk')); refreshS0(); refreshOld()
      } catch (e) { $('cErr').textContent = String(e.message || e); $('cGo').disabled = false }
    }
  }
  function renameModal (f) {
    const a = accByFile(f); if (!a) return
    modal(`<div class="mh">${avatar(accLabel(a))}<h2>${esc(T('renameTitle'))}</h2></div>
      <div class="field"><div class="lbl">${esc(T('accName'))}</div><input class="inp" id="rnName" maxlength="40" value="${esc(accLabel(a))}"></div>
      <div class="lbl">${esc(T('renameNote'))}</div>
      <div class="err" id="rnErr"></div>
      <div class="foot"><button class="btn ghost" data-act="closeModal">${esc(T('cancel'))}</button><button class="btn pri" id="rnGo">${esc(T('save'))}</button></div>`)
    const go = () => {
      const v = $('rnName').value.trim()
      if (v.length > 40 || /[\u0000-\u001f<>]/.test(v)) { $('rnErr').textContent = T('errName'); return }
      if (v && !(ui.accNo[f] && v === T('accountN', { n: ui.accNo[f] }))) ui.names[f] = v
      else { delete ui.names[f]; if (needsNo(f)) { if (!ui.accNo[f]) ui.accNo[f] = nextNo() } else delete ui.accNo[f] } // empty = default: file name, or 账户 N for unnamed files
      saveUi(); closeModal(); toast(T('renameOk')); render()
    }
    $('rnGo').onclick = go; $('rnName').onkeydown = (e) => { if (e.key === 'Enter') go() }
    setTimeout(() => { const i = $('rnName'); if (i) { i.focus(); i.select() } }, 30)
  }
  function useOtherAddr (id) {
    const inp = $(id + '-in'); const raw = inp ? inp.value.trim() : ''
    let addr = ''
    try { addr = require('ethers').getAddress(raw) } catch (e) { addr = '' }
    if (!addr || /^0x0{40}$/.test(addr)) { toast(T('errRewardAddr'), 5000); return }
    if (!ui.rewardExtra.some(x => x.toLowerCase() === addr.toLowerCase())) ui.rewardExtra.push(addr)
    saveUi()
    localStorage.setItem(id === 'mReward' ? 'minerReward' : 'nodePayout', addr)
    if (st.otherOpen) st.otherOpen[id] = false
    toast('✔ ' + addr); render()
  }
  async function importKeyfiles () {
    const r = await ipcRenderer.invoke('dialog:open', { properties: ['openFile', 'multiSelections'] })
    if (!r || r.canceled) return
    loadAccounts()
    for (const src of r.filePaths) {
      const name = path.basename(src)
      const pub = client.keyfileisvalid(src)
      if (!pub) { toast(T('importFail', { n: name }), 6000); continue }
      if (st.accounts.some(x => x.filename === name)) { toast(T('errNameExist') + PU.c() + name, 6000); continue }
      if (st.accounts.some(x => x.pubkey === pub)) { toast(T('errExist') + PU.c() + name, 6000); continue }
      try { fs.copyFileSync(src, path.join(client.accountPath, name), fs.constants.COPYFILE_EXCL); toast(T('importOk', { n: name })) } catch (e) { toast(String(e.message || e), 6000) }
      loadAccounts()
    }
    render(); refreshOld()
  }

  async function unlock (f, inputId) {
    const inp = $(inputId); const pw = inp ? inp.value : ''
    if (!pw) { toast(T('errPw')); return }
    toast('…', 20000)
    try { await client.decKeyFile(f, pw); if (inp) inp.value = ''; toast('✔'); loadAccounts(); render(); refreshS0() } catch (e) { toast(T('wrongPw')) }
  }

  function setHidden (chain, f, hide) {
    const l = ui.hidden[chain]
    if (hide && !l.includes(f)) l.push(f)
    if (!hide) ui.hidden[chain] = l.filter(x => x !== f)
    saveUi(); toast(hide ? T('hideOk') : T('unhideOk')); render()
  }

  // ----- delete: password + "I understand" + final confirm; keyfile is backed up and verified first -----
  async function deleteModal (f) {
    const a = accByFile(f); if (!a) return
    const paths = await ipcRenderer.invoke('keyfile:paths')
    const s0b = st.s0[a.filename]; const oldb = st.old[a.pubkey]
    const nonZero = (s0b && s0b.nativeWei != null && s0b.nativeWei > 0n) || (s0b && (s0b.tokens || []).some(t => t.raw != null && t.raw > 0n)) || (oldb != null && oldb > 0)
    const balLine = `${esc(T('newChainShort'))}${PU.c()}${s0b && s0b.nativeWei != null ? esc(fmtWei(s0b.nativeWei)) + ' SCDO' : '?'}${PU.bar()}${esc(T('oldChainShort'))}${PU.c()}${oldb != null ? esc(fmtNum(oldb)) + ' SCDO' : '?'}`
    modal(`<div class="mh"><h2 style="color:#c62828">${esc(T('delTitle'))}</h2></div>
      <div class="infobox"><div style="font-size:21px;font-weight:700" class="wrap">${esc(accLabel(a))}</div>
        <div class="lbl">${esc(T('newAddrLabel'))}</div><div class="mono">${a.evm ? esc(a.evm) : '🔒 ' + esc(T('locked'))}</div>
        <div class="lbl">${esc(T('oldAddrLabel', { n: a.shard }))}</div><div class="mono">${esc(a.pubkey)}</div>
        <div style="margin-top:8px;font-size:18px">${balLine}</div></div>
      ${nonZero ? `<div class="warnbox" style="background:#fdecec;border-color:#e53935;color:#b71c1c;font-weight:700">⚠ ${esc(T('delHasBal'))}</div>` : ''}
      <div class="warnbox">${esc(T('delWarn'))}</div>
      <div class="infobox">${esc(T('delBackup'))}<div class="mono" style="font-size:16px">${esc(paths.today)}</div></div>
      <div class="field"><div class="lbl">${esc(T('delPw'))}</div><input class="inp" type="password" id="dPw"></div>
      <label class="chk" style="display:flex;gap:10px;align-items:center;font-size:20px;margin-top:14px;cursor:pointer"><input type="checkbox" id="dChk" style="width:24px;height:24px"> ${esc(T('delAgree'))}</label>
      <div class="err" id="dErr"></div>
      <div class="foot"><button class="btn ghost" data-act="closeModal">${esc(T('cancel'))}</button><button class="btn dan" id="dNext" disabled>${esc(T('next'))}</button></div>`, { width: 760 })
    const upd = () => { $('dNext').disabled = !($('dPw').value && $('dChk').checked) }
    $('dPw').oninput = upd; $('dChk').onchange = upd
    $('dNext').onclick = async () => {
      const pw = $('dPw').value
      $('dNext').disabled = true; $('dErr').innerHTML = `<span class="spin"></span> ${esc(T('delChecking'))}`
      try { await client.decKeyFile(a.filename, pw) } catch (e) { $('dErr').textContent = T('wrongPw'); upd(); return }
      $('dPw').value = ''
      loadAccounts(); const a2 = accByFile(f) || a
      // fresh balances on both chains before the final confirm
      let fresh0 = null; let freshOld = null
      try { if (a2.evm) fresh0 = await Promise.race([shard0().balances(a2.evm), new Promise((resolve, reject) => setTimeout(() => reject(new Error('timeout')), 15000))]) } catch (e) {}
      try {
        freshOld = await new Promise(resolve => { const tm = setTimeout(() => resolve(null), 15000); client.getBalance(a2, (info, err) => { clearTimeout(tm); resolve(err || !info ? null : Number(info.Balance) / 1e8) }) })
      } catch (e) {}
      if (fresh0) st.s0[a2.filename] = fresh0
      if (freshOld != null) st.old[a2.pubkey] = freshOld
      const has = (fresh0 && (fresh0.nativeWei > 0n || fresh0.tokens.some(t => t.raw != null && t.raw > 0n))) || (freshOld != null && freshOld > 0)
      const tokLine = fresh0 ? fresh0.tokens.filter(t => t.raw != null && t.raw > 0n).map(t => fmtNum(t.balance) + ' ' + t.symbol).join(PU.com()) : ''
      modal(`<div class="mh"><h2 style="color:#c62828">${esc(T('delConfirmTitle'))}</h2></div>
        <div style="font-size:21px" class="wrap">${esc(T('delConfirmText', { n: accLabel(a2) }))}</div>
        <div class="infobox" style="font-size:19px">${esc(T('newChainShort'))}${PU.c()}${fresh0 ? esc(fmtWei(fresh0.nativeWei)) + ' SCDO' + (tokLine ? PU.com() + esc(tokLine) : '') : '? (' + esc(T('balUnknown')) + ')'}<br>${esc(T('oldChainShort'))}${PU.c()}${freshOld != null ? esc(fmtNum(freshOld)) + ' SCDO' : '? (' + esc(T('balUnknown')) + ')'}</div>
        ${has ? `<div class="warnbox" style="background:#fdecec;border-color:#e53935;color:#b71c1c;font-weight:700;font-size:20px">⚠ ${esc(T('delHasBal'))}</div>` : ''}
        <div class="infobox">${esc(T('delBackup'))}<div class="mono" style="font-size:16px">${esc(paths.today)}</div></div>
        <div class="err" id="dErr"></div>
        <div class="foot"><button class="btn ghost" data-act="closeModal">${esc(T('cancel'))}</button><button class="btn dan" id="dGo">${esc(T('delConfirmBtn'))}</button></div>`, { width: 760, noFocus: true })
      $('dGo').onclick = async () => {
        $('dGo').disabled = true; $('dErr').innerHTML = `<span class="spin"></span> ${esc(T('delBacking'))}`
        const r = await ipcRenderer.invoke('keyfile:backupDelete', a2.filename)
        if (!r || !r.ok) {
          $('dErr').textContent = r && r.stage === 'delete' ? T('delFailDelete', { p: r.backup || '', e: r.error || '' }) : T('delFailBackup', { e: (r && r.error) || '?' })
          return
        }
        ui.hidden.new = ui.hidden.new.filter(x => x !== a2.filename); ui.hidden.old = ui.hidden.old.filter(x => x !== a2.filename); saveUi()
        delete st.s0[a2.filename]
        if (st.sel === a2.filename) { st.sel = ''; localStorage.setItem('selAcc112', '') }
        $('modalRoot').innerHTML = ''
        modal(`<div class="mh"><h2>✅ ${esc(T('delDone'))}</h2></div><div style="font-size:19px">${esc(T('delDoneText'))}</div>
          <div class="addrbox mono" style="font-size:16px">${esc(r.backup)}</div>
          <div class="foot"><button class="btn sec" data-act="openBackups">${esc(T('openBackups'))}</button><button class="btn pri" data-act="closeModal">${esc(T('done'))}</button></div>`, { width: 760, noFocus: true })
      }
    }
  }

  // ----- settings (gear): language, accounts, backup/export, advanced, about -----
  async function settingsModal () {
    const paths = await ipcRenderer.invoke('keyfile:paths')
    const nHid = new Set(ui.hidden.new.concat(ui.hidden.old)).size
    const cfg = client.config || {}
    const rpcs = (cfg.connect || []).map((u, i) => `<div class="row" style="font-size:16px"><b style="width:120px">${i === 0 ? esc(T('netNewShort')) : esc(T('shardN', { n: i }))}</b><span class="mono">${esc(u)}</span></div>`).join('')
    modal(`<div class="mh"><h2>⚙ ${esc(T('settings'))}</h2><button class="btn ghost small" data-act="closeModal">✕</button></div>
      <div class="setsec"><div class="sh">${esc(T('language'))}</div><div class="seg"><button class="${lang() === 'CN' ? 'on' : ''}" data-act="lang" data-v="CN">中文</button><button class="${lang() === 'EN' ? 'on' : ''}" data-act="lang" data-v="EN">English</button></div></div>
      <div class="setsec"><div class="sh">${esc(T('accounts'))}</div><div class="row" style="flex-wrap:wrap">
        <button class="btn ghost" data-act="toggleHidden">${esc(ui.showHidden ? T('hideHidden') : T('showHidden', { n: nHid }))}</button>
        <button class="btn ghost" data-act="create">＋ ${esc(T('createTitle'))}</button><button class="btn ghost" data-act="import">⤓ ${esc(T('importAccount'))}</button></div></div>
      <div class="setsec"><div class="sh">${esc(T('backupExport'))}</div><div class="lbl">${esc(T('backupHint'))}</div><div class="row" style="flex-wrap:wrap;margin-top:8px">
        <button class="btn ghost" data-act="backupPick">${esc(T('backupKeyfile'))}</button><button class="btn ghost" data-act="openBackups">${esc(T('openBackups'))}</button></div>
        <div class="lbl" style="margin-top:8px">${esc(T('keyfileDir'))}${PU.c()}<span class="mono">${esc(paths.keyfileDir)}</span></div>
        <div class="lbl">${esc(T('backupDir'))}${PU.c()}<span class="mono">${esc(paths.backupRoot)}</span></div></div>
      <details class="setsec"><summary class="sh" style="cursor:pointer">${esc(T('advanced'))}</summary><div class="lbl">${esc(T('rpcList'))}</div>${rpcs}
        <div class="lbl" style="margin-top:6px">${esc(T('rpcHint'))}</div></details>
      <div class="setsec"><div class="sh">${esc(T('about'))}</div><div style="font-size:18px">ScdoWalletBeta ${esc(APPVER)} · 2026-09-29</div><div class="lbl">${esc(T('changes'))}</div></div>`, { width: 820, noFocus: true })
  }
  function backupPickModal () {
    const l = st.accounts
    modal(`<div class="mh"><h2>${esc(T('backupKeyfile'))}</h2><button class="btn ghost small" data-act="closeModal">✕</button></div>
      ${l.map(a => `<div class="acc" style="margin:8px 0">${avatar(accLabel(a))}<div style="flex:1;min-width:0"><div class="wrap" style="font-weight:700">${esc(accLabel(a))}</div><div class="lbl" style="font-size:15px">${esc(T('keyfileName'))}${PU.c()}${esc(a.filename)}</div><div class="mono" style="font-size:15px">${esc(a.pubkey)}</div></div><button class="btn sec small" data-act="backupOne" data-f="${esc(a.filename)}">${esc(T('backupNow'))}</button></div>`).join('') || esc(T('noAccount'))}
      <div class="foot"><button class="btn pri" data-act="closeModal">${esc(T('done'))}</button></div>`, { width: 820, noFocus: true })
  }

  function setLang (l) {
    const cfg = client.config
    cfg.lang = l === 'CN' ? 'CN' : 'EN'; cfg.langChosen112 = true
    try { fs.writeFileSync(client.configpath || path.join(os.homedir(), '.ScdoWallet', 'viewconfig_1.1.json'), JSON.stringify(cfg, null, 2)) } catch (e) { console.error(e) }
    try { const lp = path.join(os.homedir(), '.ScdoWallet', 'lang.json'); const j = readJson(lp, null); if (j) { j.lang = cfg.lang; writeJson(lp, j) } } catch (e) {}
    ipcRenderer.invoke('menu:rebuild')
    const wasSettings = !!($('md') && $('md').querySelector('[data-act=lang]'))
    $('modalRoot').innerHTML = ''; render()
    if (wasSettings) settingsModal()
  }

  // ----- miner -----
  async function ensureGpu (force) {
    if (st.gpu && !force) return st.gpu
    try { st.gpu = await ipcRenderer.invoke('miner:gpu') } catch (e) { st.gpu = { nvidia: false, names: [] } }
    if (st.tab === 'mine') render()
    return st.gpu
  }
  async function mineStart () {
    const sel = $('mReward'); if (!sel || !/^0x[0-9a-fA-F]{40}$/.test(sel.value)) { toast(T('pickAddr')); return }
    const wallet = sel.value; localStorage.setItem('minerReward', wallet)
    if (process.platform === 'win32' && !localStorage.getItem('defenderAsked112')) {
      localStorage.setItem('defenderAsked112', '1')
      if (await confirmBox(T('defender'), T('defAsk'), T('yes'), T('no'))) { const r = await ipcRenderer.invoke('miner:defender'); toast(r && r.ok ? T('defenderOk') : T('defenderFail') + ' ' + ((r && r.error) || ''), 6000) }
    }
    const r = await ipcRenderer.invoke('miner:start', wallet, { mode: 'mine' })
    if (!r.ok) { if (r.code === 'NO_NVIDIA') { localStorage.setItem('minerAutoResume', '0'); await ensureGpu(true) } toast(r.code === 'NO_NVIDIA' ? T('st_NO_NVIDIA') : (r.error || r.code), 7000); return }
    localStorage.setItem('minerAutoResume', '1'); localStorage.setItem('minerMode', 'mine')
  }
  async function nodeStart () {
    const sel = $('nPayout')
    let payout = sel ? sel.value : payoutDefault()
    if (!/^0x[0-9a-fA-F]{40}$/.test(payout || '')) payout = ''
    if (payout) localStorage.setItem('nodePayout', payout)
    const r = await ipcRenderer.invoke('miner:start', '', { mode: 'node', payout: payout || undefined })
    if (!r.ok) { toast(r.error || r.code, 7000); return }
    localStorage.setItem('minerAutoResume', '1'); localStorage.setItem('minerMode', 'node')
  }
  async function minerStop () {
    localStorage.setItem('minerAutoResume', '0')
    const ext = st.miner && st.miner.phase === 'external'
    if (!ext) toast(T('stopping'), 60000)
    await ipcRenderer.invoke('miner:stop')
    if (!ext) toast(T('stopped'))
  }
  function onMinerStatus (m) {
    const prev = st.miner
    st.miner = m
    if (m && m.code === 'DEFENDER' && (!prev || prev.code !== 'DEFENDER') && process.platform === 'win32') {
      confirmBox(T('defender'), T('st_DEFENDER'), T('yes'), T('no')).then(async ok => { if (ok) { const r = await ipcRenderer.invoke('miner:defender'); toast(r && r.ok ? T('defenderOk') : T('defenderFail'), 6000); if (r && r.ok) mineStart() } })
    }
    renderMinerLive()
  }

  // ---------------- events (one delegated handler) ----------------
  document.addEventListener('click', async (ev) => {
    const el = ev.target.closest('[data-act]'); if (!el) return
    const act = el.getAttribute('data-act'); const f = el.getAttribute('data-f'); const v = el.getAttribute('data-v')
    if (act === 'ddClose') { closeDd(); return }
    if (act !== 'accMenu' && act !== 'netMenu') closeDd()
    switch (act) {
      case 'tab': if ($('md')) $('modalRoot').innerHTML = ''; setTab(v); render(); if (v === 'mine') ensureGpu(); if (v === 'old') refreshOld(); break
      case 'homeSub': st.homeSub = v; localStorage.setItem('homeSub112', v); render(); break
      case 'accMenu': if ($('dd')) closeDd(); else accMenu(el); break
      case 'netMenu': if ($('dd')) closeDd(); else netMenu(el); break
      case 'pickAcc': st.sel = f; localStorage.setItem('selAcc112', f); if (st.tab !== 'home') setTab('home'); render(); break
      case 'pickNet': setNet(v, el.getAttribute('data-shard')); render(); if (v === 'old') refreshOld(); else refreshS0(); break
      case 'pickShard': ui.shard = [0, 1, 2, 3, 4].includes(Number(v)) ? Number(v) : 0; saveUi(); render(); break
      case 'lang': setLang(v); break
      case 'settings': settingsModal(); break
      case 'copy': copyText(v); break
      case 'receive': receiveModal(f, el.getAttribute('data-chain') || 'new'); break
      case 'send': sendModal(f); break
      case 'sendOld': sendOldModal(f); break
      case 'create': createModal(); break
      case 'import': if ($('md')) $('modalRoot').innerHTML = ''; importKeyfiles(); break
      case 'unlock': unlock(f, el.getAttribute('data-in')); break
      case 'hide': setHidden(el.getAttribute('data-chain') || 'new', f, true); break
      case 'unhide': setHidden(el.getAttribute('data-chain') || 'new', f, false); break
      case 'toggleHidden': ui.showHidden = !ui.showHidden; saveUi(); if ($('md')) { $('modalRoot').innerHTML = ''; render(); settingsModal() } else render(); break
      case 'delete': deleteModal(f); break
      case 'rename': renameModal(f); break
      case 'useOtherAddr': useOtherAddr(v); break
      case 'closeModal': closeModal(); break
      case 'openTx': openExternal(shard0().explorerTx(v)); break
      case 'explorerAddr': openExternal(shard0().explorerAddress(v)); break
      case 'backupPick': backupPickModal(); break
      case 'backupOne': { const r = await ipcRenderer.invoke('keyfile:backupOnly', f); toast(r.ok ? T('backupOk', { p: r.backup }) : T('backupFail', { e: r.error }), 8000); break }
      case 'openBackups': ipcRenderer.invoke('keyfile:openBackups'); break
      case 'mineStart': mineStart(); break
      case 'nodeStart': nodeStart(); break
      case 'minerStop': minerStop(); break
      case 'toggleLog': st.logOpen = !st.logOpen; st.advOpen = true; render(); break
      case 'openLogs': ipcRenderer.invoke('miner:openLogs'); break
      case 'defender': { const r = await ipcRenderer.invoke('miner:defender'); toast(r && r.ok ? T('defenderOk') : T('defenderFail') + ' ' + ((r && r.error) || ''), 6000); break }
    }
  })
  document.addEventListener('change', (ev) => {
    const t = ev.target; if (!t || (t.id !== 'mReward' && t.id !== 'nPayout')) return
    st.otherOpen = st.otherOpen || {}
    const row = $(t.id + '-oth')
    if (t.value === '__other') { st.otherOpen[t.id] = true; if (row) row.style.display = 'flex'; const i = $(t.id + '-in'); if (i) i.focus(); return }
    st.otherOpen[t.id] = false; if (row) row.style.display = 'none'
    if (/^0x[0-9a-fA-F]{40}$/.test(t.value)) localStorage.setItem(t.id === 'mReward' ? 'minerReward' : 'nodePayout', t.value)
  })
  document.addEventListener('toggle', (ev) => { if (ev.target && ev.target.id === 'advBox') st.advOpen = ev.target.open }, true)
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { if (window.__closeAssetList && window.__closeAssetList()) return; if ($('dd')) closeDd(); else if ($('md')) closeModal() }
    if (ev.key === 'Enter' && ev.target && ev.target.id === 'homePw') { const b = document.querySelector('[data-act=unlock][data-in=homePw]'); if (b) b.click() }
  })

  // legacy hooks called by menu.js via executeJavaScript
  window.addKeyfilePopup = () => createModal()
  window.importAccounts = () => importKeyfiles()
  window.showInfo = () => settingsModal()
  window.toggleEditNetwork = () => settingsModal()
  window.toggleTooltip = () => {}

  // ---------------- boot ----------------
  let APPVER = '1.1.4'
  ipcRenderer.on('miner:status', (e, m) => onMinerStatus(m))
  async function boot () {
    try { const info = await ipcRenderer.invoke('app:info'); if (info && info.version) APPVER = info.version } catch (e) {}
    const cfg = client.config
    if (!cfg.langChosen112) {
      const zh = /^zh/i.test(navigator.language || '') || /^zh/i.test(Intl.DateTimeFormat().resolvedOptions().locale || '')
      if (zh && cfg.lang !== 'CN') { cfg.lang = 'CN'; try { fs.writeFileSync(client.configpath, JSON.stringify(cfg, null, 2)) } catch (e) {} ipcRenderer.invoke('menu:rebuild') }
    }
    render()
    refreshS0(); refreshOld()
    setInterval(refreshS0, 15000); setInterval(refreshOld, 30000)
    try { st.miner = await ipcRenderer.invoke('miner:status') } catch (e) {}
    ensureGpu().then(g => {
      if (localStorage.getItem('minerAutoResume') === '1' && !(st.miner && st.miner.running)) {
        const mode = localStorage.getItem('minerMode') || 'mine'
        if (mode === 'node') nodeStart()
        else if (g && miningGpuReady(g) && localStorage.getItem('minerReward')) ipcRenderer.invoke('miner:start', localStorage.getItem('minerReward'), { mode: 'mine' })
      }
    })
    if (st.tab === 'mine') render()
  }
  boot()
})()
