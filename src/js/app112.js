// SCDO Wallet 2.0.0 renderer (renamed from ScdoWalletBeta). 1.1.4 renderer (1.1.4: network menu can switch to SCDO Shard1 (Classic), SCDO Shard2 (Classic), SCDO Shard3 (Classic) or SCDO Shard4 (Classic) and the choice is kept; names SCDO Shard0 (EVM) / Classic accounts.
// 1.1.3: MetaMask-style asset dropdown on the Send page): new UI modelled on mainstream wallets (MetaMask / Trust / OKX / Rabby / Exodus):
// account switcher at the top, big balance, Receive / Send action row, assets + activity, network selector,
// settings gear. Uses the existing APIs: src/api/scdoClient.js (keyfiles, Classic shards), src/api/evm.js (SCDO Shard0 (EVM)),
// main-process IPC for the miner and for keyfile backup + delete.
// 2.0.1: the page runs sandboxed with contextIsolation and NO Node.js (typeof require === 'undefined'). Everything
// privileged (keyfiles, signing, files, RPC) is done by the main process through window.scdo (preload.js allowlist).
// Markup only goes through SafeDom.html() (Trusted Types + allowlist sanitizer); plain values use textContent.
'use strict'
;(async function () {
  const api = window.scdo
  const SD = window.SafeDom
  const esc = SD.esc
  const BOOT = await api.invoke('wallet:boot')
  const CFG = BOOT.config
  const S0CFG = BOOT.shard0

  // ---------------- small helpers ----------------
  const $ = (id) => document.getElementById(id)
  // 2.0.4: UI language follows the saved choice ('EN' default, 'CN' = 繁體中文 / Traditional Chinese)
  let LANG = (CFG && CFG.lang === 'CN') ? 'CN' : 'EN'
  function lang () { return LANG }
  function applyLangAttr () { try { document.documentElement.lang = LANG === 'CN' ? 'zh-Hant-TW' : 'en'; if (window.SCDOMining) window.SCDOMining.lang = LANG } catch (e) {} }
  applyLangAttr()
  // bigint helpers (replace ethers.formatUnits / parseUnits in the page)
  function toBig (x) { return typeof x === 'bigint' ? x : BigInt(x == null ? 0 : x) }
  function formatUnits (v, dec) {
    v = toBig(v); dec = Number(dec) || 0
    const neg = v < 0n; if (neg) v = -v
    const base = 10n ** BigInt(dec); const i = v / base; let f = (v % base).toString().padStart(dec, '0').replace(/0+$/, '')
    return (neg ? '-' : '') + i.toString() + '.' + (f || '0')
  }
  function parseUnits (str, dec) {
    str = String(str).trim(); if (!/^\d+(\.\d+)?$/.test(str)) throw new Error('bad number')
    const [i, f = ''] = str.split('.'); if (f.length > dec) throw new Error('too many decimals')
    return BigInt(i) * 10n ** BigInt(dec) + BigInt((f + '0'.repeat(dec)).slice(0, dec) || '0')
  }
  const formatEther = (v) => formatUnits(v, 18)
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
    return n.toLocaleString('en-US', { minimumFractionDigits: Math.min(3, mx), maximumFractionDigits: mx, roundingMode: 'trunc' }) // 2.0.2 D-05: never round amounts up
  }
  function fmtWei (wei, dMax) { return fmtNum(formatEther(wei), dMax) }
  function fmtHash (h) { if (h == null) return '–'; const u = ['H/s', 'kH/s', 'MH/s', 'GH/s']; let i = 0; while (h >= 1000 && i < 3) { h /= 1000; i++ } return h.toFixed(2) + ' ' + u[i] }
  function toast (msg, ms) { const t = $('toast'); t.textContent = msg; t.style.display = 'block'; clearTimeout(toast._t); toast._t = setTimeout(() => { t.style.display = 'none' }, ms || 3500) }
  function copyText (t) { navigator.clipboard.writeText(t).then(() => toast(T('copied') + PU.c() + t)).catch(() => toast(t)) }
  function avatar (name) {
    let h = 0; for (const c of String(name)) h = (h * 31 + c.codePointAt(0)) >>> 0
    const hue = h % 360
    const ch = (String(name).trim()[0] || '?').toUpperCase()
    return `<div class="avatar" style="background:hsl(${hue},62%,48%)">${esc(ch)}</div>`
  }
  function openExternal (url) { api.invoke('shell:openExternal', url) }

  // ---------------- state ----------------
  const ui = (BOOT.ui && typeof BOOT.ui === 'object' && !Array.isArray(BOOT.ui)) ? BOOT.ui : {}
  ui.hidden = ui.hidden || { new: [], old: [] }
  ui.hidden.new = ui.hidden.new || []; ui.hidden.old = ui.hidden.old || []
  ui.showHidden = !!ui.showHidden
  function saveUi () { api.invoke('wallet:saveUi', ui).catch(e => console.error('saveUi', e)) }
  // 1.1.4: account display names. Keyfiles are never renamed on disk; the label shown is ui.names[file] (Rename),
  // else the file name without its ".<timestamp>" suffix. Files without a usable name (empty, or the old "new …"
  // default) get a stable number: 帳戶 N / Account N.
  ui.names = (ui.names && typeof ui.names === 'object' && !Array.isArray(ui.names)) ? ui.names : {}
  ui.accNo = (ui.accNo && typeof ui.accNo === 'object' && !Array.isArray(ui.accNo)) ? ui.accNo : {}
  ui.rewardExtra = Array.isArray(ui.rewardExtra) ? ui.rewardExtra.filter(x => /^0x[0-9a-fA-F]{40}$/.test(x)) : []
  ui.classicExtra = Array.isArray(ui.classicExtra) ? ui.classicExtra.map(a => (window.SCDOZpow ? window.SCDOZpow.parseClassicAddress(a) : null)).filter(Boolean).map(a => a.address) : []
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
  const TABS = ['home', 'new', 'old', 'mine', 'remit']
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
    miner: null, miners: { shard0: { chain: 'shard0', running: false, code: 'IDLE' }, classicCpu: { chain: 'classic', mode: 'cpu', running: false, code: 'IDLE' }, classicGpu: { chain: 'classic', mode: 'gpu', running: false, code: 'IDLE' } }, gpu: null, caps: null, logOpen: false,
    mineShard: [0, 1, 2, 3, 4].includes(Number(localStorage.getItem('mineShard112'))) ? Number(localStorage.getItem('mineShard112')) : 0,
    mineBackend: localStorage.getItem('mineBackend112') || 'cpu',
    rawAccounts: BOOT.accounts || [], activity: {}, oldRecords: [],
    remit: { phase: 'idle', error: '', address: '', ledger: null, base: '' } // 2.0.12 匯款 (token stays in the main process)
  }
  const shard0 = () => ({
    cfg: S0CFG,
    explorerTx: (h) => S0CFG.explorer + '/#/tx?txhash=' + encodeURIComponent(h),
    explorerAddress: (a) => S0CFG.explorer + '/#/address?address=' + encodeURIComponent(a)
  })
  async function reloadAccounts () { try { st.rawAccounts = await api.invoke('wallet:accounts') } catch (e) { console.error(e) } loadAccounts() }
  function loadAccounts () {
    st.accounts = (st.rawAccounts || []).map(a => ({ filename: a.filename, pubkey: a.pubkey, shard: a.shard, evm: a.evm }))
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

  // ---------------- shard0 activity (local file kept by the main process) ----------------
  async function loadActivity (addr) { if (!addr) return; try { st.activity[addr.toLowerCase()] = await api.invoke('s0:activity', addr) } catch (e) {} }

  // ---------------- data refresh ----------------
  let refreshingS0 = false
  async function refreshS0 () {
    if (refreshingS0) return; refreshingS0 = true
    try {
      try { const ci = await api.invoke('s0:chainInfo'); st.net.s0Block = ci.block; st.net.s0Ok = ci.chainId === 5680 } catch (e) { st.net.s0Ok = false }
      await Promise.all(st.accounts.filter(a => a.evm).map(async a => {
        try { st.s0[a.filename] = balFromIpc(await api.invoke('s0:balances', a.evm)) } catch (e) { st.s0[a.filename] = Object.assign({}, st.s0[a.filename], { err: e.message }) }
      }))
      try { await api.invoke('s0:refreshPending') } catch (e) {}
      const sa = selected(); if (sa && sa.evm) await loadActivity(sa.evm)
    } finally { refreshingS0 = false; renderLive() }
  }
  function balFromIpc (b) {
    return { nativeWei: b.nativeWei == null ? null : BigInt(b.nativeWei), tokens: (b.tokens || []).map(t => Object.assign({}, t, { raw: t.raw == null ? null : BigInt(t.raw) })) }
  }
  let refreshingOld = false
  function refreshOld () {
    if (refreshingOld || !st.accounts.length) return; refreshingOld = true
    let left = st.accounts.length; let anyOk = false
    const doneOne = () => { if (--left <= 0) { refreshingOld = false; st.net.oldOk = anyOk; renderLive() } }
    st.accounts.forEach(a => {
      let answered = false
      const to = setTimeout(() => { if (!answered) { answered = true; doneOne() } }, 20000)
      api.invoke('old:balance', a.pubkey, a.shard).then(v => {
        if (answered) return; answered = true; clearTimeout(to)
        if (v != null) { st.old[a.pubkey] = v; anyOk = true }
        doneOne()
      }).catch(() => { if (!answered) { answered = true; clearTimeout(to); doneOne() } })
    })
    api.invoke('old:records').then(r => { st.oldRecords = r || [] }).catch(() => {})
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
  // Card buttons open Mining or 匯款 with this keyfile already chosen. No account menu.
  // Mining still shows Shard0 GPU and Classic Shard1–4 GPU and CPU; the click does not start a miner.
  function openMineFor (filename, chain) {
    const a = accByFile(filename)
    if (!a) return
    st.sel = a.filename
    localStorage.setItem('selAcc112', a.filename)
    const classic = parseClassicAddress(a.pubkey)
    if (classic) localStorage.setItem('minerClassic', classic.address)
    // Shard0 reward is only this card. A locked 0x is read from the keystore
    // public address when that field is already 0x; a Classic address cannot
    // become 0x, so the dropdown stays on "pick an address" instead of another wallet.
    if (chain !== 'old') {
      let own = window.SCDOZpow && window.SCDOZpow.ownRewardAddress ? window.SCDOZpow.ownRewardAddress(a) : null
      if (!own && a.evm && /^0x[0-9a-fA-F]{40}$/.test(a.evm)) own = a.evm
      if (own) localStorage.setItem('minerReward', own)
      else localStorage.removeItem('minerReward')
    }
    const shard = classic ? classic.shard : Number(a.shard)
    st.mineShard = chain === 'old' && [1, 2, 3, 4].includes(shard) ? shard : 0
    localStorage.setItem('mineShard112', String(st.mineShard))
    if ($('md')) SD.clear($('modalRoot'))
    setTab('mine')
    render()
    ensureGpu()
    ensureCaps()
  }
  function openRemitFor (filename) {
    const a = accByFile(filename)
    if (!a) return
    st.sel = a.filename
    localStorage.setItem('selAcc112', a.filename)
    if ($('md')) SD.clear($('modalRoot'))
    setTab('remit')
    render()
  }
  function setNet (v, shard) {
    const net = v === 'old' ? 'old' : 'new'
    if (net === 'old') { ui.shard = [1, 2, 3, 4].includes(Number(shard)) ? Number(shard) : 0; setTab('old') } else setTab(st.tab === 'old' ? 'home' : st.tab)
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
    SD.html($('hdr'), `<div class="brand"><img src="./assets/icon-128.png" alt=""><div><div class="bt">${esc(T('appName'))}</div><div class="bv">SCDO Wallet ${esc(APPVER)}</div></div></div>
      ${sw}<div class="spacer"></div>
      <div class="minepill" id="minePill" data-act="tab" data-v="mine"></div>
      <div class="netsel" data-act="netMenu" id="netSel"><span class="dot ${netOk == null ? '' : netOk ? 'ok' : 'bad'}"></span>${esc(netOld ? netOldName() : T('netNew'))} ▾</div>
      <div class="langtg" id="langToggle" role="group" aria-label="語言 / Language"><button type="button" class="${lang() === 'CN' ? 'on' : ''}" data-act="hdrLang" data-v="CN" id="langZh">華語</button><button type="button" class="${lang() === 'EN' ? 'on' : ''}" data-act="hdrLang" data-v="EN" id="langEn">English</button></div>
      <button class="gear" data-act="settings" id="gear" title="${esc(T('settings'))}">⚙</button>`)
    renderMinePill()
    const tabs = [['home', 'tabHome'], ['new', 'tabNew'], ['old', 'tabOld'], ['mine', 'tabMine'], ['remit', 'tabRemit']]
    SD.html($('tabs'), tabs.map(([k, l]) => `<button class="${st.tab === k ? 'on' : ''}" data-act="tab" data-v="${esc(k)}" id="tab-${esc(k)}">${esc(T(l))}</button>`).join(''))
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
        <button class="btn pri" data-act="unlock" data-f="${esc(a.filename)}" data-in="homePw">${esc(T('showAddress'))}</button></div>
        <div class="actions"><button class="btn sec big" data-act="tab" data-v="remit" id="btnRemit">${esc(T('tabRemit'))}</button></div></div>`
    } else {
      const b = st.s0[a.filename]
      const bal = b && b.nativeWei != null ? fmtWei(b.nativeWei) : '…'
      top = `<div class="balance-card card"><div class="bl">${esc(T('s0Balance'))}</div>
        <div class="bn" id="homeBal">${esc(bal)}<span>SCDO</span></div>
        <div class="bs">${esc(T('currentAccount'))}${PU.c()}<b class="wrap">${esc(accLabel(a))}</b>${PU.bar()}${esc(T('allNewTotal'))}${PU.c()}<span id="homeTot">${tot.known ? esc(fmtWei(tot.wei)) : '…'}</span> SCDO${PU.l()}${esc(T('nAccounts', { n: vis.length }))}${hiddenN ? PU.com() + esc(T('exclHidden')) : ''}${PU.r()}</div>
        <div class="actions"><button class="btn pri big" data-act="receive" data-f="${esc(a.filename)}" data-chain="new" id="btnReceive">⬇&nbsp; ${esc(T('receive'))}</button>
        <button class="btn pri big" data-act="send" data-f="${esc(a.filename)}" id="btnSend">⬆&nbsp; ${esc(T('send'))}</button>
        <button class="btn sec big" data-act="tab" data-v="remit" id="btnRemit">${esc(T('tabRemit'))}</button></div></div>`
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
    if (sym === 'SCDO') return '<div class="ai"><img src="./assets/icon-64.png" alt=""></div>'
    return `<div class="ai" style="background:${esc(TOKEN_COLORS[sym] || '#8a8fa8')}">${esc(String(sym).replace(/^t/, '').slice(0, 2))}</div>`
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
      SD.html(list, `<div class="lbl" style="padding:6px 14px">${esc(T('selectAsset'))}</div>` + chainAssets(a).map(x =>
        `<button type="button" class="ait ${x.symbol === cur ? 'on' : ''}" role="option" aria-selected="${x.symbol === cur}" data-pick="${esc(x.symbol)}">${assetIconHtml(x.symbol)}
          <div class="at"><div class="as">${esc(x.symbol)}</div><div class="lbl">${esc(x.name)}</div></div>
          <div class="ab">${x.bal == null ? '…' : esc(x.bal)} <span class="lbl">${esc(x.symbol)}</span></div><span class="ck">${x.symbol === cur ? '✓' : ''}</span></button>`).join(''))
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
    const l = (st.activity[String(a.evm || '').toLowerCase()] || []).slice(0, 30)
    let h = ''
    if (!l.length) h = `<div style="padding:22px 26px" class="muted">${esc(T('noActivity'))}</div>`
    l.forEach(r => {
      const stt = r.status === 'done' ? `<span class="tag" style="background:#e8f7ee;color:#146c2e">${esc(T('txDone'))}</span>` : r.status === 'fail' ? `<span class="tag" style="background:#fff1f0;color:#a3160c">${esc(T('txFail'))}</span>` : r.status === 'error' ? `<span class="tag" style="background:#fff1f0;color:#a3160c" title="${esc(r.error || '')}">${esc(T('txNotSent'))}</span>` : r.stuck ? `<span class="tag grey" title="${esc(T('notConfirmedYet'))}">${esc(T('txStuck'))}</span>` : `<span class="tag grey">${esc(T('txPending'))}</span>`
      h += `<div class="txrow" data-act="openTx" data-v="${esc(r.hash)}"><div style="font-size:26px">${r.dir === 'in' ? '\u2B07' : '\u2B06'}</div><div style="flex:1;min-width:0"><div style="font-weight:700;font-size:19px">${esc(r.dir === 'in' ? T('txReceived') : T('txSent'))} ${r.dir === 'in' ? '\u2190' : '\u2192'} <span class="mono" style="font-weight:400;font-size:17px">${esc(r.dir === 'in' ? r.from : r.to)}</span></div>
        <div class="lbl">${esc(new Date(r.t).toLocaleString(lang() === 'CN' ? 'zh-TW' : 'en-GB'))}${r.block ? ' · #' + esc(r.block) : ''}</div></div>
        <div style="text-align:right"><div style="font-size:21px;font-weight:700">${r.dir === 'in' ? '+' : '\u2212'}${esc(fmtNum(r.amount))} ${esc(r.asset)}</div>${stt}</div></div>`
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
        <div class="ops one">${cardFeatureOps(a, 'new')}<button class="btn ghost small" data-act="rename" data-f="${esc(a.filename)}">${esc(T('rename'))}</button><button class="btn ghost small" data-act="${hid ? 'unhide' : 'hide'}" data-chain="new" data-f="${esc(a.filename)}">${esc(hid ? T('unhide') : T('hide'))}</button>
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
        ${cardFeatureOps(a, 'old')}
        <button class="btn ghost small" data-act="rename" data-f="${esc(a.filename)}">${esc(T('rename'))}</button>
        <button class="btn ghost small" data-act="${hid ? 'unhide' : 'hide'}" data-chain="old" data-f="${esc(a.filename)}">${esc(hid ? T('unhide') : T('hide'))}</button>
        <button class="btn danl small" data-act="delete" data-f="${esc(a.filename)}">${esc(T('del'))}</button></div></div>`
    })
    if (hiddenN && !ui.showHidden) h += `<div class="hint-box">👁 ${esc(T('hiddenHint', { n: hiddenN }))}</div>`
    const ot = oldTotal(shardFilter(visible('old')))
    h += `<div class="total-line"><span style="font-size:20px;color:#3d4160">${esc(ui.shard ? T('oldSumN', { n: ui.shard }) : T('oldSum'))}</span><span style="font-size:30px;font-weight:800;color:#3d4160" id="oldTot">${ot.known ? esc(fmtNum(ot.v)) : '…'} SCDO</span></div>`
    const recs = (st.oldRecords || []).filter(Boolean).slice(0, 20)
    h += `<div class="card" style="margin-top:22px;padding:18px 24px"><div style="font-size:22px;font-weight:700">${esc(T('oldRecords'))}</div>`
    if (!recs.length) h += `<div class="muted" style="margin-top:8px">${esc(T('noOldRecords'))}</div>`
    recs.forEach(r => {
      const s = r.u == 1 ? T('txDone') : r.u == 0 ? T('txFail') : T('txPending') // eslint-disable-line eqeqeq
      h += `<div style="padding:10px 0;border-bottom:1px solid #f0f1f7"><div class="row" style="flex-wrap:wrap"><b>${esc(fmtNum(r.m / 1e8))} SCDO</b><span class="tag grey">${esc(s)}</span><span class="lbl">${esc(new Date(r.t).toLocaleString(lang() === 'CN' ? 'zh-TW' : 'en-GB'))}</span></div>
        <div class="mono lbl">${esc(r.fa)} → ${esc(r.ta)}</div><div class="mono lbl">${esc(r.s)}</div></div>`
    })
    return h + '</div></div>'
  }

  // ---------------- mining ----------------
  function minerText (m) {
    if (!m) return T('st_IDLE')
    const code = m.code || 'IDLE'
    const p = { l: m.localBlock == null ? '?' : m.localBlock, n: m.networkBlock == null ? '?' : m.networkBlock, w: m.wallet || '', m: m.message || '', shard: m.shard || '', eta: fmtSyncEta(m.syncEtaSec) }
    let s = T('st_' + code, p)
    if (s === 'st_' + code) s = m.message || code
    if (code === 'DOWNLOADING' && m.download && m.download.total) s += ' ' + Math.round(100 * m.download.got / m.download.total) + '%'
    return s
  }
  function fmtSyncEta (sec) {
    const cn = lang() === 'CN'
    const n = Number(sec)
    if (sec == null || !Number.isFinite(n) || n < 0) return cn ? '計算中' : 'calculating'
    if (n < 5) return cn ? '即將完成' : 'almost done'
    const s = Math.round(n)
    if (s < 60) return s + (cn ? ' 秒' : 's')
    const mins = Math.round(s / 60)
    if (mins < 60) return mins + (cn ? ' 分鐘' : ' min')
    const h = Math.floor(mins / 60)
    const rm = mins % 60
    return h + (cn ? ' 小時' : 'h') + (rm ? (cn ? ' ' + rm + ' 分鐘' : ' ' + rm + ' min') : '')
  }
  function minerClass (m) {
    if (!m) return ''
    if (m.phase === 'error') return 'bad'
    if (['MINING', 'NODE_RUNNING', 'EXTERNAL_NODE', 'CLASSIC_MINING', 'CLASSIC_GPU'].includes(m.code)) return 'good'
    if (['SYNCING', 'NO_PEERS', 'MINING_STARTING', 'STARTING', 'DOWNLOADING', 'EXTRACTING', 'INIT', 'STOPPING', 'PAUSED', 'EXTERNAL_DOWN', 'CLASSIC_STARTING', 'CLASSIC_CHECKING', 'CLASSIC_SYNCING', 'CLASSIC_PAUSED', 'POOL_CONNECTING', 'RESTARTING'].includes(m.code)) return 'warn'
    return ''
  }
  function cardFeatureOps (a, chain) {
    return `<button class="btn sec small" data-act="cardMine" data-chain="${esc(chain)}" data-f="${esc(a.filename)}">${esc(T('tabMine'))}</button><button class="btn sec small" data-act="cardRemit" data-chain="${esc(chain)}" data-f="${esc(a.filename)}">${esc(T('tabRemit'))}</button>`
  }
  function rewardOptions () {
    const l = visible('new').filter(a => a.evm).map(a => ({ v: a.evm, l: accLabel(a) }))
    const chosen = accByFile(st.sel)
    const own = chosen && window.SCDOZpow && window.SCDOZpow.ownRewardAddress ? window.SCDOZpow.ownRewardAddress(chosen) : (chosen && chosen.evm)
    if (own && !l.some(o => o.v.toLowerCase() === String(own).toLowerCase())) l.unshift({ v: own, l: accLabel(chosen) })
    const extra = ui.rewardExtra.slice()
    for (const k of ['minerReward', 'nodePayout']) { const x = localStorage.getItem(k); if (x && /^0x[0-9a-fA-F]{40}$/.test(x) && !extra.some(y => y.toLowerCase() === x.toLowerCase())) extra.push(x) }
    for (const x of extra) if (!l.some(o => o.v.toLowerCase() === x.toLowerCase())) l.push({ v: x, l: T('rewardOtherLabel') })
    return l
  }
  // address <select>: placeholder when nothing is chosen (never silently preselect an account), wallet accounts by
  // name, saved external addresses, and "other address…" which opens a paste field
  function addrSelect (id, opts, cur, disabled, placeholder, otherLabel) {
    const has = !!cur && opts.some(o => o.v.toLowerCase() === String(cur).toLowerCase())
    const open = !!(st.otherOpen && st.otherOpen[id])
    return `<select class="inp" id="${id}" ${disabled ? 'disabled' : ''}><option value="" ${has ? '' : 'selected'} disabled>${esc(T('pickAddr'))}</option>${opts.map(o => `<option value="${esc(o.v)}" ${has && o.v.toLowerCase() === String(cur).toLowerCase() ? 'selected' : ''}>${esc(o.l)} — ${esc(o.v)}</option>`).join('')}<option value="__other">${esc(otherLabel || T('rewardOther'))}</option></select>
      <div class="row" id="${id}-oth" style="display:${open && !disabled ? 'flex' : 'none'};margin-top:8px;gap:10px;flex-wrap:wrap"><input class="inp mono half" id="${id}-in" placeholder="${esc(placeholder || '0x…')}" style="flex:1;min-width:320px" autocomplete="off" spellcheck="false" inputmode="latin" autocapitalize="off" lang="en"><button class="btn sec" data-act="useOtherAddr" data-v="${id}">${esc(T('rewardOtherUse'))}</button></div>`
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
  function miningInput (v) {
    const z = window.SCDOZpow
    if (z && z.normalizeMiningInput) return z.normalizeMiningInput(v)
    return String(v == null ? '' : v).normalize('NFKC').replace(/[\uFF01-\uFF5E]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)).replace(/\u3000/g, ' ').replace(/\s+/g, '')
  }
  function parseClassicAddress (v) {
    const z = window.SCDOZpow
    return z && z.parseClassicAddress ? z.parseClassicAddress(v) : null
  }
  function cpuCount () { return Math.max(1, Number(st.caps && st.caps.cpuCount) || 1) }
  function threadCount () {
    const max = cpuCount()
    const saved = Number(localStorage.getItem('mineThreads112'))
    const n = Number.isFinite(saved) && saved >= 1 ? saved : ((st.caps && st.caps.threadsDefault) || max)
    return Math.max(1, Math.min(max, Math.floor(n)))
  }
  function gpuParams () {
    let g = {}
    try { g = JSON.parse(localStorage.getItem('mineGpu112') || '{}') } catch (e) { g = {} }
    const n = (v, d) => { const x = Number(miningInput(v)); return Number.isFinite(x) && x >= 1 ? Math.floor(x) : d }
    return { threads: n(g.threads, 1), threadblocks: n(g.threadblocks, 100), blockthreads: n(g.blockthreads, 100) }
  }
  function saveGpuParams () {
    const read = (id, d) => { const el = $(id); return el ? Number(miningInput(el.value)) : d }
    const g = gpuParams()
    const next = {
      threads: read('mGpuThreads', g.threads),
      threadblocks: read('mThreadBlocks', g.threadblocks),
      blockthreads: read('mBlockThreads', g.blockthreads)
    }
    localStorage.setItem('mineGpu112', JSON.stringify(next))
    return next
  }
  function classicOptions (shard) {
    const opts = []
    const addClassic = (a) => {
      const p = parseClassicAddress(a.pubkey)
      if (p && p.shard === shard && !opts.some(o => o.v === p.address)) opts.push({ v: p.address, l: accLabel(a) })
    }
    visible('old').forEach(addClassic)
    const chosen = accByFile(st.sel)
    if (chosen) addClassic(chosen)
    ;(ui.classicExtra || []).forEach(x => {
      const p = parseClassicAddress(x)
      if (p && p.shard === shard && !opts.some(o => o.v === p.address)) opts.push({ v: p.address, l: T('rewardOtherLabel') })
    })
    return opts
  }
  function pageMineClassic (m, running, shard) {
    const caps = st.caps || {}
    const gpuOn = !!(caps.gpu && caps.gpu.available)
    const extOn = !!(caps.external && caps.external.available)
    const backend = st.mineBackend === 'gpu' || st.mineBackend === 'external' ? st.mineBackend : 'cpu'
    const opts = classicOptions(shard)
    const saved = localStorage.getItem('minerClassic') || ''
    const cur = (running && m.chain === 'classic' && m.wallet) || saved
    const sel = addrSelect('mClassic', opts, cur, running, shard + 'S0' + shard + '…', T('rewardOtherClassic')) + (opts.length ? '' : `<div class="lbl" style="margin-top:6px">${esc(T('noClassicAddr'))}</div>`)
    const pool = (caps.pools && caps.pools[shard]) || {}
    const buttons = [['cpu', T('classicCpu'), false], ['gpu', T('classicGpu'), !gpuOn]]
    if (extOn) buttons.push(['external', T('classicGpuCustom'), false])
    let h = `<div class="shardchips">${buttons.map(([id, label, dis]) => `<button type="button" class="${backend === id ? 'on' : ''}" data-act="mineBackend" data-v="${id}" ${dis ? 'disabled' : ''}>${esc(label)}</button>`).join('')}</div>`
    if (!gpuOn) h += `<div class="lbl">${esc(T('classicGpuOff'))}</div>`
    if (backend === 'cpu' && caps.cpu && caps.cpu.available === false) h += `<div class="lbl">${esc(T('classicCpuMissing'))}</div>`
    h += `<div class="field" style="margin-top:14px"><div class="lbl" style="font-weight:600">${esc(T('classicAddr'))}</div>${sel}</div>`
    const showPool = backend === 'cpu' || (backend === 'external' && !(caps.external && caps.external.solo))
    if (showPool && pool.stratum) {
      h += `<div class="lbl">${esc(T('poolEndpoint'))}${PU.c()}${esc(pool.stratum)}（HTTP ${esc(pool.statsPort)}）</div>`
      if (shard !== 1 && backend === 'cpu') h += `<div class="lbl">${esc(T('poolLater'))}</div>`
    }
    if (backend === 'cpu') {
      const threads = threadCount(); const max = cpuCount()
      h += `<div class="field"><div class="lbl">${esc(T('cpuThreads'))}${PU.c()}<b id="mThreadsVal">${threads}</b> / ${max}</div>
        <input type="range" class="threads" id="mThreads" min="1" max="${max}" step="1" value="${threads}" ${running ? 'disabled' : ''}></div>
        <div class="lbl">${esc(T('cpuThreadsHint'))}</div>`
    } else if (backend === 'gpu') {
      const g = gpuParams()
      h += `<div class="row" style="gap:12px;flex-wrap:wrap;margin-top:10px">
        <label class="lbl">${esc(T('gpuThreads'))}<br><input class="inp half" id="mGpuThreads" inputmode="numeric" value="${g.threads}" ${running ? 'disabled' : ''}></label>
        <label class="lbl">${esc(T('gpuBlocks'))}<br><input class="inp half" id="mThreadBlocks" inputmode="numeric" value="${g.threadblocks}" ${running ? 'disabled' : ''}></label>
        <label class="lbl">${esc(T('gpuBlockThreads'))}<br><input class="inp half" id="mBlockThreads" inputmode="numeric" value="${g.blockthreads}" ${running ? 'disabled' : ''}></label>
      </div>`
    }
    const active = running && m.chain === 'classic'
    const young = m.startedAt && (Date.now() - m.startedAt < 600000)
    h += `<div class="statusbar ${minerClass(m)}" id="minerStatus">${esc(minerText(m))}</div>
      <div class="stats">
        <div class="stat"><div class="lbl">${esc(T('hashrate'))}</div><div class="v" id="mHr">${active && m.hashrate != null ? esc(fmtHash(m.hashrate)) : '–'}</div></div>
        <div class="stat"><div class="lbl">${esc(T('acceptedShares'))}</div><div class="v" id="mAcc">${esc((m.sharesAccepted || 0) + ' / ' + (m.sharesRejected || 0))}</div></div>
        <div class="stat"><div class="lbl">${esc(T('blocksFound'))}</div><div class="v" id="mFound">${esc(m.blocksFound || 0)}</div></div>
        ${backend === 'cpu' ? `<div class="stat"><div class="lbl">${esc(T('poolPending'))}</div><div class="v" id="mPending">${m.poolStats && m.poolStats.pending != null ? esc(m.poolStats.pending) : '–'}</div></div>
        <div class="stat"><div class="lbl">${esc(T('poolPaid'))}</div><div class="v" id="mPaid">${m.poolStats && m.poolStats.paid != null ? esc(m.poolStats.paid) : '–'}</div></div>` : `<div class="stat"><div class="lbl">${esc(T('blockRate'))}</div><div class="v" id="mRate">${active && m.blocksFound > 0 && !young && m.blockRatePerHour != null ? esc(Number(m.blockRatePerHour).toFixed(2)) : '–'}</div></div>`}
      </div>
      <div class="row" style="margin-top:22px"><button class="btn ${active ? 'dan' : 'pri'} big" data-act="${active ? 'minerStop' : 'mineStart'}" id="btnMine">${esc(active ? T('stopMining') : T('startMining'))}</button></div>
      <div class="lbl" style="margin-top:10px">${esc(backend === 'cpu' ? T('classicFirst') : T('blockRateHint'))}</div>`
    if (backend !== 'cpu') h += `<div class="lbl">${esc(T('classicFirst'))}</div>`
    return h
  }
  function slotForView () {
    if (Number(st.mineShard) >= 1) return st.mineBackend === 'cpu' ? 'classicCpu' : 'classicGpu'
    return 'shard0'
  }
  function viewMiner () { return (st.miners && st.miners[slotForView()]) || {} }
  function storeMiner (m) {
    if (!st.miners) st.miners = {}
    if (m && m.shard0 && m.classicCpu && m.classicGpu) {
      st.miners = { shard0: m.shard0, classicCpu: m.classicCpu, classicGpu: m.classicGpu }
      return
    }
    if (m && m.chain === 'classic' && m.mode === 'cpu') st.miners.classicCpu = m
    else if (m && m.chain === 'classic') st.miners.classicGpu = m
    else if (m) st.miners.shard0 = Object.assign({ chain: 'shard0' }, m)
  }
  function mineAdvanced (showDefender, m) {
    m = m || {}
    return `<details class="adv" id="advBox" ${st.advOpen ? 'open' : ''}><summary>${esc(T('advanced'))} <span>${esc(T('advHint'))}</span></summary>
      <div class="row" style="margin-top:14px;flex-wrap:wrap"><button class="btn ghost small" data-act="toggleLog">${esc(st.logOpen ? T('hideLog') : T('showLog'))}</button>
      <button class="btn ghost small" data-act="openLogs">${esc(T('openLogs'))}</button>
      ${showDefender ? `<button class="btn ghost small" data-act="defender">${esc(T('defender'))}</button>` : ''}</div>
      <div class="lbl" style="margin-top:10px">${esc(T('cpuNote'))}</div>
      <pre class="log" id="mLog" style="display:${st.logOpen ? 'block' : 'none'}">${esc(window.SCDOMining.minerLogger.displayLines(m.logTail, 80).join('\n'))}</pre></details>`
  }
  function pageMine () {
    st.miner = viewMiner()
    const m = st.miner || {}
    const running = !!m.running
    const mineShard = [0, 1, 2, 3, 4].includes(Number(st.mineShard)) ? Number(st.mineShard) : 0
    let h = `<div class="page"><div class="card mine-card"><div style="font-size:30px;font-weight:700">${esc(T('mineTitle'))}</div>`
    h += `<div class="shardchips" id="mineShards">${[0, 1, 2, 3, 4].map(n => `<button type="button" class="${mineShard === n ? 'on' : ''}" data-act="mineShard" data-v="${n}">${esc(n ? T('mineShardN', { n }) : T('mineShard0'))}</button>`).join('')}</div>`
    h += `<div class="lbl" style="margin-top:8px">${esc(T('mineTogether'))}</div>`
    if (mineShard !== 0) {
      h += pageMineClassic(m, running, mineShard)
      h += mineAdvanced(false, m)
      return h + '</div></div>'
    }
    if (api.platform === 'darwin') return h + `</div><div id="miningBatch1"></div></div>`
    if (!st.gpu) return h + `<div class="statusbar"><span class="spin"></span> ${esc(T('detecting'))}</div></div><div id="miningBatch1"></div></div>`
    const g = st.gpu
    const nodeMode = m.mode === 'node' && running
    const mineMode = (m.mode === 'mine' || m.mode === 'pool') && running
    const statusBar = `<div class="statusbar ${minerClass(m)}" id="minerStatus">${esc(minerText(m))}</div>`
    const blocks = `<div class="stat"><div class="lbl">${esc(T('localNet'))}</div><div class="v" id="mBlocks">${m.localBlock == null ? '–' : esc(m.localBlock)} / ${m.networkBlock == null ? (st.net.s0Block == null ? '–' : esc(st.net.s0Block)) : esc(m.networkBlock)}</div></div>
      <div class="stat"><div class="lbl">${esc(T('peers'))}</div><div class="v" id="mPeers">${m.peers == null ? '–' : esc(m.peers)}</div></div>`
    if (g.nvidia) {
      const opts = rewardOptions()
      const saved = localStorage.getItem('minerReward') || ''
      const cur = saved
      const sel = addrSelect('mReward', opts, cur, running) + (opts.length ? '' : `<div class="lbl" style="margin-top:6px">${esc(T('noRewardAddr'))}</div>`)
      h += `<div class="tag" style="background:#e8f7ee;color:#146c2e;margin-top:12px">${esc(T('gpuYes'))}</div>
        <div style="font-size:21px;margin-top:10px">${esc(T('gpuName', { n: ((g.mineNames && g.mineNames.length) ? g.mineNames : (g.nvidiaNames || [])).join(', ') }))}</div>
        <div class="field" style="margin-top:14px"><div class="lbl" style="font-weight:600">${esc(T('rewardAddr'))}</div>${sel}</div>
        ${statusBar}
        ${m.mode === 'pool' && running && m.poolUrl ? `<div class="infobox" id="poolNow">${esc(T('poolNow', { u: m.poolUrl }))}</div>` : ''}
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
    h += mineAdvanced(api.platform === 'win32' && g.nvidia, m)
    return h + '</div><div id="miningBatch1"></div></div>'
  }

  // ---------------- 2.0.12 remittance (匯款): unlock + personal_sign, no KYC form ----------------
  // Keyfile decryption, the personal_sign and the bearer token all stay in the main process (remitService).
  // The page only gets the signed-in address and that address's own ledger.
  const sameAddr = (x, y) => !!x && !!y && String(x).toLowerCase() === String(y).toLowerCase()
  function remitReset () { st.remit = { phase: 'idle', error: '', address: '', ledger: null, base: st.remit.base || '' } }
  function remitAccount () {
    const exact = st.accounts.find(x => x.filename === st.sel)
    if (exact) return exact
    return selected()
  }
  function remitOwnsSession () {
    const a = remitAccount()
    return !!(a && a.evm && st.remit.phase === 'in' && st.remit.address && sameAddr(a.evm, st.remit.address))
  }
  function remitSteps (phase) {
    const order = ['challenge', 'sign', 'session', 'ledger']
    const labels = ['remitStepChallenge', 'remitStepSign', 'remitStepSession', 'remitStepLedger']
    const idx = phase === 'in' ? 4 : order.indexOf(phase)
    return `<div class="row" id="remitSteps" style="gap:8px;flex-wrap:wrap;margin:16px 0">${labels.map((k, i) => {
      const on = idx > i
      const cur = order[i] === phase
      return `<span class="tag ${on || cur ? '' : 'grey'}">${i + 1}. ${esc(T(k))}</span>`
    }).join('')}</div>`
  }
  function remitLedgerHtml (ledger) {
    if (!ledger || typeof ledger !== 'object') return `<div class="muted" style="padding:0 26px">${esc(T('remitEmptyLedger'))}</div>`
    const entries = Array.isArray(ledger) ? ledger : (ledger.entries || ledger.items || ledger.transfers || ledger.records || [])
    let head = ''
    if (ledger.balance != null) head = `<div class="lbl" style="padding:0 26px">${esc(T('balance'))}${PU.c()}<b>${esc(ledger.balance)}</b></div>`
    if (!entries.length) return head + `<div class="muted" style="margin-top:8px;padding:0 26px">${esc(T('remitEmptyLedger'))}</div>`
    return head + entries.slice(0, 30).map(e => {
      const asset = e.asset || e.symbol || ''
      const title = e.memo || e.note || e.type || (asset ? asset : '') || e.tx_id || e.id || e.reference || T('remitTitle')
      let amt = e.amount != null ? e.amount : (e.value != null ? e.value : '')
      if (amt === '' && e.amount_micro != null && isFinite(Number(e.amount_micro))) amt = (Number(e.amount_micro) / 1e6) + (asset ? ' ' + asset : '')
      const who = [e.from, e.to || e.receiving_address || e.beneficiary || e.payee].filter(Boolean).join(' → ')
      const state = e.confirmed === true ? T('txDone') : e.confirmed === false ? T('txPending') : (e.status || e.state || '')
      return `<div class="txrow" style="cursor:default"><div style="flex:1;min-width:0"><div style="font-weight:700" class="wrap">${esc(title)}</div>
        <div class="lbl wrap">${esc([who, state].filter(Boolean).join(' · '))}</div></div>
        <div style="font-weight:700">${esc(amt)}</div></div>`
    }).join('')
  }
  function pageRemit () {
    const a = remitAccount()
    if (!st.remit.base) api.invoke('remit:info').then(r => { if (r && r.base && r.base !== st.remit.base) { st.remit.base = r.base; const el = $('remitBase'); if (el) SD.text(el, r.base) } }).catch(() => {})
    const signedIn = remitOwnsSession()
    if (st.remit.phase === 'in' && !signedIn) { api.invoke('remit:logout').catch(() => {}); remitReset() }
    const phase = signedIn ? 'in' : st.remit.phase
    let body
    if (!a) {
      body = `<div class="muted" style="font-size:20px;margin-top:12px">${esc(T('remitNeedAccount'))}</div>
        <div class="actions" style="justify-content:flex-start"><button class="btn pri" data-act="create">${esc(T('createAccount'))}</button><button class="btn sec" data-act="import">${esc(T('importAccount'))}</button></div>`
    } else if (signedIn) {
      body = `<div class="ok" id="remitStatus" style="font-size:22px;font-weight:700;margin-top:8px">${esc(T('remitIn'))}</div>
        <div class="lbl" style="margin-top:8px">${esc(T('remitAddr'))}</div>
        <div class="mono" id="remitAddr">${esc(st.remit.address)}</div>
        <div class="card" id="remitLedger" style="margin-top:16px;padding:8px 0">${remitLedgerHtml(st.remit.ledger)}</div>
        <div class="row" style="margin-top:16px;flex-wrap:wrap">
          <button class="btn sec" data-act="remitRefresh" id="btnRemitRefresh">${esc(T('remitRefresh'))}</button>
          <button class="btn ghost" data-act="remitLogout" id="btnRemitLogout">${esc(T('remitLogout'))}</button>
        </div>`
    } else {
      const busy = phase === 'challenge' || phase === 'sign' || phase === 'session' || phase === 'ledger'
      const status = phase === 'challenge' ? T('remitChallenge') : phase === 'sign' ? T('remitSigning') : phase === 'session' ? T('remitSession') : phase === 'ledger' ? T('remitLedgerLoad') : ''
      body = `<div class="lbl" style="margin-top:14px">${esc(T('remitAccount'))}${PU.c()}<b class="wrap">${esc(accLabel(a))}</b></div>
        ${a.evm ? `<div class="lbl">${esc(T('remitAddr'))}</div><div class="mono" id="remitAddr">${esc(a.evm)}</div>` : `<div class="lbl">🔒 ${esc(T('locked'))}</div>`}
        <div class="muted" style="margin-top:10px">${esc(T('remitSigningNote'))}</div>
        <div class="unlockbox" style="justify-content:flex-start">
          <input class="inp" type="password" id="remitPw" placeholder="${esc(T('password'))}" style="width:320px;max-width:100%" ${busy ? 'disabled' : ''}>
          <button class="btn pri" data-act="remitSign" data-f="${esc(a.filename)}" id="btnRemitSign" ${busy ? 'disabled' : ''}>${esc(T('remitSignIn'))}</button>
        </div>
        ${status ? `<div id="remitStatus" style="margin-top:12px"><span class="spin"></span> ${esc(status)}</div>` : '<div id="remitStatus"></div>'}
        ${st.remit.error ? `<div class="err" id="remitErr">${esc(st.remit.error)}</div>` : ''}`
    }
    return `<div class="page"><div class="h1" style="font-size:30px;font-weight:700">${esc(T('remitTitle'))}</div>
      <div class="muted" style="font-size:18px;margin-top:4px">${esc(T('remitEn'))}</div>
      <div class="card" style="margin-top:18px;padding:28px 32px">
        <div style="font-size:20px">${esc(T('remitLead'))}</div>
        <div style="font-size:20px;margin-top:8px">${esc(T('remitZero'))}</div>
        <div class="enline">${esc(T('remitZeroEn'))}</div>
        <div class="lbl" style="margin-top:12px">${esc(T('remitOwnOnly'))}</div>
        ${remitSteps(phase)}
        ${body}
        <div class="lbl wrap" style="margin-top:18px">${esc(T('remitGateway'))}${PU.c()}<span class="mono" id="remitBase">${esc(st.remit.base || 'https://scdoscan.io/remit-api')}</span></div>
        <div class="enline">${esc(T('remitEnv'))}</div>
      </div></div>`
  }
  function remitErrText (r) {
    if (r && r.wrongPw) return T('wrongPw')
    if (r && r.foreign) return T('remitForeign')
    if (r && r.down) return T('remitDown')
    if (r && r.net) return T('errNetwork')
    return String((r && r.error) || T('failed'))
  }
  async function remitLogin (filename) {
    const a = accByFile(filename) || selected()
    if (!a) return
    const inp = $('remitPw')
    const pw = inp ? inp.value : ''
    if (!pw) { toast(T('errPw')); return }
    st.remit.phase = 'challenge'; st.remit.error = ''; st.remit.address = ''; st.remit.ledger = null
    render()
    let r = null
    try { r = await api.invoke('remit:login', a.filename, pw) } catch (e) { r = { ok: false, error: String((e && e.message) || e) } }
    await reloadAccounts()
    const own = (accByFile(a.filename) || {}).evm
    if (r && r.ok && (!own || sameAddr(own, r.address))) {
      st.remit = { phase: 'in', error: '', address: r.address, ledger: r.ledger, base: st.remit.base }
      toast(T('remitIn'))
    } else {
      if (r && r.ok) { api.invoke('remit:logout').catch(() => {}); r = { ok: false, foreign: true } }
      st.remit.phase = 'error'; st.remit.address = ''; st.remit.ledger = null
      st.remit.error = remitErrText(r)
    }
    render(); refreshS0()
  }
  async function remitRefresh () {
    if (!remitOwnsSession()) return
    st.remit.phase = 'ledger'; st.remit.error = ''
    render()
    let r = null
    try { r = await api.invoke('remit:ledger', st.remit.address) } catch (e) { r = { ok: false, error: String((e && e.message) || e) } }
    if (r && r.ok && sameAddr(r.address, st.remit.address)) { st.remit.ledger = r.ledger; st.remit.phase = 'in' } else {
      st.remit.phase = 'error'
      if (r && r.foreign) { st.remit.address = ''; st.remit.ledger = null }
      st.remit.error = remitErrText(r)
    }
    render()
  }
  api.on('remit:step', (p) => { if (['challenge', 'sign', 'session', 'ledger'].includes(p) && st.remit.phase !== 'in' && st.remit.phase !== 'error' && st.remit.phase !== 'idle') { st.remit.phase = p; if (st.tab === 'remit') render() } })

  // ---------------- render ----------------
  function render () {
    loadAccounts()
    renderHeader()
    const main = $('main')
    const y = main.scrollTop
    const pages = { home: pageHome, new: pageNew, old: pageOld, mine: pageMine, remit: pageRemit }
    SD.html(main, (pages[st.tab] || pageHome)())
    if (st.tab === 'mine') mountMining(); else window.SCDOMining.MiningPage.unmount()
    main.scrollTop = y
    document.title = 'SCDO Wallet ' + APPVER
  }
  function mountMining () {
    const root = $('miningBatch1'); if (!root) { try { window.SCDOMining.MiningPage.unmount() } catch (e) {} return }
    window.SCDOMining.MiningPage.mount(root, { miner: st.miner, toast, rerender: () => { if (st.tab === 'mine' && !$('md') && !(document.activeElement && document.activeElement.id === 'poolUrl')) render() } })
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
      document.querySelectorAll('[data-bal]').forEach(el => { const b = st.s0[el.getAttribute('data-bal')]; if (b && b.nativeWei != null) SD.valueUnit(el, fmtWei(b.nativeWei), 'SCDO') })
    } else if (st.tab === 'old') {
      document.querySelectorAll('[data-oldbal]').forEach(el => { const v = st.old[el.getAttribute('data-oldbal')]; if (v != null) SD.valueUnit(el, fmtNum(v), 'SCDO') })
      const ot = oldTotal(shardFilter(visible('old'))); const e = $('oldTot'); if (e && ot.known) e.textContent = fmtNum(ot.v) + ' SCDO'
    }
  }
  // 2.0.6: mining status is always visible in the top bar (running / stopped, hashrate, pool)
  function poolLabel (m) {
    if (m.mode === 'pool' && m.poolUrl) return String(m.poolUrl).replace(/^[a-z0-9+]+:\/\//i, '')
    return T('poolLocal')
  }
  function minePillText (m) {
    m = m || {}
    if (m.phase === 'error') return { cls: 'bad', t: '⛏ ' + T('pillError') }
    if (!m.running) return { cls: '', t: '⛏ ' + T('pillStopped') }
    if (m.mode === 'node') return { cls: '', t: T('pillNode') }
    const hr = m.code === 'MINING' && m.hashrate > 0 ? ' · ' + fmtHash(m.hashrate) : ''
    return { cls: m.code === 'MINING' ? 'ok' : 'warn', t: '⛏ ' + (m.code === 'MINING' ? T('pillMining') : T('pillStarting')) + hr + ' · ' + T('poolLbl') + ' ' + poolLabel(m) }
  }
  function renderMinePill () {
    const e = $('minePill'); if (!e) return
    const shard0 = (st.miners && st.miners.shard0) || st.miner
    const x = minePillText(shard0 && shard0.chain === 'classic' ? null : shard0)
    const cpu = st.miners && st.miners.classicCpu && st.miners.classicCpu.running
    const gpu = st.miners && st.miners.classicGpu && st.miners.classicGpu.running
    if (cpu || gpu) {
      const bits = []
      if (cpu) bits.push(T('classicCpu'))
      if (gpu) bits.push(T('classicGpu'))
      x.t += ' · ' + bits.join(' · ')
      if (!shard0 || !shard0.running || shard0.chain === 'classic') x.cls = x.cls === 'bad' ? x.cls : 'ok'
    }
    e.className = 'minepill ' + x.cls; e.textContent = x.t; e.title = x.t
  }
  function renderHeaderNetOnly () {
    const d = document.querySelector('.netsel .dot'); if (!d) return
    const ok = ui.net === 'old' ? st.net.oldOk : st.net.s0Ok
    d.className = 'dot ' + (ok == null ? '' : ok ? 'ok' : 'bad')
  }
  function renderMinerLive () {
    if (st.tab !== 'mine' || $('md')) return
    st.miner = viewMiner()
    const m = st.miner || {}
    const e = $('minerStatus')
    const sig = [!!m.running, m.mode, m.chain, m.phase === 'error', m.phase === 'external', m.code === 'EXTERNAL_DOWN', m.code].join('|')
    const focusKeep = ['mReward', 'nPayout', 'mReward-in', 'nPayout-in', 'poolUrl', 'mClassic', 'mClassic-in', 'mThreads', 'mGpuThreads', 'mThreadBlocks', 'mBlockThreads']
    if (sig !== renderMinerLive.sig || (!e && !$('extOk'))) { renderMinerLive.sig = sig; if (!(document.activeElement && focusKeep.includes(document.activeElement.id))) render(); return }
    if (e) { e.className = 'statusbar ' + minerClass(m); e.textContent = minerText(m) }
    const set = (id, v) => { const x = $(id); if (x) x.textContent = v }
    set('mBlocks', (m.localBlock == null ? '–' : m.localBlock) + ' / ' + (m.networkBlock == null ? (st.net.s0Block == null ? '–' : st.net.s0Block) : m.networkBlock))
    set('mPeers', m.peers == null ? '–' : m.peers)
    if (m.running && (m.mode === 'mine' || m.mode === 'pool' || m.chain === 'classic')) set('mHr', m.hashrate != null ? fmtHash(m.hashrate) : '–')
    set('mFound', m.blocksFound || 0)
    if (m.chain === 'classic') {
      set('mAcc', (m.sharesAccepted || 0) + ' / ' + (m.sharesRejected || 0))
      const ps = m.poolStats || {}
      set('mPending', ps.pending == null ? '–' : String(ps.pending))
      set('mPaid', ps.paid == null ? '–' : String(ps.paid))
      const young = m.startedAt && (Date.now() - m.startedAt < 600000)
      set('mRate', m.blocksFound > 0 && !young && m.blockRatePerHour != null ? Number(m.blockRatePerHour).toFixed(2) : '–')
    }
    const ns = $('mNodeState'); if (ns) ns.textContent = nodeStateText(m)
    const lg = $('mLog'); if (lg && st.logOpen) { lg.textContent = window.SCDOMining.minerLogger.displayLines(m.logTail, 80).join('\n'); lg.scrollTop = lg.scrollHeight }
  }

  // ---------------- dropdowns ----------------
  function closeDd () { SD.clear($('ddRoot')) }
  function openDd (anchor, html, alignRight) {
    const r = anchor.getBoundingClientRect()
    // 1.1.4 fix: the click-away backdrop has its own class (.ddov, z-index below .dd). In 1.1.1-1.1.3 it reused the modal
    // .overlay (z-index 50 > .dd 40), so it covered the menu and every click on a menu item only closed the menu.
    SD.html($('ddRoot'), `<div class="ddov" data-act="ddClose"></div><div class="dd" id="dd" style="top:${Number(r.bottom + 8)}px;${alignRight ? 'right:' + Number(Math.max(10, window.innerWidth - r.right)) + 'px' : 'left:' + Number(r.left) + 'px'};min-width:${Number(Math.max(r.width, 320))}px;max-width:760px">${html}</div>`)
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
    SD.html($('modalRoot'), `<div class="overlay" id="ov"><div class="modal" id="md" style="${opts.width ? 'width:' + Number(opts.width) + 'px' : ''}">${html}</div></div>`)
    const first = $('md').querySelector('input:not([type=checkbox]):not([disabled])'); if (first && !opts.noFocus) setTimeout(() => first.focus(), 30)
  }
  function closeModal () { SD.clear($('modalRoot')); render() }
  function confirmBox (title, text, yes, no, danger) {
    return new Promise(resolve => {
      modal(`<div class="mh"><h2>${esc(title)}</h2></div><div style="font-size:20px;white-space:pre-line">${esc(text)}</div>
        <div class="foot"><button class="btn ghost" id="cbNo">${esc(no || T('cancel'))}</button><button class="btn ${danger ? 'dan' : 'pri'}" id="cbYes">${esc(yes || T('yes'))}</button></div>`, { width: 600 })
      $('cbNo').onclick = () => { SD.clear($('modalRoot')); resolve(false) }
      $('cbYes').onclick = () => { SD.clear($('modalRoot')); resolve(true) }
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
  // 2.0.1 (P0 #1): SCDO Shard0 (EVM) send = address -> amount -> CONFIRM SCREEN -> status.
  // The main process validates the address (format, EIP-55 checksum, classic/zero address = blocked; self, contract,
  // no checksum = warnings), re-checks chain ID 5680, estimates fee + total, and parks the reviewed parameters under a
  // one-time token. Nothing is signed until the user presses Confirm on the confirm screen (with the keyfile password);
  // the keyfile is decrypted and the transaction signed in the main process, for exactly the reviewed parameters.
  // 2.0.10: full-width IME digits/letters -> half-width before address/amount/key checks
  const nhw = (s) => (typeof window.normalizeHalfWidth === 'function' ? window.normalizeHalfWidth(s) : String(s == null ? '' : s).normalize('NFKC').replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '').trim())
  const ADDR_ERR = { FORMAT: 'errAddr', CHECKSUM: 'errChecksum', CLASSIC_ADDR: 'errOldAddrToNew', ZERO_ADDR: 'errZeroAddr' }
  const ADDR_WARN = { SELF: 'warnSelf', CONTRACT: 'warnContract', TOKEN_CONTRACT: 'warnTokenContract', NO_CHECKSUM: 'warnNoChecksum', CONTRACT_UNKNOWN: 'warnContractUnknown' }
  const SEND_ERR = { INSUFFICIENT: 'errTooMuch', NO_FEE_BALANCE: 'errNoFeeBal', WRONG_PASSWORD: 'wrongPw', REVIEW_EXPIRED: 'errReviewExpired', WRONG_CHAIN: 'errWrongChain', BAD_AMOUNT: 'errAmount', ADDRESS_CHANGED: 'errAddr', NO_PASSWORD: 'errPw', NONCE_BUSY: 'errNonceBusy', NETWORK: 'errNetwork', BROADCAST_TIMEOUT: 'errBcastTimeout', NONCE_READ: 'errNetwork', REPLACED: 'errReplaced' }
  function sendModal (f) {
    const a = accByFile(f); if (!a || !a.evm) return
    const s = { asset: 'SCDO', to: '', amount: '', fee: null, check: null, review: null }
    api.invoke('s0:balances', a.evm).then(r => { st.s0[a.filename] = balFromIpc(r) }).catch(() => {}) // 2.0.2 D-07: fresh balance for 'Available' when the modal opens
    const dec = () => { if (s.asset === 'SCDO') return 18; const t = (S0CFG.tokens || []).find(x => x.symbol === s.asset); return t ? t.decimals : 18 }
    const bal = () => { const b = st.s0[a.filename] || {}; if (s.asset === 'SCDO') return { wei: b.nativeWei, dec: 18 }; const t = (b.tokens || []).find(x => x.symbol === s.asset); return { raw: t && t.raw, dec: t ? t.decimals : dec(), t } }
    const balText = () => { const b = bal(); if (s.asset === 'SCDO') return b.wei != null ? fmtWei(b.wei) + ' SCDO' : '…'; return b.t && b.t.balance != null ? fmtNum(b.t.balance, b.dec) + ' ' + s.asset : '…' }
    const head = (i) => `<div class="mh"><h2>${esc(T('sendTitle'))}</h2>${stepsHtml(i)}</div>`
    const fromLine = `<div class="infobox"><div class="lbl">${esc(T('from'))}</div><b class="wrap">${esc(accLabel(a))}</b><div class="mono">${esc(a.evm)}</div></div>`
    const netLine = `<div class="lbl" id="sNet">${esc(T('network'))}${PU.c()}<b>SCDO Shard0 (EVM)</b> · ${esc(T('chainIdN', { n: S0CFG.chainId }))}</div>`
    const cancelReview = () => { if (s.review && s.review.token) api.invoke('s0:cancelReview', s.review.token); s.review = null }
    function step1 () {
      modal(`${head(0)}${fromLine}${netLine}
        <div class="field"><div class="lbl">${esc(T('asset'))}</div>${assetPickerHtml(a, s.asset)}</div>
        <div class="field"><div class="lbl">${esc(T('to'))}</div><input class="inp mono" id="sTo" placeholder="${esc(T('toPh'))}" value="${esc(s.to)}" autocomplete="off" spellcheck="false" inputmode="latin" autocapitalize="off" lang="en"></div>
        <div class="err" id="sErr"></div><div class="warnbox" id="sWarn" style="display:none"></div>
        <div class="foot"><button class="btn ghost" data-act="closeModal" id="sCancel">${esc(T('cancel'))}</button><button class="btn pri" id="sNext">${esc(T('next'))}</button></div>`)
      wireAssetPicker(a, () => s.asset, (v) => { s.to = nhw($('sTo').value); s.asset = v; s.amount = ''; s.fee = null; step1() })
      const go = async () => {
        const to = nhw($('sTo').value); if ($('sTo')) $('sTo').value = to
        $('sErr').textContent = ''; SD.spin($('sErr'), T('checkingAddr')); $('sNext').disabled = true
        let chk
        try { chk = await api.invoke('s0:checkAddress', a.evm, to, s.asset) } catch (e) { chk = { ok: false, errors: ['FORMAT'] } }
        if (!$('sNext')) return
        $('sNext').disabled = false; $('sErr').textContent = ''
        if (!chk.ok) { $('sErr').textContent = T(ADDR_ERR[chk.errors[0]] || 'errAddr'); return }
        s.to = chk.address; s.check = chk; step2()
      }
      $('sNext').onclick = go; $('sTo').onkeydown = (e) => { if (e.key === 'Enter') go() }
    }
    async function estimate () {
      try { const f = await api.invoke('s0:estimate', a.evm, s.to, s.amount && Number(s.amount) > 0 ? s.amount : '0', s.asset); s.fee = f ? { estFeeWei: BigInt(f.estFeeWei), maxFeeWei: BigInt(f.maxFeeWei) } : null } catch (e) { s.fee = null }
      return s.fee
    }
    function feeText (fee) { fee = fee || s.fee; return fee ? T('feeAbout', { v: fmtWei(fee.estFeeWei, 8) }) + PU.l() + T('feeMax', { v: fmtWei(fee.maxFeeWei, 8) }) + PU.r() : '…' }
    function step2 () {
      modal(`${head(1)}<div class="infobox"><div class="lbl">${esc(T('to'))}</div><div class="mono" style="font-size:19px">${esc(s.to)}</div></div>${netLine}
        <div class="field"><div class="lbl">${esc(T('asset'))}</div>${assetPickerHtml(a, s.asset)}</div>
        <div class="field"><div class="row"><div class="lbl" style="flex:1">${esc(T('amount'))}${PU.l()}${esc(s.asset)}${PU.r()}</div><div class="lbl">${esc(T('available', { v: balText() }))}</div></div>
        <div class="row"><input class="inp" id="sAmt" inputmode="decimal" placeholder="0.0" value="${esc(s.amount)}" style="font-size:28px;height:62px" autocomplete="off" spellcheck="false" lang="en"><button class="btn sec" id="sMax" style="height:62px">${esc(T('max'))}</button></div></div>
        <div class="field"><div class="lbl">${esc(T('fee'))}</div><div id="sFee" style="font-size:19px">${esc(feeText())}</div></div>
        <div class="err" id="sErr"></div>
        <div class="foot"><button class="btn ghost" data-act="closeModal">${esc(T('cancel'))}</button><button class="btn ghost" id="sBack">${esc(T('back'))}</button><button class="btn pri" id="sNext">${esc(T('reviewBtn'))}</button></div>`)
      estimate().then(() => { const e = $('sFee'); if (e) e.textContent = feeText() })
      wireAssetPicker(a, () => s.asset, (v) => { s.asset = v; s.amount = ''; s.fee = null; step2() })
      $('sBack').onclick = () => { s.amount = nhw($('sAmt').value); step1() }
      $('sMax').onclick = async () => {
        const b = bal()
        if (s.asset === 'SCDO') {
          if (b.wei == null) return
          const fee = (await estimate()) || { maxFeeWei: 0n }
          let v = b.wei - fee.maxFeeWei; if (v < 0n) v = 0n
          $('sAmt').value = formatEther(v)
        } else if (b.raw != null) $('sAmt').value = formatUnits(b.raw, b.dec)
        const e = $('sFee'); if (e) e.textContent = feeText()
      }
      const go = async () => {
        const v = nhw($('sAmt').value).replace(/,/g, ''); if ($('sAmt')) $('sAmt').value = v
        try { if (parseUnits(v, dec()) <= 0n) throw new Error('x') } catch (e) { $('sErr').textContent = T('errAmount'); return }
        s.amount = v
        $('sNext').disabled = true; SD.spin($('sErr'), T('preparingReview'))
        let r
        try { r = await api.invoke('s0:review', { file: a.filename, to: s.to, amount: s.amount, asset: s.asset }) } catch (e) { r = { ok: false, error: e.message } }
        if (!$('sNext')) { if (r && r.token) api.invoke('s0:cancelReview', r.token); return }
        $('sNext').disabled = false; $('sErr').textContent = ''
        if (r.check && !r.check.ok) { $('sErr').textContent = T(ADDR_ERR[r.check.errors[0]] || 'errAddr'); return }
        if (!r.ok) { $('sErr').textContent = r.errors && r.errors.length ? T(SEND_ERR[r.errors[0]] || 'errAmount') : (SEND_ERR[r.error] ? T(SEND_ERR[r.error]) : T('errReview', { e: r.error || '?' })); return }
        s.review = r; step3()
      }
      $('sNext').onclick = go; $('sAmt').onkeydown = (e) => { if (e.key === 'Enter') go() }
    }
    // the confirm screen
    function step3 () {
      const r = s.review
      const fee = { estFeeWei: BigInt(r.fee.estFeeWei), maxFeeWei: BigInt(r.fee.maxFeeWei) }
      const warns = (r.check.warnings || []).filter(w => ADDR_WARN[w])
      const total = r.totalEstWei ? fmtNum(formatEther(r.totalEstWei), 8) + ' SCDO' + PU.l() + T('feeMax', { v: fmtNum(formatEther(r.totalMaxWei), 8) }) + PU.r() : fmtNum(r.amount, 18) + ' ' + r.asset + ' + ' + T('feeAbout', { v: fmtWei(fee.estFeeWei, 8) })
      modal(`<div class="mh"><h2>${esc(T('confirmTitle'))}</h2>${stepsHtml(2)}</div><div class="review" id="sReview">
        <div class="r"><div class="k">${esc(T('network'))}</div><div class="v" id="cfNet">SCDO Shard0 (EVM) · ${esc(T('chainIdN', { n: r.network.chainId }))}</div></div>
        <div class="r"><div class="k">${esc(T('from'))}</div><div class="v"><div class="wrap">${esc(accLabel(a))}</div><div class="mono" style="font-weight:400;font-size:17px">${esc(r.from)}</div></div></div>
        <div class="r"><div class="k">${esc(T('to'))}</div><div class="v"><div class="mono" style="font-size:19px" id="cfTo">${esc(r.to)}</div><div class="lbl" style="color:#146c2e">✔ ${esc(T(r.check.warnings.includes('NO_CHECKSUM') ? 'addrOkNoChecksum' : 'addrOkChecksum'))}</div></div></div>
        <div class="r"><div class="k">${esc(T('amount'))}</div><div class="v" style="font-size:28px;color:#43A047" id="cfAmt">${esc(fmtNum(r.amount, 18))} ${esc(r.asset)}</div></div>
        <div class="r"><div class="k">${esc(T('fee'))}</div><div class="v" style="font-weight:400" id="cfFee">${esc(feeText(fee))}</div></div>
        <div class="r"><div class="k">${esc(T('total'))}</div><div class="v" id="cfTotal">${esc(total)}</div></div></div>
        ${warns.map(w => `<div class="warnbox" data-warn="${esc(w)}">⚠ ${esc(T(ADDR_WARN[w]))}</div>`).join('')}
        ${warns.length ? `<label class="chk" style="display:flex;gap:10px;align-items:center;font-size:19px;margin-top:10px;cursor:pointer"><input type="checkbox" id="sAck" style="width:22px;height:22px"> ${esc(T('ackWarnings'))}</label>` : ''}
        <div class="infobox">⚠ ${esc(T('reviewNote'))}</div>
        <div class="field"><div class="lbl">${esc(T('password'))}</div><input class="inp" type="password" id="sPw" autocomplete="off"></div>
        <div class="err" id="sErr"></div>
        <div class="foot"><button class="btn ghost" id="sCancel">${esc(T('cancel'))}</button><button class="btn ghost" id="sBack">${esc(T('back'))}</button><button class="btn pri" id="sGo" ${warns.length ? 'disabled' : ''}>${esc(T('confirmSend'))}</button></div>`)
      const ack = $('sAck'); if (ack) ack.onchange = () => { $('sGo').disabled = !ack.checked }
      $('sCancel').onclick = () => { cancelReview(); closeModal(); toast(T('sendCanceled')) }
      $('sBack').onclick = () => { cancelReview(); step2() }
      const go = async () => {
        if (ack && !ack.checked) { $('sErr').textContent = T('ackWarnings'); return }
        const pw = $('sPw').value; if (!pw) { $('sErr').textContent = T('errPw'); return }
        $('sGo').disabled = true; $('sBack').disabled = true; $('sCancel').disabled = true; SD.spin($('sErr'), T('sending'))
        $('sPw').value = ''
        let res
        try { res = await api.invoke('s0:send', { token: r.token, password: pw }) } catch (e) { res = { ok: false, error: e.message } }
        if (res && res.ok) { s.review = null; loadActivity(a.evm); step4(res.hash); return }
        if (res && res.error === 'BROADCAST_TIMEOUT' && res.hash) { s.review = null; loadActivity(a.evm); step4(res.hash, T('errBcastTimeout')); return } // rerun N-3: outcome unknown -> Pending, keep checking
        if (res && res.error === 'WRONG_PASSWORD') {
          // the token is single-use: build a fresh review so the user can retry with the right password
          try { const r2 = await api.invoke('s0:review', { file: a.filename, to: s.to, amount: s.amount, asset: s.asset }); if (r2 && r2.ok) { s.review = r2; step3(); $('sErr').textContent = T('wrongPw'); return } } catch (e) {}
        }
        if ($('sErr')) { $('sErr').textContent = T('sendFailedPrefix') + ' ' + (SEND_ERR[res && res.error] ? T(SEND_ERR[res.error]) : String((res && res.error) || 'error')); $('sBack').disabled = false; $('sCancel').disabled = false }
        loadActivity(a.evm) // rerun N-3: the failed attempt is listed in Activity as Failed
      }
      $('sGo').onclick = go; $('sPw').onkeydown = (e) => { if (e.key === 'Enter' && !$('sGo').disabled) go() }
    }
    function step4 (hash, note) {
      modal(`${head(3)}<div class="statusbar warn" id="sStat" style="font-size:24px"><span class="spin"></span> ${esc(T('waiting'))}</div>${note ? `<div class="err" style="margin-top:8px">${esc(note)}</div>` : ''}
        <div class="field"><div class="lbl">${esc(T('txHash'))}</div><div class="mono" style="font-size:17px">${esc(hash)}</div></div>
        <div style="margin-top:10px"><button class="link" data-act="openTx" data-v="${esc(hash)}">${esc(T('openExplorer'))} →</button></div>
        <div class="foot"><button class="btn pri" data-act="closeModal">${esc(T('done'))}</button></div>`, { noFocus: true })
      const notYet = () => { const e = $('sStat'); if (e) { e.className = 'statusbar warn'; e.textContent = T('notConfirmedYet') } loadActivity(a.evm) }
      api.invoke('s0:waitReceipt', hash).then(rc => {
        if (rc && rc.timeout) { notYet(); return }
        const e = $('sStat'); if (e) { e.className = 'statusbar ' + (rc.ok ? 'good' : 'bad'); e.textContent = rc.ok ? '✅ ' + T('confirmed', { n: rc.block }) : '❌ ' + T('failed') }
        loadActivity(a.evm); refreshS0()
      }).catch(notYet)
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
        <div class="field"><div class="lbl">${esc(T('to'))}</div><input class="inp mono" id="sTo" placeholder="${esc(T('toPhOld', { n: a.shard }))}" value="${esc(s.to)}" autocomplete="off" spellcheck="false" inputmode="latin" autocapitalize="off" lang="en"></div>
        <div class="err" id="sErr"></div>
        <div class="foot"><button class="btn ghost" data-act="closeModal">${esc(T('cancel'))}</button><button class="btn pri" id="sNext">${esc(T('next'))}</button></div>`)
      const go = () => {
        const to = nhw($('sTo').value); if ($('sTo')) $('sTo').value = to
        if (!/^[1-4]S[0-9a-fA-F]{40}$/.test(to)) { $('sErr').textContent = T('errAddrOld'); return }
        if (String(to[0]) !== String(a.shard) && !CFG.allowCrossShard) { $('sErr').textContent = T('errCross', { n: a.shard }); return }
        if (to.toLowerCase() === a.pubkey.toLowerCase()) { $('sErr').textContent = T('errSelf'); return }
        s.to = to
        api.invoke('old:estimateGas', a.pubkey, to).then(g => { if (g) s.gas = Number(g); const e = $('sFee'); if (e) e.textContent = feeLine() }).catch(() => {})
        step2()
      }
      $('sNext').onclick = go; $('sTo').onkeydown = (e) => { if (e.key === 'Enter') go() }
    }
    function step2 () {
      const b = balV()
      modal(`${head(1)}<div class="infobox"><div class="lbl">${esc(T('to'))}</div><div class="mono">${esc(s.to)}</div></div>
        <div class="field"><div class="row"><div class="lbl" style="flex:1">${esc(T('amount'))}${PU.l()}SCDO${PU.r()}</div><div class="lbl">${esc(T('available', { v: b == null ? '…' : fmtNum(b) + ' SCDO' }))}</div></div>
        <div class="row"><input class="inp" id="sAmt" inputmode="decimal" placeholder="0.0" value="${esc(s.amount)}" style="font-size:28px;height:62px" autocomplete="off" spellcheck="false" lang="en"><button class="btn sec" id="sMax" style="height:62px">${esc(T('max'))}</button></div></div>
        <div class="field"><div class="lbl">${esc(T('fee'))}</div><div id="sFee" style="font-size:19px">${esc(feeLine())}</div></div>
        <div class="err" id="sErr"></div>
        <div class="foot"><button class="btn ghost" id="sBack">${esc(T('back'))}</button><button class="btn pri" id="sNext">${esc(T('next'))}</button></div>`)
      $('sBack').onclick = () => { s.amount = nhw($('sAmt').value); step1() }
      $('sMax').onclick = () => { const bb = balV(); if (bb == null) return; const v = Math.max(0, bb - (feeScdo() || 0.00021)); $('sAmt').value = String(Math.floor(v * 1e8) / 1e8) }
      const go = () => {
        const v = nhw($('sAmt').value).replace(/,/g, ''); if ($('sAmt')) $('sAmt').value = v
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
        <div class="r"><div class="k">${esc(T('amount'))}</div><div class="v" style="font-size:28px;color:#43A047">${esc(fmtNum(s.amount, 8))} SCDO</div></div>
        <div class="r"><div class="k">${esc(T('fee'))}</div><div class="v" style="font-weight:400">${esc(feeLine())}</div></div></div>
        <div class="infobox">⚠ ${esc(T('reviewNote'))}</div>
        <div class="field"><div class="lbl">${esc(T('password'))}</div><input class="inp" type="password" id="sPw"></div>
        <div class="err" id="sErr"></div>
        <div class="foot"><button class="btn ghost" id="sBack">${esc(T('back'))}</button><button class="btn pri" id="sGo">${esc(T('confirmSend'))}</button></div>`)
      $('sBack').onclick = step2
      const go = () => {
        const pw = $('sPw').value; if (!pw) { $('sErr').textContent = T('errPw'); return }
        $('sGo').disabled = true; SD.spin($('sErr'), T('sending'))
        $('sPw').value = ''
        api.invoke('old:send', { file: a.filename, password: pw, to: s.to, amount: s.amount, price: s.price, gas: s.gas || 21000 }).then(res => {
          if (!res || !res.ok) { const em = String((res && res.error) || 'error'); if ($('sErr')) { $('sErr').textContent = em === 'WRONG_PASSWORD' ? T('wrongPw') : em; $('sGo').disabled = false } return }
          const hash = res.hash
          modal(`${head(3)}<div class="statusbar good" style="font-size:22px">✅ ${esc(T('sentOld'))}</div>
            <div class="field"><div class="lbl">${esc(T('txHash'))}</div><div class="mono" style="font-size:17px">${esc(hash)}</div></div>
            <div class="foot"><button class="btn pri" data-act="closeModal">${esc(T('done'))}</button></div>`, { noFocus: true })
          refreshOld()
        })
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
        <div class="field"><div class="lbl">${esc(T('createPriv'))}</div><input class="inp mono" id="cPriv" type="password" placeholder="0x…" autocomplete="off" spellcheck="false" inputmode="latin" autocapitalize="off" lang="en"></div></details>
      <div class="infobox">${esc(T('createSave'))}</div>
      <div class="err" id="cErr"></div>
      <div class="foot"><button class="btn ghost" data-act="closeModal">${esc(T('cancel'))}</button><button class="btn pri" id="cGo">${esc(T('create'))}</button></div>`)
    $('cGo').onclick = async () => {
      const name = $('cName').value.trim(); const pw = $('cPw1').value; const pw2 = $('cPw2').value
      const shard = ($('cShard').value.trim() || '1'); let priv = nhw($('cPriv').value); if ($('cPriv')) $('cPriv').value = priv
      const errs = []
      if (name.length > 40 || /[\\/:*?"<>|\u0000-\u001f]/.test(name)) errs.push(T('errName'))
      if (!/(?=.*[0-9])(?=.*[A-Z])(?=.*[a-z])(?=.*[^a-zA-Z0-9]).{8,15}/.test(pw)) errs.push(T('pwRule'))
      if (pw !== pw2) errs.push(T('pwMismatch'))
      if (!/^[1-4]$/.test(shard)) errs.push(T('errShard'))
      if (priv) { if (/^[0-9a-fA-F]{64}$/.test(priv)) priv = '0x' + priv; priv = priv.toLowerCase(); if (!/^0x[0-9a-f]{64}$/.test(priv)) errs.push(T('errKey')) }
      if (errs.length) { $('cErr').textContent = errs.join(PU.bar()); return }
      $('cGo').disabled = true; SD.spin($('cErr'), '')
      const no = name ? 0 : nextNo()
      const CERR = { EXISTS: 'errExist', BAD_KEY: 'errKey', BAD_NAME: 'errName', BAD_PASSWORD: 'pwRule', BAD_SHARD: 'errShard' }
      $('cPriv').value = ''; $('cPw1').value = ''; $('cPw2').value = ''
      const r = await api.invoke('acct:create', { name, password: pw, shard, priv, no })
      priv = null
      if (!r || !r.ok) { if ($('cErr')) { $('cErr').textContent = T(CERR[r && r.error] || 'errKey'); $('cGo').disabled = false } return }
      const file = r.file
      if (name) ui.names[file] = name; else ui.accNo[file] = no
      saveUi()
      st.sel = file; localStorage.setItem('selAcc112', file)
      await reloadAccounts()
      closeModal(); toast(T('createOk')); refreshS0(); refreshOld()
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
      else { delete ui.names[f]; if (needsNo(f)) { if (!ui.accNo[f]) ui.accNo[f] = nextNo() } else delete ui.accNo[f] } // empty = default: file name, or 帳戶 N for unnamed files
      saveUi(); closeModal(); toast(T('renameOk')); render()
    }
    $('rnGo').onclick = go; $('rnName').onkeydown = (e) => { if (e.key === 'Enter') go() }
    setTimeout(() => { const i = $('rnName'); if (i) { i.focus(); i.select() } }, 30)
  }
  async function useOtherAddr (id) {
    const inp = $(id + '-in'); const raw = id === 'mClassic' ? miningInput(inp ? inp.value : '') : nhw(inp ? inp.value : ''); if (inp) inp.value = raw
    if (id === 'mClassic') {
      const p = parseClassicAddress(raw)
      const shard = Number(st.mineShard)
      if (!p || p.shard !== shard) { toast(T('errClassicAddr'), 5000); return }
      ui.classicExtra = ui.classicExtra || []
      if (!ui.classicExtra.includes(p.address)) ui.classicExtra.push(p.address)
      saveUi()
      localStorage.setItem('minerClassic', p.address)
      if (st.otherOpen) st.otherOpen[id] = false
      toast('✔ ' + p.address); render(); return
    }
    let addr = ''
    try { const c = await api.invoke('s0:checkAddress', '', raw, 'SCDO'); addr = c && c.ok ? c.address : '' } catch (e) { addr = '' }
    if (!addr || /^0x0{40}$/.test(addr)) { toast(T('errRewardAddr'), 5000); return }
    if (!ui.rewardExtra.some(x => x.toLowerCase() === addr.toLowerCase())) ui.rewardExtra.push(addr)
    saveUi()
    localStorage.setItem(id === 'mReward' ? 'minerReward' : 'nodePayout', addr)
    if (st.otherOpen) st.otherOpen[id] = false
    toast('✔ ' + addr); render()
  }
  async function importKeyfiles () {
    const r = await api.invoke('acct:import') // the main process shows the file dialog, validates and copies
    if (!r || r.canceled) return
    for (const x of r.results) {
      if (x.ok) toast(T('importOk', { n: x.name }))
      else toast(x.code === 'FORMAT' ? T('importFail', { n: x.name }) : x.code === 'NAME_EXISTS' ? T('errNameExist') + PU.c() + x.name : x.code === 'EXISTS' ? T('errExist') + PU.c() + x.name : String(x.error || x.code), 6000)
    }
    await reloadAccounts()
    render(); refreshOld()
  }

  async function unlock (f, inputId) {
    const inp = $(inputId); const pw = inp ? inp.value : ''
    if (!pw) { toast(T('errPw')); return }
    toast('…', 20000)
    if (inp) inp.value = ''
    const r = await api.invoke('acct:unlock', f, pw)
    if (r && r.ok) { toast('✔'); await reloadAccounts(); render(); refreshS0() } else toast(T('wrongPw'))
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
    const paths = await api.invoke('keyfile:paths')
    const s0b = st.s0[a.filename]; const oldb = st.old[a.pubkey]
    const nonZero = (s0b && s0b.nativeWei != null && s0b.nativeWei > 0n) || (s0b && (s0b.tokens || []).some(t => t.raw != null && t.raw > 0n)) || (oldb != null && oldb > 0)
    const balLine = `${esc(T('s0Short'))}${PU.c()}${s0b && s0b.nativeWei != null ? esc(fmtWei(s0b.nativeWei)) + ' SCDO' : '?'}${PU.bar()}${esc(T('classicShort'))}${PU.c()}${oldb != null ? esc(fmtNum(oldb)) + ' SCDO' : '?'}`
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
      $('dNext').disabled = true; SD.spin($('dErr'), T('delChecking'))
      const ur = await api.invoke('acct:unlock', a.filename, pw)
      if (!ur || !ur.ok) { $('dErr').textContent = T('wrongPw'); upd(); return }
      $('dPw').value = ''
      await reloadAccounts(); const a2 = accByFile(f) || a
      // fresh balances on both chains before the final confirm
      let fresh0 = null; let freshOld = null
      try { if (a2.evm) fresh0 = balFromIpc(await Promise.race([api.invoke('s0:balances', a2.evm), new Promise((resolve, reject) => setTimeout(() => reject(new Error('timeout')), 15000))])) } catch (e) {}
      try { freshOld = await Promise.race([api.invoke('old:balance', a2.pubkey, a2.shard), new Promise(resolve => setTimeout(() => resolve(null), 15000))]) } catch (e) {}
      if (fresh0) st.s0[a2.filename] = fresh0
      if (freshOld != null) st.old[a2.pubkey] = freshOld
      const has = (fresh0 && (fresh0.nativeWei > 0n || fresh0.tokens.some(t => t.raw != null && t.raw > 0n))) || (freshOld != null && freshOld > 0)
      const tokLine = fresh0 ? fresh0.tokens.filter(t => t.raw != null && t.raw > 0n).map(t => fmtNum(t.balance) + ' ' + t.symbol).join(PU.com()) : ''
      modal(`<div class="mh"><h2 style="color:#c62828">${esc(T('delConfirmTitle'))}</h2></div>
        <div style="font-size:21px" class="wrap">${esc(T('delConfirmText', { n: accLabel(a2) }))}</div>
        <div class="infobox" style="font-size:19px">${esc(T('s0Short'))}${PU.c()}${fresh0 ? esc(fmtWei(fresh0.nativeWei)) + ' SCDO' + (tokLine ? PU.com() + esc(tokLine) : '') : '? (' + esc(T('balUnknown')) + ')'}<br>${esc(T('classicShort'))}${PU.c()}${freshOld != null ? esc(fmtNum(freshOld)) + ' SCDO' : '? (' + esc(T('balUnknown')) + ')'}</div>
        ${has ? `<div class="warnbox" style="background:#fdecec;border-color:#e53935;color:#b71c1c;font-weight:700;font-size:20px">⚠ ${esc(T('delHasBal'))}</div>` : ''}
        <div class="infobox">${esc(T('delBackup'))}<div class="mono" style="font-size:16px">${esc(paths.today)}</div></div>
        <div class="err" id="dErr"></div>
        <div class="foot"><button class="btn ghost" data-act="closeModal">${esc(T('cancel'))}</button><button class="btn dan" id="dGo">${esc(T('delConfirmBtn'))}</button></div>`, { width: 760, noFocus: true })
      $('dGo').onclick = async () => {
        $('dGo').disabled = true; SD.spin($('dErr'), T('delBacking'))
        const r = await api.invoke('keyfile:backupDelete', a2.filename)
        if (!r || !r.ok) {
          $('dErr').textContent = r && r.stage === 'delete' ? T('delFailDelete', { p: r.backup || '', e: r.error || '' }) : T('delFailBackup', { e: (r && r.error) || '?' })
          return
        }
        ui.hidden.new = ui.hidden.new.filter(x => x !== a2.filename); ui.hidden.old = ui.hidden.old.filter(x => x !== a2.filename); saveUi()
        delete st.s0[a2.filename]
        if (st.sel === a2.filename) { st.sel = ''; localStorage.setItem('selAcc112', '') }
        await reloadAccounts()
        SD.clear($('modalRoot'))
        modal(`<div class="mh"><h2>✅ ${esc(T('delDone'))}</h2></div><div style="font-size:19px">${esc(T('delDoneText'))}</div>
          <div class="addrbox mono" style="font-size:16px">${esc(r.backup)}</div>
          <div class="foot"><button class="btn sec" data-act="openBackups">${esc(T('openBackups'))}</button><button class="btn pri" data-act="closeModal">${esc(T('done'))}</button></div>`, { width: 760, noFocus: true })
      }
    }
  }

  async function setLangUi (v, fromHdr) {
    const want = v === 'CN' ? 'CN' : 'EN'
    if (fromHdr && want === LANG) return
    const wasSettings = !!($('md') && $('setAbout'))
    let r = null
    try { r = await api.invoke('wallet:setLang', want) } catch (e) { r = { ok: false, error: e.message } }
    if (!r || !r.ok) { toast((r && r.error) || 'language not saved', 6000); return }
    LANG = r.lang === 'CN' ? 'CN' : 'EN'
    applyLangAttr()
    try { api.invoke('app:titles') } catch (e) {}
    if ($('md')) SD.clear($('modalRoot'))
    render(); if (!fromHdr || wasSettings) settingsModal()
  }
  // 2.0.5: release notes in Settings > About (latest 3 versions, older ones behind an expander)
  function relNotesHtml () {
    const N = (window.I18N112[lang()] || {}).relNotes || window.I18N112.EN.relNotes || []
    const one = (n) => `<div class="rn"><div class="rnv">${esc(n.v)}</div><ul>${n.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul></div>`
    let h = N.slice(0, 3).map(one).join('')
    if (N.length > 3) h += `<details class="rnmore" id="rnMore"><summary>${esc(T('earlierVersions'))}</summary>${N.slice(3).map(one).join('')}</details>`
    return h
  }
  // ----- settings (gear): language, accounts, backup/export, advanced, about -----
  async function settingsModal () {
    const paths = await api.invoke('keyfile:paths')
    const nHid = new Set(ui.hidden.new.concat(ui.hidden.old)).size
    const cfg = CFG
    // 2.0.7: mining notification toggles (P1) and update channel (P3) from the main-process settings store
    let nt = null; let chan = 'stable'
    try { nt = await api.invoke('notify:get') } catch (e) {}
    try { chan = ((await api.invoke('update:getChannel')) || {}).channel || 'stable' } catch (e) {}
    const NT_TYPES = ['firstShare', 'payout', 'hashZero', 'stopNonUser', 'nodeBehind']
    const notifyHtml = nt && nt.config ? `<div class="setsec" id="setNotify"><div class="sh">${esc(T('notifyTitle'))}</div><div class="lbl">${esc(T('notifyHint'))}</div>
      ${NT_TYPES.map(t => `<div style="margin-top:8px"><button class="toggle" data-act="notifyToggle" data-v="${t}" id="nt-${t}"><span class="sw ${nt.config[t] ? 'on' : ''}"></span>${esc((nt.labels || {})[t] || t)}</button></div>`).join('')}</div>` : ''
    const rpcs = (cfg.connect || []).map((u, i) => `<div class="row" style="font-size:16px"><b style="width:120px">${i === 0 ? esc(T('netNewShort')) : esc(T('shardN', { n: i }))}</b><span class="mono">${esc(u)}</span></div>`).join('')
    modal(`<div class="mh"><h2>⚙ ${esc(T('settings'))}</h2><button class="btn ghost small" data-act="closeModal">✕</button></div>
      <div class="setsec"><div class="sh">${esc(T('setLang'))}</div><div class="row" style="flex-wrap:wrap">
        <button class="btn ${lang() === 'EN' ? 'pri' : 'ghost'}" data-act="setLang" data-v="EN">English</button><button class="btn ${lang() === 'CN' ? 'pri' : 'ghost'}" data-act="setLang" data-v="CN">繁體中文</button></div></div>
      <div class="setsec"><div class="sh">${esc(T('accounts'))}</div><div class="row" style="flex-wrap:wrap">
        <button class="btn ghost" data-act="toggleHidden">${esc(ui.showHidden ? T('hideHidden') : T('showHidden', { n: nHid }))}</button>
        <button class="btn ghost" data-act="create">＋ ${esc(T('createTitle'))}</button><button class="btn ghost" data-act="import">⤓ ${esc(T('importAccount'))}</button></div></div>
      <div class="setsec"><div class="sh">${esc(T('backupExport'))}</div><div class="lbl">${esc(T('backupHint'))}</div><div class="row" style="flex-wrap:wrap;margin-top:8px">
        <button class="btn ghost" data-act="backupPick">${esc(T('backupKeyfile'))}</button><button class="btn ghost" data-act="openBackups">${esc(T('openBackups'))}</button></div>
        <div class="lbl" style="margin-top:8px">${esc(T('keyfileDir'))}${PU.c()}<span class="mono">${esc(paths.keyfileDir)}</span></div>
        <div class="lbl">${esc(T('backupDir'))}${PU.c()}<span class="mono">${esc(paths.backupRoot)}</span></div></div>
      <details class="setsec"><summary class="sh" style="cursor:pointer">${esc(T('advanced'))}</summary><div class="lbl">${esc(T('rpcList'))}</div>${rpcs}
        <div class="lbl" style="margin-top:6px">${esc(T('rpcHint'))}</div></details>
      ${notifyHtml}
      <div class="setsec"><div class="sh">${esc(T('updTitle'))}</div>
        <div class="lbl">${esc(T('updCurrent'))}${PU.c()}SCDO Wallet ${esc(APPVER)}</div>
        <div class="lbl" style="margin-top:10px;font-weight:600">${esc(T('chanTitle'))}</div><div class="row" id="chanRow" style="flex-wrap:wrap;margin-top:6px">
          <button class="btn ${chan === 'stable' ? 'pri' : 'ghost'}" data-act="setChannel" data-v="stable" id="chanStable">${esc(T('chanStable'))}</button><button class="btn ${chan === 'beta' ? 'pri' : 'ghost'}" data-act="setChannel" data-v="beta" id="chanBeta">${esc(T('chanBeta'))}</button></div>
        <div class="lbl" style="margin-top:6px">${esc(T('chanHint'))}</div>
        <div class="row" style="flex-wrap:wrap;margin-top:8px">
          <button class="btn ghost" data-act="checkUpdate">${esc(T('updCheck'))}</button>
          <span id="updState" class="lbl" style="margin-left:10px;align-self:center"></span></div></div>
      <div class="setsec" id="setAbout"><div class="sh">${esc(T('about'))}</div><div style="font-size:18px">SCDO Wallet ${esc(APPVER)} · 2026-10-05</div><div id="aboutHash" class="abouthash"><div class="lbl">${esc(T('aboutHashLoading'))}</div></div><div class="relnotes">${relNotesHtml()}</div></div>`, { width: 820, noFocus: true })
    fillAboutHash()
  }
  // 2.0.7 (P3): installer SHA-256 of the running version + link to the published .sha256 file
  async function fillAboutHash () {
    let r = null
    try { r = await api.invoke('about:buildHash') } catch (e) {}
    const box = $('aboutHash'); if (!box) return
    if (!r || !r.sha256) { SD.html(box, `<div class="lbl">${esc(T('aboutHash'))}${PU.c()}${esc(T('aboutHashNone'))}</div>${r && r.verifyUrl ? `<button class="btn ghost small" data-act="openVerify" data-v="${esc(r.verifyUrl)}" style="margin-top:6px">${esc(T('aboutHashVerify'))}</button>` : ''}`); return }
    SD.html(box, `<div class="lbl" style="margin-top:8px;font-weight:600">${esc(T('aboutHash'))}${PU.c()}<span class="mono">${esc(r.file)}</span></div>
      <div class="mono" id="aboutSha" style="font-size:15px;word-break:break-all;user-select:all">${esc(r.sha256)}</div>
      <div class="lbl">${esc(T('aboutHashSrc_' + r.source))}</div>
      <div class="row" style="flex-wrap:wrap;margin-top:6px"><button class="btn ghost small" data-act="copy" data-v="${esc(r.sha256)}">${esc(T('copy'))}</button><button class="btn ghost small" data-act="openVerify" data-v="${esc(r.verifyUrl)}" id="aboutVerify">${esc(T('aboutHashVerify'))}</button></div>
      <div class="lbl" style="margin-top:6px">${esc(T('aboutHashHow'))}</div>`)
  }
  // ----- 1.1.6 auto-update (settings button + prompt modal + progress) -----
  async function checkUpdate () {
    const s = $('updState'); if (s) s.textContent = T('updChecking')
    let r
    try { r = await api.invoke('update:check', true) } catch (e) { if (s) s.textContent = T('updOffline'); return }
    // 2.0.6: a signature / verification failure is not a connection problem - say which one it is
    if (!r || !r.ok) { if (s) s.textContent = T(r && r.errorKind === 'verify' ? 'updVerifyFail' : 'updOffline'); return }
    if (r.state === 'none') { if (s) s.textContent = T('updLatest'); return }
    if (r.state === 'available' || r.state === 'required') { if (s) s.textContent = ''; window.__updManifest = r.manifest; updatePromptModal(r.manifest, r.state === 'required') }
  }
  function updatePromptModal (manifest, required) {
    const chObj = (manifest && manifest.changelog) || {}
    const ch = chObj[lang() === 'CN' ? 'zh' : 'en'] || chObj.en || chObj.zh || ''
    modal(`<div class="mh"><h2>${esc(required ? T('updRequired') : T('updFound'))} ${esc(manifest.version)}</h2><button class="btn ghost small" data-act="closeModal">✕</button></div>
      ${ch ? `<div class="lbl" style="white-space:pre-line;font-size:16px;margin:10px 0">${esc(ch)}</div>` : ''}
      <div class="foot">
        <button class="btn sec" data-act="updLater">${esc(T('updLater'))}</button>
        ${required ? '' : `<button class="btn ghost" data-act="updSkip">${esc(T('updSkip'))}</button>`}
        <button class="btn pri" data-act="updGo">${esc(T('updGo'))}</button>
      </div>`, { width: 640, noFocus: true })
    window.__updManifest = manifest
  }
  async function updGo () {
    const manifest = window.__updManifest; if (!manifest) return
    modal(`<div class="mh"><h2>${esc(T('updInstalling'))}</h2></div>
      <div style="font-size:17px;margin:10px 0">${esc(T('updQuit'))}</div>
      <div style="height:14px;background:#e5e8f5;border-radius:7px;margin:12px 0;overflow:hidden"><div id="updProg" style="height:100%;width:0%;background:#43A047;border-radius:7px;transition:width .3s"></div></div>
      <div class="lbl" id="updPct" style="text-align:center">0%</div>`, { width: 560, noFocus: true })
    try {
      const r = await api.invoke('update:install', manifest)
      if (!r || !r.ok) { toast(T(r && r.errorKind === 'network' ? 'updDlNet' : 'updDlFail') + PU.c() + ((r && r.error) || ''), 8000); closeModal() }
    } catch (e) { toast(T('updChkFail', { e: e.message }), 8000) }
  }

  function backupPickModal () {
    const l = st.accounts
    modal(`<div class="mh"><h2>${esc(T('backupKeyfile'))}</h2><button class="btn ghost small" data-act="closeModal">✕</button></div>
      ${l.map(a => `<div class="acc" style="margin:8px 0">${avatar(accLabel(a))}<div style="flex:1;min-width:0"><div class="wrap" style="font-weight:700">${esc(accLabel(a))}</div><div class="lbl" style="font-size:15px">${esc(T('keyfileName'))}${PU.c()}${esc(a.filename)}</div><div class="mono" style="font-size:15px">${esc(a.pubkey)}</div></div><button class="btn sec small" data-act="backupOne" data-f="${esc(a.filename)}">${esc(T('backupNow'))}</button></div>`).join('') || esc(T('noAccount'))}
      <div class="foot"><button class="btn pri" data-act="closeModal">${esc(T('done'))}</button></div>`, { width: 820, noFocus: true })
  }


  // ----- miner -----
  async function ensureGpu (force) {
    if (st.gpu && !force) return st.gpu
    try { st.gpu = await api.invoke('miner:gpu') } catch (e) { st.gpu = { nvidia: false, names: [] } }
    if (st.tab === 'mine') render()
    return st.gpu
  }
  async function ensureCaps () {
    try { st.caps = await api.invoke('miner:caps') } catch (e) { st.caps = st.caps || { cpu: {}, gpu: {} } }
    if (st.tab === 'mine') render()
    return st.caps
  }
  function classicSelection () {
    const sel = $('mClassic')
    const shard = Number(st.mineShard)
    const raw = sel && sel.value && sel.value !== '__other' ? sel.value : (localStorage.getItem('minerClassic') || '')
    const p = parseClassicAddress(raw)
    if (!p || p.shard !== shard) return null
    return p.address
  }
  async function classicStart () {
    const address = classicSelection()
    if (!address) { toast(T('errClassicAddr'), 5000); return }
    const backend = st.mineBackend === 'gpu' || st.mineBackend === 'external' ? 'gpu' : 'cpu'
    const gpuMiner = st.mineBackend === 'external' ? 'external' : 'classic-node'
    const threads = backend === 'cpu' ? threadCount() : saveGpuParams().threads
    const gpu = backend === 'cpu' ? {} : saveGpuParams()
    localStorage.setItem('minerClassic', address)
    localStorage.setItem(backend === 'cpu' ? 'minerClassicCpu' : 'minerClassicGpu', address)
    const r = await api.invoke('miner:start', address, {
      chain: 'classic', backend, gpuMiner, shard: Number(st.mineShard),
      threads, threadblocks: gpu.threadblocks, blockthreads: gpu.blockthreads
    })
    if (!r.ok) {
      const key = 'st_' + (r.code || '')
      const text = T(key)
      toast(text !== key ? text : (r.error || r.code), 8000)
      return
    }
    if (backend === 'cpu') localStorage.setItem('minerRunClassicCpu', '1')
    else localStorage.setItem('minerRunClassicGpu', gpuMiner === 'external' ? 'external' : 'gpu')
  }
  async function mineStart () {
    if (Number(st.mineShard) >= 1) return classicStart()
    const sel = $('mReward'); if (!sel || !/^0x[0-9a-fA-F]{40}$/.test(miningInput(sel.value))) { toast(T('pickAddr')); return }
    if (sel) sel.value = miningInput(sel.value)
    const wallet = sel.value; localStorage.setItem('minerReward', wallet)
    if (api.platform === 'win32' && !localStorage.getItem('defenderAsked112')) {
      localStorage.setItem('defenderAsked112', '1')
      if (await confirmBox(T('defender'), T('defAsk'), T('yes'), T('no'))) { const r = await api.invoke('miner:defender'); toast(r && r.ok ? T('defenderOk') : T('defenderFail') + ' ' + ((r && r.error) || ''), 6000) }
    }
    if (!(await okWithOtherRigel())) return
    const r = await api.invoke('miner:start', wallet, { mode: 'mine' })
    if (!r.ok) { if (r.code === 'NO_NVIDIA') await ensureGpu(true); toast(r.code === 'NO_NVIDIA' ? T('st_NO_NVIDIA') : (r.error || r.code), 7000); return }
    // 1.1.5: the on/off state is saved by the main process (miner-intent.json), not in localStorage
  }
  // 1.1.5: another Rigel (e.g. the SCDO-Mining task of the standalone miner package) already uses the GPU -> ask first
  async function okWithOtherRigel (list) {
    try { if (!list) list = await api.invoke('miner:otherRigels') } catch (e) { list = [] }
    if (!list || !list.length) return true
    const where = list.map(x => x.exe || ('pid ' + x.pid)).join('\n')
    return confirmBox(T('otherRigelTitle'), T('otherRigelAsk', { p: where }), T('otherRigelYes'), T('otherRigelNo'))
  }
  async function nodeStart () {
    const sel = $('nPayout')
    let payout = sel ? sel.value : payoutDefault()
    if (!/^0x[0-9a-fA-F]{40}$/.test(payout || '')) payout = ''
    if (payout) localStorage.setItem('nodePayout', payout)
    const r = await api.invoke('miner:start', '', { mode: 'node', payout: payout || undefined })
    if (!r.ok) { toast(r.error || r.code, 7000); return }
  }
  async function minerStop (src) {
    const classic = Number(st.mineShard) >= 1
    if (classic) {
      const backend = st.mineBackend === 'cpu' ? 'cpu' : 'gpu'
      if (backend === 'cpu') localStorage.setItem('minerRunClassicCpu', '')
      else localStorage.setItem('minerRunClassicGpu', '')
      toast(T('stopping'), 60000)
      await api.invoke('miner:stop', { chain: 'classic', backend })
      toast(T('stopped'))
      return
    }
    const ext = st.miners && st.miners.shard0 && st.miners.shard0.phase === 'external'
    // 2.0.6: "Stop mining" asks first (main-process dialog, Cancel is the default); node-only stop does not.
    // Classic start/stop never asks: Shard0 GPU, Classic GPU and CPU run together with no confirmation.
    if (!ext && src !== 'node') { let ok = false; try { ok = await api.invoke('miner:confirmStop') } catch (e) {} if (!ok) return }
    if (!ext) toast(T('stopping'), 60000)
    await api.invoke('miner:stop', src === 'node' ? 'node' : 'mine')
    if (!ext) toast(T('stopped'))
  }
  function onMinerStatus (m) {
    const prev0 = st.miners && st.miners.shard0
    storeMiner(m)
    st.miner = viewMiner()
    renderMinePill()
    const cur0 = st.miners.shard0
    if (cur0 && cur0.code === 'DEFENDER' && (!prev0 || prev0.code !== 'DEFENDER') && api.platform === 'win32') {
      confirmBox(T('defender'), T('st_DEFENDER'), T('yes'), T('no')).then(async ok => { if (ok) { const r = await api.invoke('miner:defender'); toast(r && r.ok ? T('defenderOk') : T('defenderFail'), 6000); if (r && r.ok) mineStart() } })
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
      case 'tab': if ($('md')) SD.clear($('modalRoot')); setTab(v); render(); if (v === 'mine') { ensureGpu(); ensureCaps() }; if (v === 'old') refreshOld(); break
      case 'mineShard': st.mineShard = [0, 1, 2, 3, 4].includes(Number(v)) ? Number(v) : 0; localStorage.setItem('mineShard112', String(st.mineShard)); render(); break
      case 'mineBackend': st.mineBackend = v === 'gpu' || v === 'external' ? v : 'cpu'; localStorage.setItem('mineBackend112', st.mineBackend); render(); break
      case 'homeSub': st.homeSub = v; localStorage.setItem('homeSub112', v); render(); break
      case 'accMenu': if ($('dd')) closeDd(); else accMenu(el); break
      case 'netMenu': if ($('dd')) closeDd(); else netMenu(el); break
      case 'pickAcc': st.sel = f; localStorage.setItem('selAcc112', f); if (st.tab !== 'home') setTab('home'); render(); break
      case 'pickNet': setNet(v, el.getAttribute('data-shard')); render(); if (v === 'old') refreshOld(); else refreshS0(); break
      case 'pickShard': ui.shard = [0, 1, 2, 3, 4].includes(Number(v)) ? Number(v) : 0; saveUi(); render(); break
      case 'settings': settingsModal(); break
      case 'setLang': setLangUi(v); break
      case 'hdrLang': setLangUi(v, true); break
      case 'copy': copyText(v); break
      case 'receive': receiveModal(f, el.getAttribute('data-chain') || 'new'); break
      case 'send': sendModal(f); break
      case 'sendOld': sendOldModal(f); break
      case 'create': createModal(); break
      case 'import': if ($('md')) SD.clear($('modalRoot')); importKeyfiles(); break
      case 'unlock': unlock(f, el.getAttribute('data-in')); break
      case 'hide': setHidden(el.getAttribute('data-chain') || 'new', f, true); break
      case 'unhide': setHidden(el.getAttribute('data-chain') || 'new', f, false); break
      case 'toggleHidden': ui.showHidden = !ui.showHidden; saveUi(); if ($('md')) { SD.clear($('modalRoot')); render(); settingsModal() } else render(); break
      case 'delete': deleteModal(f); break
      case 'rename': renameModal(f); break
      case 'cardMine': openMineFor(f, el.getAttribute('data-chain') || 'new'); break
      case 'cardRemit': openRemitFor(f); break
      case 'useOtherAddr': useOtherAddr(v); break
      case 'closeModal': closeModal(); break
      case 'openTx': if (/^0x[0-9a-fA-F]{64}$/.test(String(v || ''))) openExternal(shard0().explorerTx(v)); break
      case 'explorerAddr': openExternal(shard0().explorerAddress(v)); break
      case 'backupPick': backupPickModal(); break
      case 'backupOne': { const r = await api.invoke('keyfile:backupOnly', f); toast(r.ok ? T('backupOk', { p: r.backup }) : T('backupFail', { e: r.error }), 8000); break }
      case 'openBackups': api.invoke('keyfile:openBackups'); break
      case 'mineStart': mineStart(); break
      case 'nodeStart': nodeStart(); break
      case 'minerStop': minerStop(el.id === 'btnNode' || (st.miner && st.miner.mode === 'node') ? 'node' : 'mine'); break
      case 'toggleLog': st.logOpen = !st.logOpen; st.advOpen = true; render(); break
      case 'openLogs': api.invoke('miner:openLogs'); break
      case 'remitSign': remitLogin(f); break
      case 'remitLogout': api.invoke('remit:logout').catch(() => {}); remitReset(); render(); break
      case 'remitRefresh': remitRefresh(); break
      case 'checkUpdate': checkUpdate(); break
      case 'updatedOk': closeModal(); try { api.invoke('app:updatedSeen') } catch (e) {} break
      case 'updGo': updGo(); break
      case 'updLater': closeModal(); break
      case 'updSkip': { const m = window.__updManifest; if (m && m.version) api.invoke('update:skip', m.version); window.__updManifest = null; closeModal(); break }
      case 'defender': { const r = await api.invoke('miner:defender'); toast(r && r.ok ? T('defenderOk') : T('defenderFail') + ' ' + ((r && r.error) || ''), 6000); break }
      case 'netStatsRefresh': window.SCDOMining.networkStats.refresh(); break
      case 'notifyToggle': { const sw = el.querySelector('.sw'); const on = !(sw && sw.classList.contains('on')); const r = await api.invoke('notify:set', v, on); if (r && r.ok && sw) sw.classList.toggle('on', !!r.config[v]); break }
      case 'setChannel': { const r = await api.invoke('update:setChannel', v); if (r && r.ok) { const a = $('chanStable'); const b = $('chanBeta'); if (a) a.className = 'btn ' + (r.channel === 'stable' ? 'pri' : 'ghost'); if (b) b.className = 'btn ' + (r.channel === 'beta' ? 'pri' : 'ghost'); toast(T('chanSaved', { c: T(r.channel === 'beta' ? 'chanBeta' : 'chanStable') })) } break }
      case 'openVerify': if (/^https:\/\/scdoscan\.io\/downloads\/wallet\/[\w./-]+\.sha256$/.test(String(v || ''))) openExternal(v); break
    }
  })
  document.addEventListener('change', (ev) => {
    const t = ev.target; if (!t) return
    if (t.id === 'mClassic') {
      st.otherOpen = st.otherOpen || {}
      const row = $(t.id + '-oth')
      if (t.value === '__other') { st.otherOpen[t.id] = true; if (row) row.style.display = 'flex'; const i = $(t.id + '-in'); if (i) i.focus(); return }
      st.otherOpen[t.id] = false; if (row) row.style.display = 'none'
      const p = parseClassicAddress(t.value)
      if (p) localStorage.setItem('minerClassic', p.address)
      return
    }
    if (t.id === 'mGpuThreads' || t.id === 'mThreadBlocks' || t.id === 'mBlockThreads') { t.value = miningInput(t.value); saveGpuParams(); return }
    if (t.id !== 'mReward' && t.id !== 'nPayout') return
    st.otherOpen = st.otherOpen || {}
    const row = $(t.id + '-oth')
    if (t.value === '__other') { st.otherOpen[t.id] = true; if (row) row.style.display = 'flex'; const i = $(t.id + '-in'); if (i) i.focus(); return }
    st.otherOpen[t.id] = false; if (row) row.style.display = 'none'
    const addr = miningInput(t.value)
    if (addr !== t.value) t.value = addr
    if (/^0x[0-9a-fA-F]{40}$/.test(addr)) localStorage.setItem(t.id === 'mReward' ? 'minerReward' : 'nodePayout', addr)
  })
  document.addEventListener('input', (ev) => {
    const t = ev.target; if (!t || ev.isComposing) return
    if (t.id === 'mThreads') {
      const lab = $('mThreadsVal'); if (lab) lab.textContent = String(t.value)
      localStorage.setItem('mineThreads112', String(t.value))
      return
    }
    const half = t.id === 'mClassic-in' || t.id === 'mReward-in' || t.id === 'nPayout-in' || t.id === 'sTo' || t.id === 'sAmt' || t.id === 'mGpuThreads' || t.id === 'mThreadBlocks' || t.id === 'mBlockThreads' || t.id === 'cPriv'
    if (!half) return
    const next = (t.id === 'sTo' || t.id === 'sAmt' || t.id === 'cPriv') ? nhw(t.value) : miningInput(t.value)
    if (next !== t.value) {
      const pos = t.selectionStart
      t.value = next
      try { t.setSelectionRange(pos, pos) } catch (e) {}
    }
  })
  document.addEventListener('toggle', (ev) => { if (ev.target && ev.target.id === 'advBox') st.advOpen = ev.target.open }, true)
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { if (window.__closeAssetList && window.__closeAssetList()) return; if ($('dd')) closeDd(); else if ($('md')) closeModal() }
    if (ev.key === 'Enter' && ev.target && ev.target.id === 'homePw') { const b = document.querySelector('[data-act=unlock][data-in=homePw]'); if (b) b.click() }
  })

  // application menu (main process) -> page, over the allowlisted 'menu:action' event
  function openRemittance () { if ($('md')) SD.clear($('modalRoot')); setTab('remit'); render() }
  api.on('menu:action', (a) => { if (a === 'create') createModal(); else if (a === 'import') importKeyfiles(); else if (a === 'settings') settingsModal(); else if (a === 'remit') openRemittance() })

  // ---------------- 1.1.6 auto-update events ----------------
  api.on('update:available', (p) => {
    if (!p || !p.manifest) return
    // don't stack a prompt on top of an existing update prompt
    if ($('md') && $('md').querySelector('[data-act=updGo]')) return
    window.__updManifest = p.manifest
    updatePromptModal(p.manifest, !!p.required)
  })
  api.on('update:progress', (p) => {
    const b = $('updProg'); if (!b) return
    const pc = (p && p.percent) || 0
    b.style.width = pc + '%'
    const t = $('updPct'); if (t) t.textContent = pc + '%'
  })
  api.on('update:done', (p) => {
    if (!p || !p.ok) { toast(T(p && p.errorKind === 'network' ? 'updDlNet' : 'updDlFail') + (p && p.error ? PU.c() + p.error : ''), 8000); closeModal() }
  })

  // ---------------- boot ----------------
  let APPVER = '2.0.9'
  api.on('miner:status', (m) => onMinerStatus(m))
  api.on('miner:classic', (m) => onMinerStatus(m))
  async function boot () {
    let info = null
    try { info = await api.invoke('app:info'); if (info && info.version) APPVER = info.displayVersion || info.version } catch (e) {}
    try { storeMiner(await api.invoke('miner:status')) } catch (e) {}
    try { const c = await api.invoke('miner:classicStatus'); if (c) { st.miners.classicCpu = c.classicCpu; st.miners.classicGpu = c.classicGpu } } catch (e) {}
    st.miner = viewMiner()
    loadAccounts()
    render()
    if (window.__scdoBootDone) window.__scdoBootDone() // 2.0.6: the loading screen goes away once the real page is drawn
    // 2.0.6: right after an update, say so (titled dialog) and show the mining state
    if (info && info.updated) {
      const x = minePillText(st.miners && st.miners.shard0)
      modal(`<div class="mh"><h2>${esc(T('updatedTitle', { v: APPVER }))}</h2></div>
        <div style="font-size:18px;margin:10px 0">${esc(T('updatedMsg', { v: APPVER }))}</div>
        <div class="minepill ${x.cls}" id="updMine" style="display:inline-block;margin:6px 0 10px">${esc(x.t)}</div>
        <div class="lbl" style="font-size:16px">${esc(T('updatedTray'))}</div>
        <div class="foot"><button class="btn pri" data-act="updatedOk" id="updatedOk">${esc(T('done'))}</button></div>`, { width: 640, noFocus: true })
    }
    refreshS0(); refreshOld()
    setInterval(refreshS0, 15000); setInterval(refreshOld, 30000)
    try { storeMiner(await api.invoke('miner:status')); st.miner = viewMiner() } catch (e) {}
    // 1.1.5: auto-resume reads the on/off state from the main process (one-time migration of the old localStorage values)
    try { await api.invoke('miner:intentMigrate', { autoResume: localStorage.getItem('minerAutoResume'), mode: localStorage.getItem('minerMode'), reward: localStorage.getItem('minerReward'), payout: localStorage.getItem('nodePayout') }) } catch (e) {}
    ensureCaps().then(async caps => {
      const classicCpu = localStorage.getItem('minerRunClassicCpu') === '1'
      let classicGpu = localStorage.getItem('minerRunClassicGpu') || ''
      if (!classicCpu && !classicGpu && localStorage.getItem('minerMode') === 'classic-cpu') localStorage.setItem('minerRunClassicCpu', '1')
      if (localStorage.getItem('minerRunClassicCpu') === '1' && !(st.miners.classicCpu && st.miners.classicCpu.running) && caps && caps.cpu && caps.cpu.available) {
        const p = parseClassicAddress(localStorage.getItem('minerClassicCpu') || localStorage.getItem('minerClassic') || '')
        if (p) api.invoke('miner:start', p.address, { chain: 'classic', backend: 'cpu', shard: p.shard, threads: threadCount() })
      }
      if (!classicGpu && localStorage.getItem('minerMode') === 'classic-gpu') classicGpu = localStorage.getItem('mineBackend112') === 'external' ? 'external' : 'gpu'
      if (classicGpu && !(st.miners.classicGpu && st.miners.classicGpu.running)) {
        const p = parseClassicAddress(localStorage.getItem('minerClassicGpu') || localStorage.getItem('minerClassic') || '')
        const gpuOk = classicGpu === 'external' ? (caps && caps.external && caps.external.available) : (caps && caps.gpu && caps.gpu.available)
        if (p && gpuOk) {
          const gpu = gpuParams()
          api.invoke('miner:start', p.address, { chain: 'classic', backend: 'gpu', gpuMiner: classicGpu === 'external' ? 'external' : 'classic-node', shard: p.shard, threads: gpu.threads, threadblocks: gpu.threadblocks, blockthreads: gpu.blockthreads })
        }
      }
    }).catch(() => {})
    ensureGpu().then(async () => {
      let rc = null; try { rc = await api.invoke('miner:resumeCheck') } catch (e) {}
      if (!rc || !rc.autoResume || rc.running || (st.miner && st.miner.running)) return
      if (rc.mode === 'node') { nodeStart(); return }
      if (!rc.gpuOk || !rc.reward) return
      if (!(await okWithOtherRigel(rc.otherRigels))) { await api.invoke('miner:intentClear'); toast(T('otherRigelSkipped'), 9000); return }
      const r = await api.invoke('miner:start', rc.reward, { mode: 'mine' })
      if (r && !r.ok) toast(r.error || r.code, 7000)
    })
    if (st.tab === 'mine') render()
  }
  boot()
})()
