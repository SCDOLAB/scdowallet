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
  // 3.0.8: first launch is 華語. A saved EN or CN from wallet:boot is kept. The operating-system language is not used.
  const normUi = (window.SCDOUiLang && window.SCDOUiLang.normLang) || function (v) { return String(v == null ? '' : v).trim().toUpperCase() === 'EN' ? 'EN' : 'CN' }
  let LANG = normUi(CFG && CFG.lang)
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
    const plat = (api && api.platform) || (window.scdo && window.scdo.platform) || ''
    const pick = (pack) => (window.SCDOPlatformCopy ? window.SCDOPlatformCopy.copyText(pack, k, plat) : (pack || {})[k])
    let s = pick(window.I18N112[lang()] || {})
    if (s == null) s = pick(window.I18N112.EN)
    if (s == null) s = k
    if (p) s = s.replace(/\{(\w+)\}/g, (m, n) => p[n] != null ? p[n] : m)
    return s
  }
  // punctuation that follows the UI language (full-width in Chinese, ASCII in English)
  const PU = { c: () => lang() === 'CN' ? '：' : ': ', l: () => lang() === 'CN' ? '（' : ' (', r: () => lang() === 'CN' ? '）' : ')', bar: () => lang() === 'CN' ? ' ｜ ' : ' | ', com: () => lang() === 'CN' ? '，' : ', ' }
  // 3.0.4: one format for every amount: up to 8 decimals, cut (never rounded up), trailing zeros dropped, comma
  // thousands separators. String / BigInt maths only (src/js/amount.js); the old dMax argument is ignored.
  const AMT = window.SCDOAmount
  function fmtNum (x) { return AMT.fmtDec(x) }
  function fmtWei (wei) { return AMT.fmtUnits(wei, 18) }
  // Shard1–Shard4 balances arrive as integer units (8 decimals) in a string
  function oldRaw (pk) { const v = st.old[pk]; if (v == null) return null; try { return BigInt(v) } catch (e) { return null } }
  function fmtOld (pk) { const r = oldRaw(pk); return r == null ? null : AMT.fmtUnits(r, 8) }
  function groupedTries (h) {
    if (h == null || h === '') return ''
    const n = Number(h)
    if (!Number.isFinite(n) || n < 0) return ''
    return Math.round(n).toLocaleString('en-US')
  }
  function speedText (h, on) {
    if (!on) return T('mineSpeedOff')
    const n = groupedTries(h)
    if (!n) return T('mineSpeedUnknown')
    return T('mineSpeedLine', { n: n })
  }
  function peerText (n) {
    if (n == null || n === '') return T('minePeersUnknown')
    return T('minePeersLine', { n: n })
  }
  function blockText (n) { return T('mineBlocksLine', { n: n || 0 }) }
  function shareText (a, r) { return T('mineSharesLine', { a: a || 0, r: r || 0 }) }
  function scdoLine (key, n) { return (n == null || n === '') ? T('mineAmountUnknown') : T(key, { n: n }) }
  function rateText (on, young, rate) {
    if (!on || young || rate == null || !Number.isFinite(Number(rate))) return T('mineRateOff')
    return T('mineRateLine', { n: String(Number(Number(rate).toFixed(2))) })
  }
  function heightWord (v) {
    const n = Number(v)
    if (!(n > 0)) return T('mineHeightUnknown')
    return T('mineHeightNum', { n: Math.round(n).toLocaleString('en-US') })
  }
  function tipPack (name, value, explain, detail) {
    return { name: name || '', value: value || '', explain: explain || '', detail: detail || '' }
  }
  function statHtml (id, label, value, tip) {
    const t = tip || {}
    return `<div class="stat explain" tabindex="0" data-tip-name="${esc(t.name || label)}" data-tip-value="${esc(t.value || value)}" data-tip-explain="${esc(t.explain || '')}" data-tip-detail="${esc(t.detail || '')}"><div class="lbl">${esc(label)}</div><div class="v" id="${id}">${esc(value)}</div></div>`
  }
  function toast (msg, ms) { const t = $('toast'); t.textContent = msg; t.style.display = 'block'; clearTimeout(toast._t); toast._t = setTimeout(() => { t.style.display = 'none' }, ms || 3500) }
  function copyText (t) { navigator.clipboard.writeText(t).then(() => toast(T('copied') + PU.c() + t)).catch(() => toast(t)) }
  function avatar (name) {
    let h = 0; for (const c of String(name)) h = (h * 31 + c.codePointAt(0)) >>> 0
    const hue = h % 360
    const ch = (String(name).trim()[0] || '?').toUpperCase()
    return `<div class="avatar" style="background:hsl(${hue},62%,48%)">${esc(ch)}</div>`
  }
  function openExternal (url) { api.invoke('shell:openExternal', url) }
  // 3.0.4: official contacts, shown in Settings → About and in AI小貓 (the main process allows exactly these)
  const CONTACT = [['help_channel', 'https://t.me/SCDOLabor', 't.me/SCDOLabor'], ['help_group', 'https://t.me/SCDOCommunity', 't.me/SCDOCommunity'], ['help_email', 'mailto:admin@apeccapital.org', 'admin@apeccapital.org']]
  const CONTACT_URLS = CONTACT.map(c => c[1])
  function contactHtml (id) {
    return `<div class="contact" id="${id}"><div class="ct-h">${esc(T('help_title'))}</div>${CONTACT.map(([k, url, text]) => `<div class="ct-row"><span class="lbl">${esc(T(k))}</span><button type="button" class="link" data-act="openLink" data-v="${esc(url)}">${esc(text)}</button></div>`).join('')}</div>`
  }

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
  ui.payees = Array.isArray(ui.payees) ? ui.payees.filter(p => p && typeof p.name === 'string' && p.name.trim()).map(p => ({ name: String(p.name).trim(), kind: 'remit' })).slice(-100) : []
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
  // 3.0.2: no tab bar and no quick-button row. Pages: 'home' (entry cards), 'acc' (Classic (Shard1–Shard4) first,
  // then Shard0 EVM) and 'mine'. Switching is only the Home cards and the View menu; every page has 「← 回首頁」.
  // ui.net is the chain of the account picked in the header switcher: 'new' = Shard0 EVM (chain ID 5680), 'old' = Classic shards.
  // Old tab names 'old' / 'new' (saved state, deep links) open the Accounts tab at that section.
  // ui.shard = 1..4 (one Classic shard) or 0 (all four), chosen on the Classic page.
  // Kept in ui112.json (synchronous file write) so the choice survives a restart even if localStorage is not flushed.
  const TABS = ['home', 'acc', 'mine', 'mineSet']
  const savedTab = ui.tab || localStorage.getItem('tab112') || 'home'
  if (ui.net !== 'old' && ui.net !== 'new') ui.net = savedTab === 'new' ? 'new' : 'old'
  // The wallet always opens on Home, with the Classic accounts shown first.
  const tab0 = 'home'
  ui.shard = [0, 1, 2, 3, 4].includes(Number(ui.shard)) ? Number(ui.shard) : 0
  const shardFilter = (l) => ui.shard ? l.filter(a => String(a.shard) === String(ui.shard)) : l
  if (ui.tab !== tab0) { ui.tab = tab0; saveUi() }
  const st = {
    tab: tab0,
    scrollTo: null,
    homeSub: localStorage.getItem('homeSub112') || 'assets',
    sel: localStorage.getItem('selAcc112') || '',
    accounts: [],
    s0: {}, // filename -> { nativeWei, tokens, err }
    old: {}, // pubkey -> number (SCDO) | null
    net: { s0Block: null, s0Ok: null, oldOk: null },
    miner: null, miners: { shard0: { chain: 'shard0', running: false, code: 'IDLE' }, classicCpu: { chain: 'classic', mode: 'cpu', running: false, code: 'IDLE' }, classicGpu: { chain: 'classic', mode: 'gpu', running: false, code: 'IDLE' } }, gpu: null, caps: null, logOpen: false,
    mineShard: [0, 1, 2, 3, 4].includes(Number(localStorage.getItem('mineShard112'))) ? Number(localStorage.getItem('mineShard112')) : 0,
    mineBackend: localStorage.getItem('mineBackend112') || 'cpu',
    rawAccounts: BOOT.accounts || [], activity: {}, oldRecords: [], oldAct: {}, oldActAt: 0,
    remit: { phase: 'idle', error: '', address: '', ledger: null, base: '' }, // 2.0.12 匯款 (token stays in the main process)
    catLog: [], catOpen: false, catH: { classic: null, peersAt: 0 }, catHeatAt: 0, catWatchAt: 0, catHealKey: '', catHealAt: 0, mem: null, actStarting: false, homeMine: '', otherRigels: [],
    payReview: null
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
      // 3.0.4: Home lists every visible Shard0 EVM account's history (indexer, at most once a minute); the selected one every time
      const sa = selected()
      if (Date.now() - (st.s0ActAt || 0) > 60000) { st.s0ActAt = Date.now(); await Promise.all(visible('new').filter(x => x.evm).map(x => loadActivity(x.evm))) } else if (sa && sa.evm) await loadActivity(sa.evm)
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
    loadOldActivity()
  }
  // 3.0.4: Shard1–Shard4 history from https://api.scdoscan.io/api/address/{addr}/txs (incoming too), merged in the
  // main process with this computer's own send records. At most once a minute, or right after a send (force).
  function loadOldActivity (force) {
    if (!force && Date.now() - st.oldActAt < 60000) return
    st.oldActAt = Date.now()
    const addrs = [...new Set(visible('old').map(a => (parseClassicAddress(a.pubkey) || {}).address).filter(Boolean))]
    Promise.all(addrs.map(addr => api.invoke('old:activity', addr).then(r => { if (r && Array.isArray(r.rows)) st.oldAct[addr.toLowerCase()] = r.rows }).catch(() => {})))
      .then(() => renderLive()).catch(() => {})
  }
  function s0Total (list) { let t = 0n; let known = 0; for (const a of list) { const b = st.s0[a.filename]; if (b && b.nativeWei != null) { t += b.nativeWei; known++ } } return { wei: t, known } }
  function oldTotal (list) { let t = 0n; let known = 0; for (const a of list) { const v = oldRaw(a.pubkey); if (v != null) { t += v; known++ } } return { v: t, known } }

  // ---------------- header / tabs ----------------
  // 'old' / 'new' (old tab names, deep links) open the Accounts tab at that section and pick that chain.
  // A saved or requested 匯款 tab opens the merged form instead of a page.
  function setTab (v) {
    if (v === 'remit') { openRemitFor((headerAccount() || {}).filename || st.sel); return }
    if (v === 'old' || v === 'new') { ui.net = v; st.tab = 'acc'; st.scrollTo = v === 'old' ? 'secOld' : 'secNew' } else {
      st.tab = TABS.includes(v) ? v : 'home'
      if (st.tab === 'acc') st.scrollTo = 'secOld'
      if (st.tab === 'home' || st.tab === 'mine' || st.tab === 'mineSet') st.scrollTo = 'top'
    }
    ui.tab = st.tab; localStorage.setItem('tab112', st.tab); saveUi()
  }
  // The header switcher lists both kinds; the chain of the picked account decides balances, send and receive.
  function headerChain () {
    return ui.net === 'old' ? 'old' : 'new'
  }
  function headerAccounts () {
    if (headerChain() === 'old') return shardFilter(visible('old'))
    return visible('new')
  }
  function headerAccount () {
    if (headerChain() === 'old') {
      const list = headerAccounts()
      return list.find(x => x.filename === st.sel) || list[0] || null
    }
    return selected()
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
    setTab('mineSet')
    render()
    ensureGpu()
    ensureCaps()
  }
  function openRemitFor (filename) {
    const a = accByFile(filename)
    if (a) {
      st.sel = a.filename
      localStorage.setItem('selAcc112', a.filename)
    }
    if ($('md')) SD.clear($('modalRoot'))
    payModal(a ? a.filename : '')
  }
  // 3.0.2 (v8): the header is the SCDO logo (goes Home) and the status island. Account switching, language and
  // settings moved to AI小貓 and the window menu, so the header has no other buttons.
  function renderHeader () {
    const hdr = $('hdr')
    if (!hdr || !$('statusIsland') || !$('islandCompact')) {
      SD.html(hdr, `<div class="brand"><button type="button" class="brand-home" data-act="goHome" id="brandHome" title="${esc(T('goHomeTip'))}" aria-label="${esc(T('goHomeTip'))}"><img src="./assets/icon-128.png" alt="SCDO"></button></div>
      <div class="island" id="statusIsland">
        <div class="island-compact" id="islandCompact"></div>
      </div>`)
    } else {
      const b = $('brandHome'); const tip = T('goHomeTip')
      if (b && b.title !== tip) { b.title = tip; b.setAttribute('aria-label', tip) }
    }
    renderIsland()
  }
  function tabNetDot (chain) {
    const ok = chain === 'old' ? st.net.oldOk : st.net.s0Ok
    const title = chain === 'old'
      ? (st.net.oldOk === false ? T('netDown') : '')
      : (st.net.s0Ok ? T('netBlock', { n: st.net.s0Block == null ? '…' : st.net.s0Block }) : (st.net.s0Ok === false ? T('netDown') : ''))
    return `<span class="dot ${ok == null ? '' : ok ? 'ok' : 'bad'}" data-netdot="${chain}" title="${esc(title)}"></span>`
  }

  // ---------------- pages ----------------
  // Home's balance, sync, and earnings live in the status island. Assets, activity, and send live on the wallet card.
  function cardHomeFold (a) {
    if (!a || !a.evm || a.filename !== st.sel) return ''
    return `<div class="home-fold"><div class="subtabs">
      <button class="${st.homeSub === 'assets' ? 'on' : ''}" data-act="homeSub" data-v="assets">${esc(T('assets'))}</button>
      <button class="${st.homeSub === 'activity' ? 'on' : ''}" data-act="homeSub" data-v="activity">${esc(T('activity'))}</button></div>
      <div id="homeLower">${st.homeSub === 'assets' ? assetsHtml(a) : activityHtml(a)}</div></div>`
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
      const word = r.dir === 'in' ? T('txReceived') : r.dir === 'self' ? T('txSelf') : r.dir === 'reward' ? T('txReward') : T('txSent')
      const inward = r.dir === 'in' || r.dir === 'reward'
      h += `<div class="txrow" data-act="openTx" data-v="${esc(r.hash)}"><div style="font-size:26px">${inward ? '\u2B07' : '\u2B06'}</div><div style="flex:1;min-width:0"><div style="font-weight:700;font-size:19px">${esc(word)} ${inward ? '\u2190' : '\u2192'} <span class="mono" style="font-weight:400;font-size:17px">${esc(inward ? r.from : r.to)}</span></div>
        <div class="lbl">${esc(new Date(r.t).toLocaleString(lang() === 'CN' ? 'zh-TW' : 'en-GB'))}${r.block ? ' · #' + esc(r.block) : ''}</div></div>
        <div style="text-align:right"><div style="font-size:21px;font-weight:700">${inward ? '+' : r.dir === 'self' ? '' : '\u2212'}${esc(txAmount(r))} ${esc(r.asset)}</div>${stt}</div></div>`
    })
    h += `<div class="lbl tx-lag" style="padding:10px 26px 0">${esc(T('d_txLag'))}</div>`
    h += `<div style="padding:14px 26px"><button class="link" data-act="explorerAddr" data-v="${esc(a.evm)}">${esc(T('viewExplorer'))}</button></div>`
    return h
  }

  // ---------------- 3.0.2 (v8) read-only dashboard ----------------
  // Home = five identical chain cards (Shard0 EVM, Shard1–Shard4), recent transactions and the fixed 總餘額 footer.
  // The only controls are copy and QR. Every action is in AI小貓 and the window menu.
  const CHAIN_NAMES = ['Shard0 EVM', 'Shard1', 'Shard2', 'Shard3', 'Shard4']
  function shardOf (a) { const p = parseClassicAddress(a && a.pubkey); return p ? p.shard : Number(a && a.shard) }
  function classicOn (n) { return visible('old').filter(a => shardOf(a) === n) }
  // the receiving address shown on each card: Shard0 EVM = the selected unlocked account; ShardN = the address
  // that mines on that shard, else the first account on it
  function chainAccounts () {
    const out = []
    const evms = visible('new')
    const unlocked = evms.filter(a => a.evm)
    const sel = selected()
    const s0 = (sel && sel.evm) ? sel : unlocked[0]
    out.push(s0
      ? { label: accLabel(s0), count: evms.length, address: s0.evm, file: s0.filename, chain: 'new' }
      : { label: evms[0] ? accLabel(evms[0]) : '', count: evms.length, address: '', locked: evms.length > 0 })
    const mineAddr = [localStorage.getItem('minerClassicGpu'), localStorage.getItem('minerClassicCpu'), localStorage.getItem('minerClassic')]
      .concat([st.miners && st.miners.classicGpu && st.miners.classicGpu.wallet, st.miners && st.miners.classicCpu && st.miners.classicCpu.wallet])
      .map(x => parseClassicAddress(x || '')).filter(Boolean)
    for (const n of [1, 2, 3, 4]) {
      const list = classicOn(n)
      const want = mineAddr.find(p => p.shard === n)
      const a = (want && list.find(x => { const p = parseClassicAddress(x.pubkey); return p && p.address === want.address })) || list[0]
      out.push(a ? { label: accLabel(a), count: list.length, address: (parseClassicAddress(a.pubkey) || {}).address || a.pubkey, file: a.filename, chain: 'old' } : { label: '', count: 0, address: '' })
    }
    return out
  }
  // balances per chain as text, plus numbers for the totals (null = not known yet)
  function chainBalances () {
    // 3.0.4: integer units only. Shard0 EVM has 18 decimals, Shard1–Shard4 have 8; the total is added at 18.
    const vals = []
    const s0 = s0Total(visible('new').filter(a => a.evm))
    vals.push(s0.known ? s0.wei : null)
    for (const n of [1, 2, 3, 4]) { const list = classicOn(n); const t = oldTotal(list); vals.push(list.length ? (t.known ? t.v * 10n ** 10n : null) : 0n) }
    const text = vals.map(v => v == null ? '…' : AMT.fmtUnits(v, 18))
    const known = vals.filter(v => v != null)
    const all = known.length ? AMT.fmtUnits(known.reduce((x, y) => x + y, 0n), 18) + (known.length < 5 ? '…' : '') : '…'
    return { text, all }
  }
  function blocksPerShard () {
    const out = [0, 0, 0, 0, 0]
    const items = (st.earn && Array.isArray(st.earn.items)) ? st.earn.items : []
    for (const e of items) { const n = Number(e && e.shard); if (n >= 0 && n <= 4) out[n]++ }
    return out
  }
  function gpuNames () {
    const g = st.gpu || {}
    const names = (g.mineNames && g.mineNames.length) ? g.mineNames : (g.nvidiaNames || [])
    if (names.length) return names
    return ((st.gpuTemp && st.gpuTemp.gpus) || []).map(t => t && t.name).filter(Boolean)
  }
  function dashModels () {
    const b = chainBalances()
    return window.SCDODash.chainModels({
      T,
      isl: window.SCDOIsland,
      miners: { shard0: (st.miners && st.miners.shard0) || st.miner, classicCpu: st.miners && st.miners.classicCpu, classicGpu: st.miners && st.miners.classicGpu },
      temps: st.gpuTemp && st.gpuTemp.gpus,
      gpuNames: gpuNames(),
      balances: b.text,
      accounts: chainAccounts(),
      blocks: blocksPerShard(),
      net: st.net,
      eta: fmtSyncEta
    })
  }
  function txAmount (r) {
    if (r.raw != null && r.decimals != null) { try { return AMT.fmtUnits(BigInt(r.raw), r.decimals) } catch (e) {} }
    return fmtNum(r.amount)
  }
  const TX_TITLE = { in: 'd_txIn', out: 'd_txOut', self: 'd_txSelf', reward: 'd_txReward' }
  function txRow (r, chain, when) {
    const dir = TX_TITLE[r.dir] ? r.dir : 'out'
    const status = r.status === 'done' ? T('d_txDone') : (r.status === 'fail' || r.status === 'error') ? T('d_txFail') : T('d_txPending')
    const who = dir === 'reward' ? '' : (dir === 'in' ? T('d_txFrom', { a: r.from }) : T('d_txTo', { a: r.to }))
    const sign = dir === 'out' ? '\u2212' : dir === 'self' ? '' : '+'
    return { t: Number(new Date(r.t)) || 0, dir: dir === 'reward' ? 'mine' : dir === 'self' ? 'self' : dir, key: String(r.hash || '').toLowerCase() + ':' + (r.asset || 'SCDO'), hash: /^0x[0-9a-fA-F]{64}$/.test(String(r.hash || '')) && chain === 'Shard0 EVM' ? r.hash : '', title: T(TX_TITLE[dir], { chain }), sub: [who, when(r.t), r.block ? '#' + r.block : '', status].filter(Boolean).join(' · '), amount: sign + txAmount(r) + ' ' + (r.asset || 'SCDO') }
  }
  function recentTx () {
    const rows = []
    const seen = new Set()
    const when = (t) => new Date(t).toLocaleString(lang() === 'CN' ? 'zh-TW' : 'en-GB')
    const push = (row) => { if (row.key.length > 6 && seen.has(row.key)) return; seen.add(row.key); rows.push(row) }
    for (const a of visible('new').filter(x => x.evm)) for (const r of (st.activity[a.evm.toLowerCase()] || [])) push(txRow(r, 'Shard0 EVM', when))
    for (const a of visible('old')) {
      const p = parseClassicAddress(a.pubkey); if (!p) continue
      for (const r of (st.oldAct[p.address.toLowerCase()] || [])) push(txRow(r, 'Shard' + p.shard, when))
    }
    return rows.sort((x, y) => y.t - x.t).slice(0, 5)
  }
  // 3.0.4 (v9): today's / total earnings for the big card at the top of Home
  function earnTexts () {
    let e = null
    try { e = islandModel(true).earn } catch (x) { e = null }
    return e ? { today: fmtNum(e.todayScdo), total: fmtNum(e.totalScdo) } : { today: null, total: null }
  }
  function mineHomeInput () {
    let earn = st.earn || null
    try { earn = noteEarn() } catch (e) { earn = st.earn || null }
    let phase = 'stopped'
    if (st.homeMine === 'starting' || st.homeMine === 'stopping') phase = st.homeMine
    else if (miningBusy() || st.homeMine === 'mining') phase = 'mining'
    return {
      miners: {
        shard0: (st.miners && st.miners.shard0) || st.miner,
        classicCpu: st.miners && st.miners.classicCpu,
        classicGpu: st.miners && st.miners.classicGpu
      },
      temps: (st.gpuTemp && st.gpuTemp.gpus) || [],
      earnLog: earn,
      now: Date.now(),
      phase: phase,
      gpuBusy: !!(st.otherRigels && st.otherRigels.length)
    }
  }
  function mineHomeCardHtml () {
    if (!window.SCDOMineHome) return ''
    return window.SCDOMineHome.cardHtml(mineHomeInput(), T, esc)
  }
  function pageHome () {
    return window.SCDODash.homeHtml(dashModels(), recentTx(), T, esc, earnTexts(), mineHomeCardHtml())
  }
  function renderFooter () {
    const f = $('footBar'); if (!f) return
    const show = st.tab !== 'mineSet'
    f.hidden = !show
    if (!show) return
    const b = chainBalances()
    const html = window.SCDODash.footerHtml({ all: b.all }, T, esc)
    if (renderFooter.last !== html) { renderFooter.last = html; SD.html(f, html) }
  }
  // repaint the read-only cards in place (no full page render) when the data changed
  function refreshDash () {
    renderFooter()
    if ($('md')) return
    if (st.tab === 'home') {
      const host = $('chainCards')
      if (host) { const html = dashModels().map(m => window.SCDODash.cardHtml(m, T, esc)).join(''); if (refreshDash.cards !== html) { refreshDash.cards = html; SD.html(host, html) } }
      const eh = $('earnCard')
      if (eh) { const html = window.SCDODash.earnHtml(earnTexts(), T, esc); if (refreshDash.earn !== html) { refreshDash.earn = html; SD.html(eh, html) } }
      const mh = $('homeMineHost')
      if (mh) { const html = mineHomeCardHtml(); if (refreshDash.mineHome !== html) { refreshDash.mineHome = html; SD.html(mh, html) } }
      const tx = $('recentTxHost')
      if (tx) { const html = window.SCDODash.txHtml(recentTx(), T, esc); if (refreshDash.tx !== html) { refreshDash.tx = html; SD.html(tx, html) } }
    } else if (st.tab === 'acc') {
      const host = $('accList'); if (host) { const html = accListHtml(); if (refreshDash.acc !== html) { refreshDash.acc = html; SD.html(host, html) } }
    } else if (st.tab === 'mine') {
      const host = $('mineSlots'); if (host) { const html = mineSlotsHtml(); if (refreshDash.mine !== html) { refreshDash.mine = html; SD.html(host, html) } }
    }
  }
  function backHome () {
    return `<div class="back-home-row"><button type="button" class="link back-home" data-act="goHome" id="backHome">${esc(T('goHome'))}</button></div>`
  }
  // 帳戶 page: every visible account, grouped Shard0 EVM, Shard1, Shard2, Shard3, Shard4. Read-only (copy and QR).
  function accRow (a, chain) {
    const addr = chain === 'new' ? a.evm : ((parseClassicAddress(a.pubkey) || {}).address || a.pubkey)
    let bal
    if (chain === 'new') { const b = st.s0[a.filename]; bal = !a.evm ? '' : (b && b.nativeWei != null ? fmtWei(b.nativeWei) : '…') } else { const v = fmtOld(a.pubkey); bal = v != null ? v : '…' }
    const tools = addr ? `<span class="mono">${esc(addr)}</span><button type="button" class="ico" data-act="copy" data-v="${esc(addr)}" title="${esc(T('d_copyAddr'))}" aria-label="${esc(T('d_copyAddr'))}">${window.SCDODash.COPY_SVG}</button><button type="button" class="ico" data-act="receive" data-f="${esc(a.filename)}" data-chain="${chain}" title="${esc(T('d_showQr'))}" aria-label="${esc(T('d_showQr'))}">${window.SCDODash.QR_SVG}</button>` : `<span class="muted">${esc(T('d_addrLocked'))}</span>`
    return `<div class="acc-ro">${avatar(accLabel(a))}<div class="acc-ro-main"><div class="nm wrap">${esc(accLabel(a))}</div><div class="addr-row"><span class="lbl">${esc(T('d_addr'))}</span>${tools}</div></div>${bal ? `<div class="acc-ro-bal"><span class="lbl">${esc(T('d_balance'))}</span><b>${esc(bal)}</b> <span class="lbl">SCDO</span></div>` : ''}</div>`
  }
  function accListHtml () {
    let h = ''
    const groups = [['new', 0, visible('new')]].concat([1, 2, 3, 4].map(n => ['old', n, classicOn(n)]))
    for (const [chain, n, list] of groups) {
      h += `<div class="card acc-group" data-acc-group="${n}"><div class="sec-h" style="margin:0 0 6px">${esc(CHAIN_NAMES[n])}</div>`
      h += list.length ? list.map(a => accRow(a, chain)).join('') : `<div class="muted">${esc(T('d_addrNone'))}</div>`
      h += '</div>'
    }
    const nHid = new Set(ui.hidden.new.concat(ui.hidden.old)).size
    if (nHid) h += `<div class="hint-box">👁 ${esc(T('hiddenHint', { n: nHid }))}</div>`
    return h
  }
  function pageAcc () {
    return `<div class="page dash" id="accPage"><div class="dash-h"><span class="h1">${esc(T('d_accPageTitle'))}</span><span class="lbl">${esc(T('d_accPageLead'))}</span></div><div id="accList">${accListHtml()}</div></div>`
  }
  // 挖礦 page: read-only status of the three miners
  function mineSlotsHtml () {
    const slots = [['shard0', 'd_slotS0'], ['classicCpu', 'd_slotCpu'], ['classicGpu', 'd_slotGpu']]
    return slots.map(([k, title]) => {
      const m = (st.miners && st.miners[k]) || {}
      const on = !!m.running
      const rows = [[T('d_slotState'), on ? minerText(m) : T('d_pillIdle')]]
      if (k !== 'shard0') rows.push([T('d_slotShard'), m.shard ? 'Shard' + m.shard : T('d_none')])
      rows.push([T('d_speed'), on ? speedText(m.hashrate, true) : T('d_notMining')])
      rows.push([T('d_blocksLbl'), blockText(m.blocksFound)])
      if (k !== 'shard0') rows.push([T('acceptedShares'), shareText(m.sharesAccepted, m.sharesRejected)])
      if (k === 'classicCpu') { const ps = m.poolStats || {}; rows.push([T('poolPending'), scdoLine('minePendingLine', ps.pending)]); rows.push([T('poolPaid'), scdoLine('minePaidLine', ps.paid)]) }
      rows.push([T('d_net'), peerText(m.peers)])
      rows.push([T('d_slotWallet'), m.wallet || m.payout || T('d_none')])
      return `<div class="card dc chain mine-slot" data-slot="${k}"><div class="top"><span class="dot ${on ? 'ok' : ''}"></span><span class="nm">${esc(T(title))}</span><span class="state ${!on ? 'off' : minerClass(m) === 'bad' ? 'bad' : minerClass(m) === 'good' ? 'on' : 'warn'}">${esc(!on ? T('d_pillIdle') : minerClass(m) === 'bad' ? T('d_pillError') : m.mode === 'node' ? T('d_pillNode') : minerClass(m) === 'good' ? T('d_slotOn') : T('d_pillSyncing'))}</span></div>
        <div class="kv">${rows.map(([l, v]) => `<div class="kv-item"><span class="lbl">${esc(l)}</span><b class="wrap">${esc(v)}</b></div>`).join('')}</div></div>`
    }).join('')
  }
  function pageMine () {
    return `<div class="page dash" id="minePage"><div class="dash-h"><span class="h1">${esc(T('d_minePageTitle'))}</span><span class="lbl">${esc(T('d_minePageLead'))}</span></div>${window.SCDODash.tempKeyHtml(T, esc)}<div class="chains" id="mineSlots">${mineSlotsHtml()}</div></div>`
  }

  // ---------------- mining ----------------
  function minerText (m) {
    if (!m) return T('st_IDLE')
    const code = m.code || 'IDLE'
    // zh-Hant never pastes the English miner sentence into 「出錯：{m}」.
    if (lang() === 'CN' && code === 'ERROR') return window.SCDOStartError.full('CN', code, m.message)
    const p = { l: heightWord(m.localBlock), n: heightWord(m.networkBlock), w: m.wallet || '', m: lang() === 'CN' ? '' : (m.message || ''), shard: m.shard || '', eta: fmtSyncEta(m.syncEtaSec) }
    let s = T('st_' + code, p)
    if (s === 'st_' + code) s = lang() === 'CN' ? window.SCDOStartError.full('CN', code, m.message) : (m.message || code)
    if (code === 'DOWNLOADING' && m.download && m.download.total) s += ' ' + Math.round(100 * m.download.got / m.download.total) + '%'
    return s
  }
  function fmtSyncEta (sec) {
    const cn = lang() === 'CN'
    const n = Number(sec)
    if (sec == null || !Number.isFinite(n) || n < 0) return cn ? '還在算' : 'still working it out'
    if (n < 5) return cn ? '還在算' : 'still working it out'
    const s = Math.round(n)
    const plural = (k, word) => k + ' ' + word + (k === 1 ? '' : 's')
    if (s < 60) return cn ? (s + ' 秒') : plural(s, 'second')
    const mins = Math.round(s / 60)
    if (mins < 60) return cn ? (mins + ' 分鐘') : plural(mins, 'minute')
    const h = Math.floor(mins / 60)
    const rm = mins % 60
    const hours = cn ? (h + ' 小時') : plural(h, 'hour')
    if (!rm || h >= 10) return hours
    return hours + ' ' + (cn ? (rm + ' 分鐘') : plural(rm, 'minute'))
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
    const sel = addrSelect('mClassic', opts, cur, running, T('classicAddrPh', { n: shard, p: shard + 'S0' + shard }), T('rewardOtherClassic')) + (opts.length ? '' : `<div class="lbl" style="margin-top:6px">${esc(T('noClassicAddr'))}</div>`)
    const pool = (caps.pools && caps.pools[shard]) || {}
    const buttons = [['cpu', T('classicCpu'), false], ['gpu', T('classicGpu'), !gpuOn]]
    if (extOn) buttons.push(['external', T('classicGpuCustom'), false])
    let h = `<div class="shardchips">${buttons.map(([id, label, dis]) => `<button type="button" class="${backend === id ? 'on' : ''}" data-act="mineBackend" data-v="${id}" ${dis ? 'disabled' : ''}>${esc(label)}</button>`).join('')}</div>`
    if (!gpuOn) h += `<div class="lbl">${esc(T('classicGpuOff'))}</div>`
    if (backend === 'cpu' && caps.cpu && caps.cpu.available === false) h += `<div class="lbl">${esc(T('classicCpuMissing'))}</div>`
    h += `<div class="field" style="margin-top:14px"><div class="lbl" style="font-weight:600">${esc(T('classicAddr'))}</div>${sel}</div>`
    const showPool = backend === 'cpu' || (backend === 'external' && !(caps.external && caps.external.solo))
    if (showPool && pool.stratum) {
      h += `<div class="lbl explain" tabindex="0" data-tip-name="${esc(T('poolEndpoint'))}" data-tip-value="${esc(pool.stratum)}" data-tip-explain="${esc(T('poolTip'))}" data-tip-detail="">${esc(T('poolEndpoint'))}${PU.c()}${esc(pool.stratum)}</div>`
      if (shard !== 1 && backend === 'cpu') h += `<div class="lbl">${esc(T('poolLater'))}</div>`
    }
    if (backend === 'cpu') {
      const threads = threadCount(); const max = cpuCount()
      const cores = T('cpuCoresLine', { n: threads, max: max })
      h += `<div class="field"><div class="lbl explain" id="mThreadsLab" tabindex="0" data-tip-name="${esc(T('cpuCoresName'))}" data-tip-value="${esc(cores)}" data-tip-explain="${esc(T('mineTipCpu'))}" data-tip-detail="">${esc(cores)}</div>
        <input type="range" class="threads" id="mThreads" min="1" max="${max}" step="1" value="${threads}" ${running ? 'disabled' : ''}></div>
        <div class="lbl">${esc(T('cpuThreadsHint'))}</div>`
    } else if (backend === 'gpu') {
      const g = gpuParams()
      h += `<div class="row" style="gap:12px;flex-wrap:wrap;margin-top:10px">
        <label class="lbl explain" tabindex="0" data-tip-name="${esc(T('gpuThreads'))}" data-tip-value="${esc(String(g.threads))}" data-tip-explain="${esc(T('mineTipGpu'))}" data-tip-detail="">${esc(T('gpuThreads'))}<br><input class="inp half" id="mGpuThreads" inputmode="numeric" value="${g.threads}" ${running ? 'disabled' : ''}></label>
        <label class="lbl explain" tabindex="0" data-tip-name="${esc(T('gpuBlocks'))}" data-tip-value="${esc(String(g.threadblocks))}" data-tip-explain="${esc(T('mineTipGpu'))}" data-tip-detail="">${esc(T('gpuBlocks'))}<br><input class="inp half" id="mThreadBlocks" inputmode="numeric" value="${g.threadblocks}" ${running ? 'disabled' : ''}></label>
        <label class="lbl explain" tabindex="0" data-tip-name="${esc(T('gpuBlockThreads'))}" data-tip-value="${esc(String(g.blockthreads))}" data-tip-explain="${esc(T('mineTipGpu'))}" data-tip-detail="">${esc(T('gpuBlockThreads'))}<br><input class="inp half" id="mBlockThreads" inputmode="numeric" value="${g.blockthreads}" ${running ? 'disabled' : ''}></label>
      </div>`
    }
    const active = running && m.chain === 'classic'
    const young = m.startedAt && (Date.now() - m.startedAt < 600000)
    const hr = speedText(m.hashrate, active)
    const shares = shareText(m.sharesAccepted, m.sharesRejected)
    const found = blockText(m.blocksFound)
    const pending = scdoLine('minePendingLine', m.poolStats && m.poolStats.pending)
    const paid = scdoLine('minePaidLine', m.poolStats && m.poolStats.paid)
    const rate = rateText(active && m.blocksFound > 0, young, m.blockRatePerHour)
    h += `<div class="stats">
        ${statHtml('mHr', T('hashrate'), hr, tipPack(T('hashrate'), hr, T('mineTipSpeed'), T('mineTipSpeedDetail', { n: groupedTries(m.hashrate) || T('isleUnknown') })))}
        ${statHtml('mAcc', T('acceptedShares'), shares, tipPack(T('acceptedShares'), shares, T('mineTipShares')))}
        ${statHtml('mFound', T('blocksFound'), found, tipPack(T('blocksFound'), found, T('mineTipBlocks')))}
        ${backend === 'cpu'
          ? statHtml('mPending', T('poolPending'), pending, tipPack(T('poolPending'), pending, T('mineTipPending'))) + statHtml('mPaid', T('poolPaid'), paid, tipPack(T('poolPaid'), paid, T('mineTipPaid')))
          : statHtml('mRate', T('blockRate'), rate, tipPack(T('blockRate'), rate, T('mineTipRate')))}
      </div>
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
  // 挖礦設定 (menu → 挖礦設定; the old 更改出塊獎勵地址 item opened this same page): shard, reward address, and the node. Start and stop mining stay on the Home card.
  function pageMineSet () {
    st.miner = viewMiner()
    const m = st.miner || {}
    const running = !!m.running
    const mineShard = [0, 1, 2, 3, 4].includes(Number(st.mineShard)) ? Number(st.mineShard) : 0
    let h = `<div class="page"><div class="card mine-card"><div style="font-size:30px;font-weight:700">${esc(T('d_mineSetTitle'))}</div><div class="lbl">${esc(T('d_mineSetLead'))}</div>`
    h += `<div class="shardchips" id="mineShards">${[0, 1, 2, 3, 4].map(n => `<button type="button" class="${mineShard === n ? 'on' : ''}" data-act="mineShard" data-v="${n}">${esc(n ? T('mineShardN', { n }) : T('mineShard0'))}</button>`).join('')}</div>`
    h += `<div class="lbl" style="margin-top:8px">${esc(T('mineTogether'))}</div>`
    h += `<div class="lbl" style="margin-top:8px">${esc(T('mineStartOnHome'))}</div>`
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
    const statusBar = ''
    const peerLine = peerText(m.peers)
    const blocks = statHtml('mPeers', T('peers'), peerLine, tipPack(T('peers'), peerLine, T('mineTipPeer')))
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
        <div class="stats">${statHtml('mHr', T('hashrate') + (mineMode ? '' : ' ' + T('hashrateHint')), speedText(m.hashrate, mineMode), tipPack(T('hashrate'), speedText(m.hashrate, mineMode), T('mineTipSpeed'), T('mineTipSpeedDetail', { n: groupedTries(m.hashrate) || T('isleUnknown') })))}
        ${statHtml('mFound', T('blocksFound'), blockText(m.blocksFound), tipPack(T('blocksFound'), blockText(m.blocksFound), T('mineTipBlocks')))}${blocks}</div>
        <div class="row" style="margin-top:22px;flex-wrap:wrap;gap:18px">
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
      h += `${extOk ? '' : statusBar}<div class="stats">${statHtml('mNodeState', T('nodeState'), nodeStateText(m), tipPack(T('nodeState'), nodeStateText(m), T('mineTipNode')))}${blocks}</div>
        <div class="row" style="margin-top:22px;flex-wrap:wrap">
        ${ext ? `<button class="btn ghost" data-act="minerStop" id="btnNode">${esc(T('stopWatch'))}</button>` : running ? `<button class="btn dan big" data-act="minerStop" id="btnNode">${esc(T('stopNode'))}</button>` : `<button class="btn pri big" data-act="nodeStart" id="btnNode">${esc(T('runNode'))}</button>`}</div>
        <div class="lbl" style="margin-top:10px">${esc(ext ? T('extNoStop') : T('nodeHint'))}</div>`
    }
    h += mineAdvanced(api.platform === 'win32' && g.nvidia, m)
    return h + '</div><div id="miningBatch1"></div></div>'
  }

  // ---------------- 2.0.12 remittance gateway: unlock + personal_sign, no KYC form ----------------
  // The 匯款 tab is gone. payModal is the only entry. This block stays next to remitLogin:
  // keyfile decryption, personal_sign and the bearer token all stay in the main process.
  // The screen only receives the signed-in address and that address's own ledger.
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
    const inPay = !!$('payRoute')
    st.remit.phase = 'challenge'; st.remit.error = ''; st.remit.address = ''; st.remit.ledger = null
    if (inPay) { const el = $('payStatus'); if (el) el.textContent = T('remitChallenge') }
    else render()
    let r = null
    try { r = await api.invoke('remit:login', a.filename, pw) } catch (e) { r = { ok: false, error: String((e && e.message) || e) } }
    await reloadAccounts()
    const own = (accByFile(a.filename) || {}).evm
    if (r && r.ok && (!own || sameAddr(own, r.address))) {
      st.remit = { phase: 'in', error: '', address: r.address, ledger: r.ledger, base: st.remit.base }
      toast(T('remitIn'))
      if (inPay && $('payRoute')) payShowLedger()
      else render()
    } else {
      if (r && r.ok) { api.invoke('remit:logout').catch(() => {}); r = { ok: false, foreign: true } }
      st.remit.phase = 'error'; st.remit.address = ''; st.remit.ledger = null
      st.remit.error = remitErrText(r)
      if (inPay && $('payErr')) $('payErr').textContent = st.remit.error
      else render()
    }
    refreshS0()
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
  api.on('remit:step', (p) => {
    if (!['challenge', 'sign', 'session', 'ledger'].includes(p) || st.remit.phase === 'in' || st.remit.phase === 'error' || st.remit.phase === 'idle') return
    st.remit.phase = p
    const el = $('payStatus')
    if (!el) return
    el.textContent = p === 'challenge' ? T('remitChallenge') : p === 'sign' ? T('remitSigning') : p === 'session' ? T('remitSession') : T('remitLedgerLoad')
  })

  // ---------------- render ----------------
  function render () {
    loadAccounts()
    renderHeader()
    const main = $('main')
    const y = main.scrollTop
    const pages = { home: pageHome, acc: pageAcc, mine: pageMine, mineSet: pageMineSet }
    SD.html(main, (st.tab === 'home' ? '' : backHome()) + (pages[st.tab] || pageHome)())
    refreshDash.cards = refreshDash.tx = refreshDash.acc = refreshDash.mine = refreshDash.earn = refreshDash.mineHome = null
    document.body.classList.toggle('on-home', st.tab === 'home') // 3.0.4 (v9): the earnings card replaces the header island on Home
    if (st.tab === 'mineSet') mountMining(); else window.SCDOMining.MiningPage.unmount()
    renderFooter()
    const want = st.scrollTo; st.scrollTo = null
    const to = want && want !== 'top' ? $(want) : null
    if (want === 'top' || (to && to.id === 'secOld')) main.scrollTop = 0
    else if (to) main.scrollTop = Math.max(0, to.offsetTop - main.offsetTop - 8)
    else main.scrollTop = y
    document.title = (lang() === 'CN' ? 'SCDO 錢包 ' : 'SCDO Wallet ') + APPVER
  }
  function mountMining () {
    const root = $('miningBatch1'); if (!root) { try { window.SCDOMining.MiningPage.unmount() } catch (e) {} return }
    window.SCDOMining.MiningPage.mount(root, { miner: st.miner, toast, rerender: () => { if (st.tab === 'mineSet' && !$('md') && !(document.activeElement && document.activeElement.id === 'poolUrl')) render() } })
  }
  // cheap updates of numbers without re-rendering inputs the user may be typing into
  function renderLive () {
    renderHeaderNetOnly()
    renderIsland()
    refreshDash()
  }
  // 2.0.6: mining status is always visible in the top bar (running / stopped, hashrate, pool)
  function poolLabel (m) {
    if (m.mode === 'pool' && m.poolUrl) return String(m.poolUrl).replace(/^[a-z0-9+]+:\/\//i, '')
    return T('poolLocal')
  }
  function currentMinePill () {
    const shard0 = (st.miners && st.miners.shard0) || st.miner
    const miners = {
      shard0: shard0 && shard0.chain === 'classic' ? null : shard0,
      classicCpu: st.miners && st.miners.classicCpu,
      classicGpu: st.miners && st.miners.classicGpu
    }
    const x = window.SCDOMinePill.formatMinePill(miners, T)
    const s0 = miners.shard0 || {}
    if (s0.running && s0.mode !== 'node' && s0.phase !== 'error') {
      const hr = s0.code === 'MINING' && s0.hashrate > 0 ? ' · ' + speedText(s0.hashrate, true) : ''
      x.t += hr + ' · ' + T('poolLbl') + ' ' + poolLabel(s0)
    }
    return x
  }
  function headerBalanceText () {
    const a = headerAccount()
    if (!a) return T('noAccount')
    const name = String(accLabel(a) || '').trim()
    let amt
    if (headerChain() === 'old') {
      const v = fmtOld(a.pubkey)
      amt = (v != null ? v : '…') + ' SCDO'
    } else if (!a.evm) amt = T('lockedShort')
    else {
      const b = st.s0[a.filename]
      amt = (b && b.nativeWei != null ? fmtWei(b.nativeWei) : '…') + ' SCDO'
    }
    return (name ? name + ' ' : '') + amt
  }
  function headerBalanceName () {
    const a = headerAccount()
    return a ? String(accLabel(a) || '').trim() : ''
  }
  function headerBalanceMark () {
    const name = headerBalanceName()
    return name ? name[0].toUpperCase() : ''
  }
  function earnEvents () {
    const out = []
    const push = (m, shard) => {
      if (!m || !Array.isArray(m.blocksFoundHeights) || shard == null || !Number.isFinite(Number(shard))) return
      for (const h of m.blocksFoundHeights) out.push({ shard: Number(shard), height: h })
    }
    const s0 = (st.miners && st.miners.shard0) || st.miner
    push(s0 && s0.chain !== 'classic' ? s0 : null, 0)
    const cpu = st.miners && st.miners.classicCpu
    const gpu = st.miners && st.miners.classicGpu
    push(cpu, cpu && cpu.shard)
    push(gpu, gpu && gpu.shard)
    return out
  }
  function noteEarn () {
    let prev = null
    try { prev = JSON.parse(localStorage.getItem('mineEarn112') || 'null') } catch (e) { prev = null }
    const next = window.SCDOIsland.absorbBlocks(prev, earnEvents(), Date.now())
    try { localStorage.setItem('mineEarn112', JSON.stringify(next)) } catch (e) {}
    st.earn = next
    return next
  }
  function islandModel (summary) {
    const earn = st.earn || noteEarn()
    return window.SCDOIsland[summary ? 'summaryIsland' : 'buildIsland']({
      shard0: (st.miners && st.miners.shard0) || st.miner,
      classicCpu: st.miners && st.miners.classicCpu,
      classicGpu: st.miners && st.miners.classicGpu,
      temps: st.gpuTemp && st.gpuTemp.gpus,
      earnLog: earn,
      now: Date.now(),
      balanceText: headerBalanceText(),
      balanceMark: headerBalanceMark(),
      balanceName: headerBalanceName(),
      T,
      etaText: fmtSyncEta,
      hashText: (h) => speedText(h, true)
    })
  }
  function chipClass (c) {
    const tone = c.kind === 'earn' || c.kind === 'bal' ? 'gold' : c.kind
    let cls = 'isle-chip ' + tone
    if (c.kind === 'earn') cls += ' earn'
    if (c.kind === 'bal') cls += ' bal'
    if (c.kind === 'temp' && c.band) cls += ' temp-' + c.band
    if (c.live) cls += ' live'
    if ((c.kind === 'sync' || c.kind === 'eta') && c.progress < 0.995) cls += ' shimmer'
    return cls
  }
  function chipEl (c) {
    const el = document.createElement('span')
    el.setAttribute('data-key', c.key || c.kind)
    el.className = chipClass(c)
    if (c.kind === 'sync' || c.kind === 'eta') el.style.setProperty('--sync', String(c.progress || 0))
    if (c.kind === 'sync') {
      const bar = document.createElement('i')
      bar.className = 'isle-bar'
      bar.style.width = Math.round((c.progress || 0) * 100) + '%'
      el.appendChild(bar)
    }
    if (c.live) {
      const icon = document.createElement('span')
      icon.className = 'isle-spin'
      icon.setAttribute('aria-hidden', 'true')
      icon.textContent = '\u26CF'
      el.appendChild(icon)
    }
    if (c.mark) {
      const av = document.createElement('span')
      av.className = 'isle-av'
      paintAvatar(av, c)
      el.appendChild(av)
    }
    const val = document.createElement('span')
    val.className = 'isle-val'
    val.textContent = c.text
    el.appendChild(val)
    armChip(el, c)
    return el
  }
  function paintAvatar (av, c) {
    if (av.textContent !== c.mark) av.textContent = c.mark
    const name = c.name || ''
    if (av.title !== name) av.title = name
    if (av.getAttribute('aria-label') !== name) av.setAttribute('aria-label', name)
    if (av.getAttribute('role') !== 'img') av.setAttribute('role', 'img')
  }
  function applyChipFace (el, c) {
    el.className = chipClass(c)
    if (c.kind === 'sync' || c.kind === 'eta') el.style.setProperty('--sync', String(c.progress || 0))
    const bar = el.querySelector('.isle-bar')
    if (bar) bar.style.width = Math.round((c.progress || 0) * 100) + '%'
  }
  function syncChip (el, c) {
    applyChipFace(el, c)
    let bar = el.querySelector('.isle-bar')
    if (c.kind === 'sync') {
      if (!bar) {
        bar = document.createElement('i')
        bar.className = 'isle-bar'
        el.insertBefore(bar, el.firstChild)
      }
      bar.style.width = Math.round((c.progress || 0) * 100) + '%'
    } else if (bar) bar.remove()
    let spin = el.querySelector('.isle-spin')
    if (c.live) {
      if (!spin) {
        spin = document.createElement('span')
        spin.className = 'isle-spin'
        spin.setAttribute('aria-hidden', 'true')
        spin.textContent = '\u26CF'
        const val = el.querySelector('.isle-val')
        el.insertBefore(spin, val || null)
      }
    } else if (spin) spin.remove()
    const val = el.querySelector('.isle-val')
    let av = el.querySelector('.isle-av')
    if (c.mark) {
      if (!av) {
        av = document.createElement('span')
        av.className = 'isle-av'
        el.insertBefore(av, val || null)
      }
      paintAvatar(av, c)
    } else if (av) av.remove()
    armChip(el, c)
    if (val && val.textContent !== c.text) {
      val.textContent = c.text
      el.classList.remove('isle-tick')
      void el.offsetWidth
      el.classList.add('isle-tick')
    }
    const pop = $('islePop')
    if (islePopAnchor === el && pop && !pop.hidden && c.tip) {
      fillIslePop(c.tip)
      placeIslePop(el)
    }
  }
  function paintChipRow (host, chips) {
    const list = chips || []
    const have = {}
    for (const el of host.children) {
      const k = el.getAttribute('data-key')
      if (k && !have[k]) have[k] = el
    }
    const keep = {}
    list.forEach(c => {
      const key = c.key || c.kind
      keep[key] = true
      let el = have[key]
      if (!el) el = chipEl(c)
      else syncChip(el, c)
      host.appendChild(el)
    })
    for (const el of [...host.children]) {
      if (!keep[el.getAttribute('data-key')]) el.remove()
    }
    if (islePopAnchor && !islePopAnchor.isConnected) closeIslePop(true)
  }
  function ensureLine (compact, id, className) {
    let line = compact.querySelector('#' + id)
    if (!line) {
      line = document.createElement('div')
      line.id = id
      line.className = className
      compact.appendChild(line)
    }
    return line
  }
  function miningBusy () {
    const cpu = st.miners && st.miners.classicCpu
    const gpu = st.miners && st.miners.classicGpu
    const s0 = (st.miners && st.miners.shard0) || st.miner
    if (cpu && cpu.running) return true
    if (gpu && gpu.running) return true
    return !!(s0 && s0.running && s0.mode !== 'node')
  }
  // 3.0.2 (v8): no quick buttons anywhere on the panels. Start / stop live in AI小貓 and the File menu.
  function renderActBar () {}
  function renderIsland () {
    const compact = $('islandCompact')
    if (!compact || !window.SCDOIsland) return
    if (islePopAnchor && !islePopAnchor.isConnected) closeIslePop(true)
    const model = islandModel(true)
    compact.removeAttribute('title')
    paintChipRow(ensureLine(compact, 'islandLine', 'island-line'), model.chips)
    const bot = ensureLine(compact, 'islandMoney', 'island-line island-money')
    bot.id = 'islandMoney'
    paintChipRow(bot, model.money)
    ensureIsleHelp(compact)
    renderIsleLegend(model.legend || [])
    renderActBar()
  }
  let islePopTimer = 0
  let islePopHideTimer = 0
  let islePopToken = 0
  let islePopPinned = false
  let islePopAnchor = null
  let isleLegendOn = false
  function islePopBox () {
    let el = $('islePop')
    if (el) return el
    el = document.createElement('div')
    el.id = 'islePop'
    el.className = 'isle-pop'
    el.setAttribute('role', 'tooltip')
    el.hidden = true
    el.addEventListener('mouseenter', () => { clearTimeout(islePopHideTimer) })
    el.addEventListener('mouseleave', () => { if (!islePopPinned) queueIslePopHide() })
    document.body.appendChild(el)
    return el
  }
  function fillIslePop (tip) {
    const el = islePopBox()
    el.textContent = ''
    const name = document.createElement('b')
    name.className = 'isle-pop-name'
    name.textContent = tip.name || ''
    const value = document.createElement('div')
    value.className = 'isle-pop-value'
    value.textContent = tip.value || ''
    const explain = document.createElement('p')
    explain.className = 'isle-pop-explain'
    explain.textContent = tip.explain || ''
    el.appendChild(name)
    el.appendChild(value)
    el.appendChild(explain)
    if (tip.detail) {
      const detail = document.createElement('p')
      detail.className = 'isle-pop-detail'
      detail.textContent = tip.detail
      el.appendChild(detail)
    }
    return el
  }
  function placeIslePop (anchor) {
    const el = islePopBox()
    el.hidden = false
    el.style.left = '0px'
    el.style.top = '0px'
    const r = anchor.getBoundingClientRect()
    const w = el.offsetWidth
    const h = el.offsetHeight
    const margin = 8
    let left = r.left
    let top = r.bottom + 8
    if (top + h > window.innerHeight - margin) top = r.top - h - 8
    if (top < margin) top = margin
    if (left + w > window.innerWidth - margin) left = window.innerWidth - w - margin
    if (left < margin) left = margin
    el.style.left = Math.round(left) + 'px'
    el.style.top = Math.round(top) + 'px'
  }
  function tipFromAnchor (anchor) {
    if (!anchor) return null
    if (anchor._isleTip && anchor._isleTip.explain) return anchor._isleTip
    if (!anchor.getAttribute) return null
    const explain = anchor.getAttribute('data-tip-explain')
    if (!explain) return null
    return {
      name: anchor.getAttribute('data-tip-name') || '',
      value: anchor.getAttribute('data-tip-value') || '',
      explain: explain,
      detail: anchor.getAttribute('data-tip-detail') || ''
    }
  }
  function dismissIsleLegend () {
    if (!isleLegendOn) return
    isleLegendOn = false
    const box = $('isleLegend')
    if (box) box.remove()
  }
  function openIslePop (anchor, pin) {
    const tip = tipFromAnchor(anchor)
    if (!tip || !tip.explain) return
    clearTimeout(islePopTimer)
    clearTimeout(islePopHideTimer)
    dismissIsleLegend()
    if (islePopAnchor && islePopAnchor !== anchor) islePopAnchor.removeAttribute('aria-describedby')
    fillIslePop(tip)
    anchor.setAttribute('aria-describedby', 'islePop')
    islePopAnchor = anchor
    if (pin) islePopPinned = true
    placeIslePop(anchor)
  }
  function closeIslePop (force) {
    if (islePopPinned && !force) return
    islePopPinned = false
    clearTimeout(islePopTimer)
    const el = $('islePop')
    if (el) el.hidden = true
    if (islePopAnchor) { islePopAnchor.removeAttribute('aria-describedby'); islePopAnchor = null }
  }
  function queueIslePop (anchor) {
    const token = ++islePopToken
    clearTimeout(islePopTimer)
    clearTimeout(islePopHideTimer)
    islePopTimer = setTimeout(() => { if (token === islePopToken) openIslePop(anchor, false) }, 300)
  }
  function queueIslePopHide () {
    islePopToken++
    clearTimeout(islePopTimer)
    clearTimeout(islePopHideTimer)
    islePopHideTimer = setTimeout(() => closeIslePop(false), 200)
  }
  function armChip (el, c) {
    el._isleTip = c.tip || null
    if (el._isleArmed) return
    el._isleArmed = true
    if (el.tagName !== 'BUTTON') el.tabIndex = 0
    el.addEventListener('mouseenter', () => queueIslePop(el))
    el.addEventListener('mouseleave', () => queueIslePopHide())
    el.addEventListener('focus', () => openIslePop(el, false))
    el.addEventListener('blur', () => queueIslePopHide())
    el.addEventListener('click', (ev) => {
      ev.stopPropagation()
      openIslePop(el, true)
    })
  }
  document.addEventListener('mouseover', (ev) => {
    const el = ev.target.closest && ev.target.closest('.explain')
    if (!el) return
    const from = ev.relatedTarget && ev.relatedTarget.closest && ev.relatedTarget.closest('.explain')
    if (from === el) return
    queueIslePop(el)
  })
  document.addEventListener('mouseout', (ev) => {
    const el = ev.target.closest && ev.target.closest('.explain')
    if (!el) return
    const to = ev.relatedTarget && ev.relatedTarget.closest && ev.relatedTarget.closest('.explain')
    if (to === el) return
    queueIslePopHide()
  })
  document.addEventListener('focusin', (ev) => {
    const el = ev.target.closest && ev.target.closest('.explain')
    if (el) openIslePop(el, false)
  })
  document.addEventListener('focusout', (ev) => {
    const el = ev.target.closest && ev.target.closest('.explain')
    if (!el) return
    const to = ev.relatedTarget && ev.relatedTarget.closest && ev.relatedTarget.closest('.explain')
    if (to === el) return
    queueIslePopHide()
  })
  function ensureIsleHelp (compact) {
    let btn = compact.querySelector('#isleHelp')
    if (!btn) {
      btn = document.createElement('button')
      btn.type = 'button'
      btn.id = 'isleHelp'
      btn.className = 'isle-help'
      btn.setAttribute('data-act', 'isleHelp')
      btn.textContent = '?'
      compact.appendChild(btn)
    }
    btn.setAttribute('aria-label', T('isleHelpBtn'))
  }
  function renderIsleLegend (items) {
    let box = $('isleLegend')
    if (!isleLegendOn) { if (box) box.remove(); return }
    if (!box) {
      box = document.createElement('div')
      box.id = 'isleLegend'
      box.className = 'isle-legend'
      box.setAttribute('role', 'dialog')
      box.setAttribute('aria-modal', 'true')
      document.body.appendChild(box)
    }
    box.textContent = ''
    const h = document.createElement('h2')
    h.textContent = T('isleHelpTitle')
    box.appendChild(h)
    ;(items || []).forEach(it => {
      const p = document.createElement('p')
      const b = document.createElement('b')
      b.textContent = it.name || ''
      p.appendChild(b)
      p.appendChild(document.createTextNode((it.name ? (lang() === 'CN' ? '。' : ': ') : '') + (it.text || '')))
      box.appendChild(p)
    })
    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'btn sec'
    close.setAttribute('data-act', 'isleHelpClose')
    close.textContent = T('isleHelpClose')
    box.appendChild(close)
  }
  function renderHeaderNetOnly () {
    document.querySelectorAll('[data-netdot]').forEach(d => {
      const ok = d.getAttribute('data-netdot') === 'old' ? st.net.oldOk : st.net.s0Ok
      d.className = 'dot ' + (ok == null ? '' : ok ? 'ok' : 'bad')
    })
  }
  function renderMinerLive () {
    if (st.tab !== 'mineSet' || $('md')) return
    st.miner = viewMiner()
    const m = st.miner || {}
    const e = $('minerStatus')
    const sig = [!!m.running, m.mode, m.chain, m.phase === 'error', m.phase === 'external', m.code === 'EXTERNAL_DOWN', m.code].join('|')
    const focusKeep = ['mReward', 'nPayout', 'mReward-in', 'nPayout-in', 'poolUrl', 'mClassic', 'mClassic-in', 'mThreads', 'mGpuThreads', 'mThreadBlocks', 'mBlockThreads']
    if (sig !== renderMinerLive.sig || (!e && !$('extOk'))) { renderMinerLive.sig = sig; if (!(document.activeElement && focusKeep.includes(document.activeElement.id))) render(); return }
    if (e) {
      const cls = 'statusbar ' + minerClass(m)
      if (e.className !== cls) e.className = cls
      const label = minerText(m)
      if (e.textContent !== label) e.textContent = label
    }
    const set = (id, v, detail) => {
      const x = $(id)
      if (!x) return
      const s = v == null ? '' : String(v)
      if (x.textContent === s) return
      x.textContent = s
      const box = x.closest && x.closest('.explain')
      if (!box) return
      box.setAttribute('data-tip-value', s)
      if (detail != null) box.setAttribute('data-tip-detail', detail)
      if (islePopAnchor === box && $('islePop') && !$('islePop').hidden) fillIslePop(tipFromAnchor(box))
    }
    const netH = m.networkBlock == null || !(Number(m.networkBlock) > 0) ? (st.net.s0Block == null ? '…' : st.net.s0Block) : m.networkBlock
    set('mBlocks', heightWord(m.localBlock) + ' · ' + heightWord(netH))
    set('mPeers', peerText(m.peers))
    if (m.running && (m.mode === 'mine' || m.mode === 'pool' || m.chain === 'classic')) set('mHr', speedText(m.hashrate, true), T('mineTipSpeedDetail', { n: groupedTries(m.hashrate) || T('isleUnknown') }))
    set('mFound', blockText(m.blocksFound))
    if (m.chain === 'classic') {
      set('mAcc', shareText(m.sharesAccepted, m.sharesRejected))
      const ps = m.poolStats || {}
      set('mPending', scdoLine('minePendingLine', ps.pending))
      set('mPaid', scdoLine('minePaidLine', ps.paid))
      const young = m.startedAt && (Date.now() - m.startedAt < 600000)
      set('mRate', rateText(m.blocksFound > 0, young, m.blockRatePerHour))
    }
    const ns = $('mNodeState')
    if (ns) set('mNodeState', nodeStateText(m))
    const lg = $('mLog')
    if (lg && st.logOpen) {
      const text = window.SCDOMining.minerLogger.displayLines(m.logTail, 80).join('\n')
      if (lg.textContent !== text) {
        lg.textContent = text
        lg.scrollTop = lg.scrollHeight
      }
    }
  }
  // Hashrate and log lines can arrive dozens of times a second. Paint once per second, in one frame.
  let minerDomRaf = 0
  let minerDomTimer = null
  let minerDomAt = 0
  function scheduleMinerDom () {
    const wait = minerDomAt + 1000 - Date.now()
    if (wait > 0) {
      if (minerDomTimer != null) return
      minerDomTimer = setTimeout(() => { minerDomTimer = null; scheduleMinerDom() }, wait)
      return
    }
    if (minerDomRaf) return
    minerDomRaf = requestAnimationFrame(flushMinerDom)
  }
  function flushMinerDom () {
    minerDomRaf = 0
    minerDomAt = Date.now()
    renderIsland()
    refreshDash()
    renderMinerLive()
  }

  // ---------------- dropdowns ----------------
  function closeDd () { SD.clear($('ddRoot')) }
  function openDd (anchor, html, alignRight) {
    const r = anchor.getBoundingClientRect()
    // 1.1.4 fix: the click-away backdrop has its own class (.ddov, z-index below .dd). In 1.1.1-1.1.3 it reused the modal
    // .overlay (z-index 50 > .dd 40), so it covered the menu and every click on a menu item only closed the menu.
    SD.html($('ddRoot'), `<div class="ddov" data-act="ddClose"></div><div class="dd" id="dd" style="top:${Number(r.bottom + 8)}px;${alignRight ? 'right:' + Number(Math.max(10, window.innerWidth - r.right)) + 'px' : 'left:' + Number(r.left) + 'px'};min-width:${Number(Math.max(r.width, 320))}px;max-width:760px">${html}</div>`)
  }
  // 3.0.2: both kinds, grouped like the Accounts tab: Classic (Shard1–Shard4) first, then Shard0 EVM.
  function accSwitchList () {
    const cur = headerAccount()
    const curChain = headerChain()
    let h = `<div class="lbl" style="padding:6px 14px">${esc(T('switchAccount'))}</div>`
    let any = false
    for (const chain of ['old', 'new']) {
    const vis = chain === 'old' ? shardFilter(visible('old')) : visible('new')
    h += `<div class="lbl" style="padding:8px 14px 2px;font-weight:700;color:#3d4160">${esc(T(chain === 'old' ? 'oldTitle' : 'newTitle'))}</div>`
    if (vis.length) any = true
    vis.forEach(a => {
      const addr = chain === 'old'
        ? `<div class="mono" style="font-size:15px">${esc(a.pubkey || '')}</div>`
        : `<div class="${a.evm ? 'mono' : 'lockline'}" style="font-size:15px">${a.evm ? esc(a.evm) : '🔒 ' + esc(T('locked'))}</div>`
      let bal = ''
      if (chain === 'old') {
        const v = fmtOld(a.pubkey)
        if (v != null) bal = esc(v) + ' SCDO'
      } else {
        const b = st.s0[a.filename]
        if (b && b.nativeWei != null) bal = esc(fmtWei(b.nativeWei, 3)) + ' SCDO'
      }
      h += `<div class="it ${cur && chain === curChain && a.filename === cur.filename ? 'on' : ''}" data-act="pickAcc" data-chain="${chain}" data-f="${esc(a.filename)}">${avatar(accLabel(a))}<div style="flex:1;min-width:0"><div style="font-weight:700;font-size:19px" class="wrap">${esc(accLabel(a))}</div>
        ${addr}</div>
        <div style="font-weight:700;white-space:nowrap">${bal}</div></div>`
    })
    }
    if (!any) h += `<div class="it muted">${esc(T('noAccount'))}</div>`
    h += `<div class="sep"></div><div class="it" data-act="create">＋ ${esc(T('createTitle'))}</div><div class="it" data-act="import">⤓ ${esc(T('importAccount'))}</div><div class="it" data-act="tab" data-v="${curChain === 'old' ? 'old' : 'new'}">⚙ ${esc(T('manageAccounts'))}</div>`
    return h
  }
  function accChipMenu (anchor) {
    const a = headerAccount()
    const chain = headerChain()
    let head = ''
    if (!a) head = `<div class="lbl" style="padding:8px 14px">${esc(T('noAccount'))}</div>`
    else if (chain === 'old') {
      const addr = a.pubkey || ''
      head = `<div style="padding:8px 14px 4px;font-weight:700" class="wrap">${esc(accLabel(a))}</div>
        <div class="mono" style="padding:0 14px 8px;font-size:15px;word-break:break-all">${addr ? esc(addr) : esc(T('noAccount'))}</div>
        ${addr ? `<div class="row" style="padding:0 14px 8px;gap:8px"><button type="button" class="btn sec small" data-act="copy" data-v="${esc(addr)}">⧉ ${esc(T('copy'))}</button><button type="button" class="btn sec small" data-act="receive" data-f="${esc(a.filename)}" data-chain="old">▦ ${esc(T('qr'))}</button></div>` : ''}`
    } else if (a.evm) {
      head = `<div style="padding:8px 14px 4px;font-weight:700" class="wrap">${esc(accLabel(a))}</div>
        <div class="mono" style="padding:0 14px 8px;font-size:15px;word-break:break-all">${esc(a.evm)}</div>
        <div class="row" style="padding:0 14px 8px;gap:8px"><button type="button" class="btn sec small" data-act="copy" data-v="${esc(a.evm)}">⧉ ${esc(T('copy'))}</button><button type="button" class="btn sec small" data-act="receive" data-f="${esc(a.filename)}" data-chain="new">▦ ${esc(T('qr'))}</button></div>`
    } else {
      head = `<div style="padding:8px 14px 4px;font-weight:700" class="wrap">${esc(accLabel(a))}</div>
        <div class="lockline" style="padding:0 14px 8px">🔒 ${esc(T('locked'))}</div>`
    }
    openDd(anchor, head + accSwitchList(), true)
  }

  // ---------------- modals ----------------
  function modal (html, opts) {
    opts = opts || {}
    SD.html($('modalRoot'), `<div class="overlay" id="ov"><div class="modal" id="md" style="${opts.width ? 'width:' + Number(opts.width) + 'px' : ''}">${html}</div></div>`)
    const first = $('md').querySelector('input:not([type=checkbox]):not([disabled])'); if (first && !opts.noFocus) setTimeout(() => first.focus(), 30)
  }
  function closeModal () {
    if (st.payReview && st.payReview.token) api.invoke('s0:cancelReview', st.payReview.token).catch(() => {})
    st.payReview = null
    SD.clear($('modalRoot')); render()
  }
  // 3.0.2: every transfer, remittance and signature stops here first. A second
  // window on top of the form says the amount, the recipient and which chain in
  // full words; nothing is signed or sent unless the user presses the confirm button.
  // Escape, the cancel button or a click outside it all count as "no".
  function confirmTx (o) {
    return new Promise(resolve => {
      let root = $('confirmRoot')
      if (!root) { root = document.createElement('div'); root.id = 'confirmRoot'; document.body.appendChild(root) }
      const rows = (o.rows || []).filter(r => r && r[1]).map(r => `<div class="cf-row"><div class="cf-k">${esc(r[0])}</div><div class="cf-v${r[2] ? ' mono' : ''}">${esc(r[1])}</div></div>`).join('')
      SD.html(root, `<div class="overlay cf-ov" id="cfOv"><div class="modal cf-md" id="txConfirm" role="dialog" aria-modal="true" aria-labelledby="cfTitle">
        <div class="mh"><h2 id="cfTitle">${esc(o.title)}</h2></div>
        <div class="cf-rows">${rows}</div>
        ${o.warn ? `<div class="warnbox cf-warn" id="cfWarn">⚠ ${esc(o.warn)}</div>` : ''}
        <p class="sub cf-note">${esc(T('cf_note'))}</p>
        <div class="foot"><button type="button" class="btn ghost" id="cfNo">${esc(T('cf_no'))}</button><button type="button" class="btn pri" id="cfYes">${esc(o.yes || T('cf_yes'))}</button></div>
      </div></div>`)
      let done = false
      const finish = (v) => { if (done) return; done = true; document.removeEventListener('keydown', onKey, true); SD.clear(root); resolve(v) }
      const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); finish(false) } }
      document.addEventListener('keydown', onKey, true)
      $('cfNo').onclick = () => finish(false)
      $('cfYes').onclick = () => finish(true)
      $('cfOv').onclick = (e) => { if (e.target && e.target.id === 'cfOv') finish(false) }
      setTimeout(() => { const b = $('cfNo'); if (b) b.focus() }, 30)
    })
  }
  function cfRows (route, payer, extra) {
    const chain = route.kind === 'gateway' ? T('cf_chainGateway') : (route.shard === 0 ? T('cf_chainS0') : T('cf_chainShard', { n: route.shard }))
    return [[T('cf_amount'), fmtNum(route.amount) + ' SCDO'], [T('cf_to'), route.to, true], [T('cf_chain'), chain], [T('cf_from'), signingAddress(payer, route) || payer.filename || '', true]].concat(extra || [])
  }

  function confirmStopAll () {
    return new Promise(resolve => {
      modal(`<div class="mh" id="stopAllDlg"><h2>${esc(T('stopAllTitle'))}</h2></div>
        <div class="foot"><button type="button" class="btn ghost" id="cbNo">${esc(T('cancel'))}</button><button type="button" class="btn danl" id="cbYes">${esc(T('stopAllYes'))}</button></div>`, { width: 560, noFocus: true })
      const no = $('cbNo')
      const yes = $('cbYes')
      const done = (v) => { SD.clear($('modalRoot')); resolve(v) }
      no.onclick = () => done(false)
      yes.onclick = () => done(true)
      no.focus()
    })
  }
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
  // ----- one 匯款 form: the wallet picks chain or gateway; the user presses 確認匯款 -----
  // Nothing here runs s0:send, old:send, or remit:login until that button.
  function signingAddress (payer, route) {
    if (!payer) return ''
    if (!route || route.kind === 'gateway' || route.kind === 'incomplete' || route.shard === 0) return payer.evm || ''
    return payer.pubkey || ''
  }
  function payerValid (payer, route) {
    if (!payer) return false
    if (!route || route.kind === 'incomplete') return true
    if (route.kind === 'gateway') return !!(payer.evm && /^0x[0-9a-fA-F]{40}$/.test(payer.evm))
    if (route.kind !== 'chain') return false
    if (route.shard === 0) return !!(payer.evm && /^0x[0-9a-fA-F]{40}$/.test(payer.evm))
    return String(payer.shard) === String(route.shard) && /^[1-4]S[0-9a-fA-F]{40}$/.test(payer.pubkey || '')
  }
  function payersForRoute (route) {
    const all = st.accounts || []
    if (!route || route.kind === 'incomplete') return all.slice()
    return all.filter(a => payerValid(a, route))
  }
  function allPayees () {
    const out = []
    const push = (name) => {
      const n = nhw(name)
      if (!n || /^0x[0-9a-fA-F]{40}$/.test(n) || /^[1-4]S[0-9a-fA-F]{40}$/.test(n)) return
      if (!out.some(p => p.name === n)) out.push({ name: n, kind: 'remit' })
    }
    for (const p of (Array.isArray(ui.payees) ? ui.payees : [])) push(p && p.name)
    const ledger = st.remit && st.remit.ledger
    const entries = !ledger || typeof ledger !== 'object' ? [] : (Array.isArray(ledger) ? ledger : (ledger.entries || ledger.items || ledger.transfers || ledger.records || []))
    for (const e of entries) { if (!e || typeof e !== 'object') continue; push(e.payee); push(e.beneficiary) }
    return out
  }
  function rememberPayee (name) {
    const n = nhw(name)
    if (!n || /^0x[0-9a-fA-F]{40}$/.test(n) || /^[1-4]S[0-9a-fA-F]{40}$/.test(n)) return
    if ((st.accounts || []).some(a => accLabel(a) === n)) return
    ui.payees = Array.isArray(ui.payees) ? ui.payees : []
    if (ui.payees.some(p => p && p.name === n)) return
    ui.payees.push({ name: n, kind: 'remit' })
    if (ui.payees.length > 100) ui.payees = ui.payees.slice(-100)
    saveUi()
  }
  function payModal (f, prefill) {
    const TC = (k, p) => T(k, p)
    const opened = accByFile(f) || headerAccount()
    if (!opened) {
      modal(`<div class="mh"><h2>${esc(TC('payTitle'))}</h2><button class="btn ghost small" data-act="closeModal">✕</button></div>
        <div class="muted" style="font-size:20px">${esc(TC('remitNeedAccount'))}</div>
        <div class="foot"><button class="btn pri" data-act="create">${esc(TC('createAccount'))}</button><button class="btn sec" data-act="import">${esc(TC('importAccount'))}</button></div>`, { width: 640 })
      return
    }
    const s = {
      to: prefill && prefill.to ? String(prefill.to) : '',
      amount: prefill && prefill.amount ? String(prefill.amount) : '',
      feeText: '',
      feeFor: null,
      gas: null,
      payerFile: opened.filename
    }
    if (st.payReview && st.payReview.token) api.invoke('s0:cancelReview', st.payReview.token).catch(() => {})
    st.payReview = null
    const accountsForRoute = () => (st.accounts || []).map(a => ({ label: accLabel(a), filename: a.filename, address: a.pubkey || '', evm: a.evm || '', shard: a.shard }))
    const currentRoute = () => window.SCDORemitRoute.routePay({
      to: s.to, amount: s.amount, accounts: accountsForRoute(), payees: allPayees(), feeText: s.feeText || '…', etaText: ''
    })
    let feeTimer = 0
    let feeGen = 0
    function chosenPayer (route) {
      const payer = accByFile(s.payerFile)
      return payer && payerValid(payer, route) ? payer : null
    }
    function paintPayer (route) {
      const box = $('payFrom')
      if (!box) return chosenPayer(route)
      const choices = payersForRoute(route)
      const key = (route.kind || '') + ':' + (route.shard == null ? '' : route.shard) + ':' + choices.map(a => a.filename).join('|')
      let sel = $('payPayer')
      if (!sel || sel.getAttribute('data-key') !== key) {
        const opts = ['<option value="">' + esc(TC('payPick')) + '</option>'].concat(choices.map(a => {
          const addr = signingAddress(a, route)
          return '<option value="' + esc(a.filename) + '">' + esc(accLabel(a) + (addr ? ' · ' + addr : '')) + '</option>'
        }))
        SD.html(box, '<select class="inp" id="payPayer" data-key="' + esc(key) + '">' + opts.join('') + '</select><div id="paySign" class="mono" style="font-size:15px;margin-top:6px"></div>')
        sel = $('payPayer')
        if (sel) sel.onchange = () => {
          s.payerFile = sel.value || ''
          s.feeText = ''
          s.feeFor = null
          s.gas = null
          if (st.payReview && st.payReview.file !== s.payerFile) dropReview()
          sync()
        }
      }
      const payer = chosenPayer(route)
      if (sel) sel.value = payer ? payer.filename : ''
      const sign = $('paySign')
      const addr = payer ? signingAddress(payer, route) : ''
      if (sign) {
        if (payer && addr) sign.textContent = TC('paySignAddr') + addr
        else if (payer && route.kind === 'chain' && route.shard === 0) sign.textContent = TC('payUnlock')
        else if (!payer) sign.textContent = choices.length ? TC('payPick') : TC('payNoPayer')
        else sign.textContent = ''
      }
      const self = $('paySelf')
      const hit = !!(addr && route.to && addr.toLowerCase() === String(route.to).toLowerCase() && (route.kind === 'chain'))
      if (self) {
        self.style.display = hit ? 'block' : 'none'
        self.textContent = hit ? TC('warnSelf') : ''
      }
      return payer
    }
    function paint (route) {
      route = route || currentRoute()
      const line = $('payRoute')
      if (line) {
        const text = route.many ? TC('payMany', { n: route.many.join(lang() === 'CN' ? '、' : ', ') }) : (route.line || TC('payRouteWait'))
        if (line.textContent !== text) line.textContent = text
        line.classList.add('explain')
        line.tabIndex = 0
        line.setAttribute('data-tip-name', TC('payRouteName'))
        line.setAttribute('data-tip-value', text)
        line.setAttribute('data-tip-explain', TC('payRouteExplain'))
        line.setAttribute('data-tip-detail', route.kind === 'chain' ? TC('payRouteDetailChain') : TC('payRouteDetailGate'))
      }
      const payer = paintPayer(route)
      const note = $('payNote')
      if (note) note.textContent = route.kind === 'gateway' ? TC('payGateNote') : route.kind === 'chain' ? TC('payChainNote') : ''
      return route && payer ? route : route
    }
    function dropReview () {
      if (st.payReview && st.payReview.token) api.invoke('s0:cancelReview', st.payReview.token).catch(() => {})
      st.payReview = null
      const extra = $('payExtra')
      if (extra && !extra.querySelector('#remitLedger')) extra.textContent = ''
    }
    function sync () {
      const to = $('payTo'); const amt = $('payAmt')
      s.to = nhw(to ? to.value : s.to)
      s.amount = nhw(amt ? amt.value : s.amount)
      let route = window.SCDORemitRoute.routePay({
        to: s.to, amount: s.amount, accounts: accountsForRoute(), payees: allPayees(), feeText: s.feeText, etaText: ''
      })
      if (route.kind === 'chain' && route.shard >= 1) {
        if (!s.feeText || s.feeFor !== route.shard) {
          s.feeText = '0.00021 SCDO'
          s.gas = 21000
          s.feeFor = route.shard
        }
      } else if (route.kind !== 'chain') {
        s.feeText = ''
        s.feeFor = null
      } else if (s.feeFor !== 0) {
        s.feeText = ''
        s.feeFor = 0
      }
      route = currentRoute()
      if (st.payReview && (st.payReview.to !== route.to || st.payReview.amount !== route.amount || st.payReview.file !== s.payerFile)) dropReview()
      paint(route)
      clearTimeout(feeTimer)
      if (route.kind !== 'chain') return
      const gen = ++feeGen
      const snap = route
      feeTimer = setTimeout(async () => {
        const payer = chosenPayer(snap)
        let text = snap.shard >= 1 ? '0.00021 SCDO' : ''
        let gas = snap.shard >= 1 ? 21000 : null
        try {
          if (snap.shard === 0 && payer && payer.evm) {
            const est = await api.invoke('s0:estimate', payer.evm, snap.to, snap.amount, 'SCDO')
            if (est && est.estFeeWei != null) text = fmtWei(BigInt(est.estFeeWei)) + ' SCDO'
          } else if (snap.shard >= 1) {
            if (payer && payer.pubkey) {
              const g = await api.invoke('old:estimateGas', payer.pubkey, snap.to)
              if (g) gas = Number(g)
            }
            text = AMT.fmtUnits(BigInt(gas || 21000), 8) + ' SCDO'
          }
        } catch (e) {
          if (snap.shard >= 1) text = '0.00021 SCDO'
        }
        if (gen !== feeGen || !$('payRoute')) return
        if (text) s.feeText = text
        if (gas) s.gas = gas
        paint()
      }, 350)
    }
    modal(`<div class="mh"><h2>${esc(TC('payTitle'))}</h2><button class="btn ghost small" data-act="closeModal">✕</button></div>
      <div class="lbl">${esc(TC('payFrom'))}</div><div id="payFrom" class="wrap" style="font-size:18px;font-weight:700"></div>
      <div class="warnbox" id="paySelf" style="display:none;margin-top:8px"></div>
      <div class="field"><div class="lbl">${esc(TC('payTo'))}</div>
        <input class="inp" id="payTo" placeholder="${esc(TC('payToPh'))}" value="${esc(s.to)}" autocomplete="off" spellcheck="false" autocapitalize="off">
        <div class="row" id="payeeChips" style="flex-wrap:wrap;margin-top:8px"></div></div>
      <div class="field"><div class="lbl">${esc(TC('payAmount'))}</div>
        <input class="inp" id="payAmt" inputmode="decimal" placeholder="${esc(TC('payAmountPh'))}" value="${esc(s.amount)}" autocomplete="off" spellcheck="false" lang="en"></div>
      <div class="infobox" id="payRoute"></div>
      <div class="lbl" id="payNote" style="margin-top:8px"></div>
      <div id="payExtra"></div>
      <div id="payStatus" style="margin-top:8px"></div>
      <div class="field"><div class="lbl">${esc(TC('payPw'))}</div><input class="inp" type="password" id="remitPw" autocomplete="off"></div>
      <div class="err" id="payErr"></div>
      <div class="foot"><button class="btn ghost" data-act="closeModal">${esc(TC('cancel'))}</button><button class="btn pri" type="button" id="btnRemitSign">${esc(TC('payGo'))}</button></div>`, { width: 680 })
    const chips = $('payeeChips')
    const names = allPayees().map(p => p.name).slice(0, 8)
    if (chips && names.length) {
      SD.html(chips, names.map(n => `<button type="button" class="btn ghost small" data-payee="${esc(n)}">${esc(n)}</button>`).join(''))
      chips.querySelectorAll('[data-payee]').forEach(b => {
        b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); const i = $('payTo'); if (i) i.value = b.getAttribute('data-payee') || ''; sync() }
      })
    }
    const toEl = $('payTo'); const amtEl = $('payAmt'); const pwEl = $('remitPw'); const go = $('btnRemitSign')
    if (toEl) { toEl.oninput = sync; toEl.onkeydown = (e) => { if (e.key === 'Enter') confirmPay() } }
    if (amtEl) { amtEl.oninput = sync; amtEl.onkeydown = (e) => { if (e.key === 'Enter') confirmPay() } }
    if (pwEl) pwEl.onkeydown = (e) => { if (e.key === 'Enter') confirmPay() }
    if (go) go.onclick = () => { confirmPay() }
    sync()
    function showDone (text) {
      const extra = $('payExtra')
      if (extra) SD.html(extra, `<div class="statusbar good" style="font-size:20px">${esc(text)}</div>`)
      const b = $('btnRemitSign'); if (b) b.disabled = true
    }
    async function confirmPay () {
      const btn = $('btnRemitSign'); const err = $('payErr')
      if (err) err.textContent = ''
      s.to = nhw($('payTo') ? $('payTo').value : s.to)
      s.amount = nhw($('payAmt') ? $('payAmt').value : s.amount)
      const route = paint()
      if (route.kind !== 'chain' && route.kind !== 'gateway') {
        if (err) err.textContent = route.many ? TC('payMany', { n: route.many.join(lang() === 'CN' ? '、' : ', ') }) : TC('payNeed')
        return
      }
      const payer = chosenPayer(route)
      if (!payer) { if (err) err.textContent = TC('payNoPayer'); return }
      const pw = $('remitPw') ? $('remitPw').value : ''
      if (route.kind === 'gateway') {
        rememberPayee(route.to)
        if (remitOwnsSession() && payer.evm && sameAddr(payer.evm, st.remit.address)) { payShowLedger(); return }
        if (!pw) { if (err) err.textContent = TC('errPw'); return }
        if (!(await confirmTx({ title: T('cf_titleSign'), yes: T('cf_yesSign'), rows: cfRows(route, payer) }))) { if (err) err.textContent = T('cf_canceled'); return }
        await remitLogin(payer.filename)
        if ($('remitPw')) $('remitPw').value = ''
        return
      }
      if (route.shard === 0) { await confirmShard0(route, payer, pw, err, btn); return }
      await confirmClassic(route, payer, pw, err, btn)
    }
    async function confirmShard0 (route, payer, pw, err, btn) {
      if (!payer.evm) { if (err) err.textContent = TC('payUnlock'); return }
      if (st.payReview && st.payReview.to === route.to && st.payReview.amount === route.amount && st.payReview.file === payer.filename) {
        const ack = $('payAck')
        if ((st.payReview.warns || []).length && !(ack && ack.checked)) { if (err) err.textContent = TC('ackWarnings'); return }
        if (!pw) { if (err) err.textContent = TC('errPw'); return }
        if (!(await confirmTx({ title: T('cf_title'), rows: cfRows(route, payer, feeRow(st.payReview.fee, route.amount)), warn: selfWarn(payer, route.to) }))) { if (err) err.textContent = T('cf_canceled'); return }
        if (!st.payReview) return
        const token = st.payReview.token
        st.payReview = null
        if ($('remitPw')) $('remitPw').value = ''
        if (btn) btn.disabled = true
        if (err) SD.spin(err, TC('sending'))
        let res
        try { res = await api.invoke('s0:send', { token: token, password: pw }) } catch (e) { res = { ok: false, error: e.message } }
        finishShard0(res, route, payer, err, btn)
        return
      }
      if (st.payReview && st.payReview.token) api.invoke('s0:cancelReview', st.payReview.token).catch(() => {})
      st.payReview = null
      if (btn) btn.disabled = true
      if (err) SD.spin(err, TC('checkingAddr'))
      let chk
      try { chk = await api.invoke('s0:checkAddress', payer.evm, route.to, 'SCDO') } catch (e) { chk = { ok: false, errors: ['FORMAT'] } }
      if (!$('btnRemitSign')) return
      if (!chk.ok) { if (btn) btn.disabled = false; if (err) err.textContent = TC(ADDR_ERR[chk.errors[0]] || 'errAddr'); return }
      if (chk.address) { s.to = chk.address; const inp = $('payTo'); if (inp) inp.value = chk.address; route.to = chk.address }
      if (err) SD.spin(err, TC('preparingReview'))
      let rev
      try { rev = await api.invoke('s0:review', { file: payer.filename, to: chk.address, amount: route.amount, asset: 'SCDO' }) } catch (e) { rev = { ok: false, error: e.message } }
      if (!$('btnRemitSign')) { if (rev && rev.token) api.invoke('s0:cancelReview', rev.token).catch(() => {}); return }
      if (rev.check && !rev.check.ok) { if (btn) btn.disabled = false; if (err) err.textContent = TC(ADDR_ERR[rev.check.errors[0]] || 'errAddr'); if (rev.token) api.invoke('s0:cancelReview', rev.token).catch(() => {}); return }
      if (!rev.ok) {
        if (btn) btn.disabled = false
        if (err) err.textContent = rev.errors && rev.errors.length ? TC(SEND_ERR[rev.errors[0]] || 'errAmount') : (SEND_ERR[rev.error] ? TC(SEND_ERR[rev.error]) : TC('errReview', { e: rev.error || '?' }))
        return
      }
      const warns = ((rev.check && rev.check.warnings) || []).filter(w => ADDR_WARN[w])
      if (warns.length) {
        st.payReview = { token: rev.token, to: chk.address, amount: route.amount, file: payer.filename, warns: warns, fee: rev.fee }
        const extra = $('payExtra')
        if (extra) SD.html(extra, warns.map(w => `<div class="warnbox">⚠ ${esc(TC(ADDR_WARN[w]))}</div>`).join('') + `<label class="chk" style="display:flex;gap:10px;align-items:center;font-size:19px;margin-top:10px"><input type="checkbox" id="payAck" style="width:22px;height:22px"> ${esc(TC('ackWarnings'))}</label>`)
        const ack = $('payAck')
        if (ack) ack.onchange = () => { const b = $('btnRemitSign'); if (b) b.disabled = !ack.checked }
        if (btn) btn.disabled = true
        if (err) err.textContent = ''
        return
      }
      if (!pw) { if (rev.token) api.invoke('s0:cancelReview', rev.token).catch(() => {}); if (btn) btn.disabled = false; if (err) err.textContent = TC('errPw'); return }
      if (err) err.textContent = ''
      if (!(await confirmTx({ title: T('cf_title'), rows: cfRows(route, payer, feeRow(rev.fee, route.amount)), warn: selfWarn(payer, route.to) }))) {
        if (rev.token) api.invoke('s0:cancelReview', rev.token).catch(() => {})
        if (btn) btn.disabled = false
        if (err) err.textContent = T('cf_canceled')
        return
      }
      if ($('remitPw')) $('remitPw').value = ''
      if (err) SD.spin(err, TC('sending'))
      let res
      try { res = await api.invoke('s0:send', { token: rev.token, password: pw }) } catch (e) { res = { ok: false, error: e.message } }
      finishShard0(res, route, payer, err, btn)
    }
    // 3.0.4: fee and 合計 (amount + fee), both in integer wei
    function feeRow (fee, amount) {
      if (!fee || !fee.maxFeeWei) return []
      try {
        const f = BigInt(fee.maxFeeWei); const w = AMT.toUnits(amount, 18)
        return [[T('cf_fee'), fmtWei(f) + ' SCDO']].concat(w != null ? [[T('cf_totalMax'), fmtWei(w + f) + ' SCDO']] : [])
      } catch (e) { return [] }
    }
    const selfWarn = (payer, to) => (payer && to && String(payer.evm || '').toLowerCase() === String(to).toLowerCase()) ? T('cf_warnSelf') : ''
    function finishShard0 (res, route, payer, err, btn) {
      if (res && res.ok) { showDone(TC('waiting') + ' ' + (res.hash || '')); loadActivity(payer.evm); refreshS0(); return }
      if (res && res.error === 'BROADCAST_TIMEOUT' && res.hash) { showDone(TC('errBcastTimeout') + ' ' + res.hash); loadActivity(payer.evm); return }
      if (err) err.textContent = TC('sendFailedPrefix') + ' ' + (SEND_ERR[res && res.error] ? TC(SEND_ERR[res.error]) : String((res && res.error) || 'error'))
      if (btn) btn.disabled = false
      loadActivity(payer.evm)
    }
    async function confirmClassic (route, payer, pw, err, btn) {
      if (!/^[1-4]S[0-9a-fA-F]{40}$/.test(route.to)) { if (err) err.textContent = TC('errAddrOld'); return }
      if (String(route.to[0]) !== String(payer.shard) && !CFG.allowCrossShard) { if (err) err.textContent = TC('errCross', { n: payer.shard }); return }
      const units = /^\d+(\.\d{1,8})?$/.test(route.amount) ? AMT.toUnits(route.amount, 8) : null
      if (units == null || units <= 0n) { if (err) err.textContent = TC('errAmount'); return }
      // 3.0.4: sending to this account's own address is allowed after the user ticks the box (same as Shard0 EVM)
      const self = String(payer.pubkey || '').toLowerCase() === String(route.to || '').toLowerCase()
      if (self) {
        const box = $('paySelf')
        if (box) { box.style.display = 'block'; box.textContent = TC('warnSelf') }
        let ack = $('paySelfAck')
        if (!ack) {
          const extra = $('payExtra')
          if (extra) SD.html(extra, `<label class="chk" style="display:flex;gap:10px;align-items:center;font-size:19px;margin-top:10px"><input type="checkbox" id="paySelfAck" style="width:22px;height:22px"> ${esc(TC('ackSelf'))}</label>`)
          ack = $('paySelfAck')
          if (ack) ack.onchange = () => { const b = $('btnRemitSign'); if (b) b.disabled = !ack.checked }
          if (btn) btn.disabled = true
          if (err) err.textContent = ''
          return
        }
        if (!ack.checked) { if (err) err.textContent = TC('ackSelf'); return }
      }
      let gas = s.gas
      try { const g = await api.invoke('old:estimateGas', payer.pubkey, route.to); if (g) gas = Number(g) } catch (e) {}
      const feeU = BigInt(gas || 21000) // gas price 1 unit; 8 decimals
      const bal = oldRaw(payer.pubkey)
      if (bal != null && units + feeU > bal) { if (err) err.textContent = TC('errTooMuch'); return }
      if (!pw) { if (err) err.textContent = TC('errPw'); return }
      if (!(await confirmTx({ title: T('cf_title'), warn: self ? T('cf_warnSelf') : '', rows: cfRows(route, payer, [[T('cf_fee'), AMT.fmtUnits(feeU, 8) + ' SCDO'], [T('cf_total'), AMT.fmtUnits(units + feeU, 8) + ' SCDO']]) }))) { if (err) err.textContent = T('cf_canceled'); return }
      if ($('remitPw')) $('remitPw').value = ''
      if (btn) btn.disabled = true
      if (err) SD.spin(err, TC('sending'))
      let res
      try { res = await api.invoke('old:send', { file: payer.filename, password: pw, to: route.to, amount: route.amount, price: 1, gas: gas || 21000, selfOk: self }) } catch (e) { res = { ok: false, error: e.message } }
      if (!$('payRoute')) return
      if (!res || !res.ok) {
        const em = String((res && res.error) || 'error')
        if (err) err.textContent = em === 'WRONG_PASSWORD' ? TC('wrongPw') : em
        if (btn) btn.disabled = false
        return
      }
      showDone(TC('sentOld') + ' ' + (res.hash || ''))
      refreshOld(); loadOldActivity(true)
    }
  }
  function payShowLedger () {
    const box = $('payExtra')
    if (!box) return false
    SD.html(box, `<div class="ok" id="remitStatus" style="font-size:20px;font-weight:700">${esc(T('remitIn'))}</div>
      <div class="mono" id="remitAddr">${esc(st.remit.address || '')}</div>
      <div id="remitLedger">${remitLedgerHtml(st.remit.ledger)}</div>`)
    const stEl = $('payStatus'); if (stEl) stEl.textContent = ''
    return true
  }

  // ----- create / import -----
  // opts.priv: 匯入錢包 → 用私鑰匯入. The key is typed only into this masked field (type=password), never into the
  // AI小貓 chat; it is cleared before the IPC call and never logged.
  function createModal (opts) {
    opts = opts || {}
    const privField = `<div class="field"><div class="lbl">${esc(opts.priv ? T('d_keyLabel') : T('createPriv'))}</div><input class="inp mono" id="cPriv" type="password" placeholder="0x…" autocomplete="off" spellcheck="false" inputmode="latin" autocapitalize="off" lang="en"></div>`
    modal(`<div class="mh"><h2>${esc(opts.priv ? T('d_keyTitle') : T('createTitle'))}</h2></div>${opts.priv ? privField : ''}
      <div class="field"><div class="lbl">${esc(T('accName'))}</div><input class="inp" id="cName" maxlength="40" placeholder="${esc(T('accountN', { n: nextNo() }))}"></div>
      <div class="field"><div class="lbl">${esc(T('pw1'))}</div><input class="inp" type="password" id="cPw1"></div>
      <div class="field"><div class="lbl">${esc(T('pw2'))}</div><input class="inp" type="password" id="cPw2"><div class="lbl" style="margin-top:6px">${esc(T('pwRule'))}</div></div>
      <details style="margin-top:14px"><summary style="font-size:18px;cursor:pointer;color:#3d4160">${esc(T('advanced'))}</summary>
        <div class="field"><div class="lbl">${esc(T('createShard'))}</div><input class="inp" id="cShard" value="1" style="width:120px"></div>
        ${opts.priv ? '' : privField}</details>
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
    if (r && r.ok) { toast('✔'); await reloadAccounts(); render(); refreshS0(); if ($('md') && $('md').querySelector('[data-act=hideAll],[data-act=unhideAll]')) manageModal() } else toast(T('wrongPw'))
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
    const s0b = st.s0[a.filename]; const oldb = oldRaw(a.pubkey)
    const nonZero = (s0b && s0b.nativeWei != null && s0b.nativeWei > 0n) || (s0b && (s0b.tokens || []).some(t => t.raw != null && t.raw > 0n)) || (oldb != null && oldb > 0n)
    const balLine = `${esc(T('s0Short'))}${PU.c()}${s0b && s0b.nativeWei != null ? esc(fmtWei(s0b.nativeWei)) + ' SCDO' : '?'}${PU.bar()}${esc(T('classicShort'))}${PU.c()}${oldb != null ? esc(AMT.fmtUnits(oldb, 8)) + ' SCDO' : '?'}`
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
      const has = (fresh0 && (fresh0.nativeWei > 0n || fresh0.tokens.some(t => t.raw != null && t.raw > 0n))) || (freshOld != null && BigInt(freshOld) > 0n)
      const tokLine = fresh0 ? fresh0.tokens.filter(t => t.raw != null && t.raw > 0n).map(t => fmtNum(t.balance) + ' ' + t.symbol).join(PU.com()) : ''
      modal(`<div class="mh"><h2 style="color:#c62828">${esc(T('delConfirmTitle'))}</h2></div>
        <div style="font-size:21px" class="wrap">${esc(T('delConfirmText', { n: accLabel(a2) }))}</div>
        <div class="infobox" style="font-size:19px">${esc(T('s0Short'))}${PU.c()}${fresh0 ? esc(fmtWei(fresh0.nativeWei)) + ' SCDO' + (tokLine ? PU.com() + esc(tokLine) : '') : '? (' + esc(T('balUnknown')) + ')'}<br>${esc(T('classicShort'))}${PU.c()}${freshOld != null ? esc(AMT.fmtUnits(freshOld, 8)) + ' SCDO' : '? (' + esc(T('balUnknown')) + ')'}</div>
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
    LANG = r.lang === 'EN' ? 'EN' : 'CN'
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
      <div class="setsec"><div class="sh">AI小貓</div><div class="lbl">${esc(T('catHint'))}</div>
        <div style="margin-top:8px"><button class="toggle" data-act="catEnabled" id="catEnabled"><span class="sw ${catOn() ? 'on' : ''}"></span>${esc(T('catToggle'))}</button></div></div>
      <div class="setsec"><div class="sh">${esc(T('backupExport'))}</div><div class="lbl">${esc(T('backupHint'))}</div>
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
      <div class="setsec" id="setAbout"><div class="sh">${esc(T('about'))}</div><div style="font-size:18px">SCDO Wallet ${esc(APPVER)} · 2026-10-09</div><div class="lbl" id="aboutCommit">${esc(T('aboutCommit'))}${PU.c()}<span class="mono">${esc(APPCOMMIT || '?')}</span></div>${contactHtml('aboutContact')}<div id="aboutHash" class="abouthash"><div class="lbl">${esc(T('aboutHashLoading'))}</div></div><div class="relnotes">${relNotesHtml()}</div></div>`, { width: 820, noFocus: true })
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


  // 匯入錢包: keyfile(s) through the system file dialog, or a private key in the masked create dialog
  function importChoiceModal () {
    modal(`<div class="mh"><h2>${esc(T('d_importTitle'))}</h2><button class="btn ghost small" data-act="closeModal" aria-label="${esc(T('catClose'))}">✕</button></div>
      <div class="lbl" style="font-size:18px">${esc(T('d_importLead'))}</div>
      <div class="foot" style="justify-content:flex-start;flex-wrap:wrap"><button class="btn pri" data-act="import" id="impFile">${esc(T('d_importFile'))}</button><button class="btn sec" data-act="importKey" id="impKey">${esc(T('d_importKey'))}</button></div>`, { width: 720, noFocus: true })
  }
  // 管理帳戶（改名稱、隱藏、刪除）: the per-account actions that used to sit on the panels
  function manageModal () {
    const nHid = new Set(ui.hidden.new.concat(ui.hidden.old)).size
    const rows = st.accounts.map((a, i) => {
      const hidOld = isHidden('old', a.filename); const hidNew = isHidden('new', a.filename)
      const hid = hidOld || hidNew
      const chain = hidNew ? 'new' : 'old'
      const unlockRow = a.evm ? '' : `<div class="row" style="margin-top:6px;flex-wrap:wrap"><span class="lockline">🔒 ${esc(T('locked'))}</span><input class="inp" type="password" id="pw-m-${i}" placeholder="${esc(T('password'))}" style="width:230px;height:42px"><button class="btn sec small" data-act="unlock" data-f="${esc(a.filename)}" data-in="pw-m-${i}">${esc(T('showAddress'))}</button></div>`
      return `<div class="acc" style="margin:8px 0;align-items:flex-start">${avatar(accLabel(a))}<div style="flex:1;min-width:0"><div class="wrap" style="font-weight:700">${esc(accLabel(a))} ${hid ? `<span class="tag grey">${esc(T('hiddenTag'))}</span>` : ''}</div>
        <div class="mono" style="font-size:15px">${esc(a.pubkey)}</div>${a.evm ? `<div class="mono" style="font-size:15px">${esc(a.evm)}</div>` : ''}${unlockRow}
        <div class="row" style="margin-top:6px;flex-wrap:wrap;gap:8px"><button class="btn ghost small" data-act="rename" data-f="${esc(a.filename)}">${esc(T('rename'))}</button>
        <button class="btn ghost small" data-act="${hid ? 'unhideAll' : 'hideAll'}" data-chain="${chain}" data-f="${esc(a.filename)}">${esc(hid ? T('unhide') : T('hide'))}</button>
        <button class="btn danl small" data-act="delete" data-f="${esc(a.filename)}">${esc(T('del'))}</button></div></div></div>`
    }).join('') || esc(T('noAccount'))
    modal(`<div class="mh"><h2>${esc(T('d_manageTitle'))}</h2><button class="btn ghost small" data-act="closeModal" aria-label="${esc(T('catClose'))}">✕</button></div>
      <div class="row" style="margin:0 0 10px"><button class="btn ghost" data-act="toggleHidden" id="manageHidden">${esc(ui.showHidden ? T('hideHidden') : T('showHidden', { n: nHid }))}</button></div>${rows}
      <div class="foot"><button class="btn pri" data-act="closeModal">${esc(T('done'))}</button></div>`, { width: 860, noFocus: true })
  }

  // ----- miner -----
  async function ensureGpu (force) {
    if (st.gpu && !force) return st.gpu
    try { st.gpu = await api.invoke('miner:gpu') } catch (e) { st.gpu = { nvidia: false, names: [] } }
    if (st.tab === 'mineSet') render(); else refreshDash()
    return st.gpu
  }
  async function ensureCaps () {
    try { st.caps = await api.invoke('miner:caps') } catch (e) { st.caps = st.caps || { cpu: {}, gpu: {} } }
    if (st.tab === 'mineSet') render()
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
      const stText = r.code && r.code !== 'ERROR' && T(key) !== key ? T(key) : ''
      toast(window.SCDOStartError.classicStartText(lang(), r.code, r.error, stText), 8000)
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
    if (!r.ok) {
      if (r.code === 'NO_NVIDIA') await ensureGpu(true)
      const text = r.code === 'NO_NVIDIA' ? T('st_NO_NVIDIA') : window.SCDOStartError.full(lang(), r.code, r.error)
      toast(text, 7000)
      return
    }
    localStorage.setItem('minerRunShard0', '1')
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
    if (!r.ok) { toast(window.SCDOStartError.full(lang(), r.code, r.error), 7000); return }
  }
  function rememberMineChoice () {
    const gpu = st.miners && st.miners.classicGpu
    const cpu = st.miners && st.miners.classicCpu
    const s0 = st.miners && st.miners.shard0
    if (gpu && gpu.running && gpu.mode !== 'cpu' && gpu.mode !== 'node') {
      localStorage.setItem('minerRunClassicGpu', gpu.backend === 'external' ? 'external' : 'gpu')
      if (gpu.wallet) localStorage.setItem('minerClassicGpu', gpu.wallet)
    }
    if (cpu && cpu.running && cpu.mode !== 'node') {
      localStorage.setItem('minerRunClassicCpu', '1')
      if (cpu.wallet) localStorage.setItem('minerClassicCpu', cpu.wallet)
    }
    if (s0 && s0.running && s0.mode !== 'node' && s0.chain !== 'classic') {
      localStorage.setItem('minerRunShard0', '1')
      if (s0.wallet && /^0x[0-9a-fA-F]{40}$/.test(s0.wallet)) localStorage.setItem('minerReward', s0.wallet)
    }
  }
  // Stop only stops processes. The saved graphics-card / processor choice stays,
  // so the next Start mining restores that session instead of falling back to the processor.
  async function stopAllNow () {
    rememberMineChoice()
    try { await api.invoke('miner:stop', 'mine') } catch (e) {}
    try { await api.invoke('miner:stop', { chain: 'classic', backend: 'cpu' }) } catch (e) {}
    try { await api.invoke('miner:stop', { chain: 'classic', backend: 'gpu' }) } catch (e) {}
    toast(T('stopped'))
  }
  async function stopAll () {
    const ok = await confirmStopAll()
    if (!ok) return false
    await stopAllNow()
    return true
  }
  function savedMineChoice () {
    const gpu = localStorage.getItem('minerRunClassicGpu') || ''
    const cpuOn = localStorage.getItem('minerRunClassicCpu') === '1'
    let classic = ''
    if (gpu === 'external' || gpu === 'gpu') classic = gpu
    else if (cpuOn) classic = 'cpu'
    return { classic: classic, cpu: cpuOn && classic !== 'cpu', shard0: localStorage.getItem('minerRunShard0') === '1' }
  }
  function classicTargetForHome (backendName) {
    const pickedBackend = backendName === 'gpu' || backendName === 'external' || backendName === 'cpu'
      ? backendName
      : (st.mineBackend === 'gpu' || st.mineBackend === 'external' ? st.mineBackend : 'cpu')
    const key = pickedBackend === 'cpu' ? 'minerClassicCpu' : 'minerClassicGpu'
    const pref = Number(st.mineShard)
    const accounts = []
    for (const a of st.accounts || []) {
      const p = parseClassicAddress(a.pubkey)
      if (p && p.shard >= 1 && p.shard <= 4) accounts.push(p)
    }
    const savedKey = parseClassicAddress(localStorage.getItem(key) || '')
    const savedAny = parseClassicAddress(localStorage.getItem('minerClassic') || '')
    const ok = (p) => !!(p && p.shard >= 1 && p.shard <= 4)
    let picked = null
    if (pref >= 1 && pref <= 4) {
      if (ok(savedKey) && savedKey.shard === pref) picked = savedKey
      else if (ok(savedAny) && savedAny.shard === pref) picked = savedAny
      else picked = accounts.find(p => p.shard === pref) || null
    }
    if (!picked && ok(savedKey)) picked = savedKey
    if (!picked && ok(savedAny)) picked = savedAny
    if (!picked && accounts.length) {
      const sel = headerAccount()
      const selP = sel ? parseClassicAddress(sel.pubkey) : null
      picked = (selP && accounts.find(p => p.address === selP.address)) || accounts[0]
    }
    return picked ? { address: picked.address, shard: picked.shard } : null
  }
  function rewardForHome () {
    const saved = localStorage.getItem('minerReward') || ''
    if (/^0x[0-9a-fA-F]{40}$/.test(saved)) return saved
    let addr = ''
    try { addr = (catCtx().shard0Address) || '' } catch (e) { addr = '' }
    return /^0x[0-9a-fA-F]{40}$/.test(addr) ? addr : ''
  }
  async function startOneHomeJob (job) {
    if (job.chain === 'classic' && job.gpuMiner === 'external') {
      const gpu = gpuParams()
      let r
      try {
        r = await api.invoke('miner:start', job.address, {
          chain: 'classic', backend: 'gpu', gpuMiner: 'external', shard: job.shard,
          threads: gpu.threads, threadblocks: gpu.threadblocks, blockthreads: gpu.blockthreads
        })
      } catch (e) { r = { ok: false, code: 'BAD_ADDRESS' } }
      if (!r || !r.ok) {
        const key = 'st_' + ((r && r.code) || '')
        const stText = r && r.code && r.code !== 'ERROR' && T(key) !== key ? T(key) : ''
        toast(window.SCDOStartError.classicStartText(lang(), r && r.code, r && r.error, stText), 8000)
        return false
      }
      localStorage.setItem('minerRunClassicGpu', 'external')
      localStorage.setItem('minerClassicGpu', job.address)
      return true
    }
    const r = await startCatJob(job)
    if (r && r.ok) return true
    if (r && r.fail) toast(r.fail, 7000)
    return false
  }
  async function startHomeMining () {
    try { await ensureCaps() } catch (e) {}
    try { await ensureGpu(true) } catch (e) {}
    const saved = savedMineChoice()
    let preflight = null
    if (saved.shard0) {
      try { preflight = await api.invoke('mining:gpuPreflight') } catch (e) { preflight = { ok: false, gpus: [] } }
      try { st.otherRigels = await api.invoke('miner:otherRigels') || [] } catch (e) { st.otherRigels = st.otherRigels || [] }
    }
    const gpuBusy = !!(st.otherRigels && st.otherRigels.length)
    const hot = catTemp() != null && catTemp() >= 85
    const classicMode = saved.classic || (st.mineBackend === 'gpu' || st.mineBackend === 'external' ? st.mineBackend : 'cpu')
    const spec = {
      saved: saved,
      backend: classicMode,
      caps: st.caps,
      classic: classicTargetForHome(classicMode),
      classicCpu: saved.cpu ? classicTargetForHome('cpu') : null,
      reward: rewardForHome(),
      nvidia: !!(st.gpu && st.gpu.nvidia),
      preflight: preflight,
      gpuBusy: gpuBusy && saved.shard0
    }
    const cool = window.SCDOMineHome.jobsForHome(spec)
    const jobs = hot ? window.SCDOMineHome.jobsForHome(Object.assign({ hot: true }, spec)) : cool
    const droppedGpu = cool.some(j => j.chain === 'shard0' || j.backend === 'gpu') && !jobs.some(j => j.chain === 'shard0' || j.backend === 'gpu')
    if (!jobs.length) {
      toast(droppedGpu ? T('homeMineHot') : (saved.shard0 && gpuBusy ? T('homeMineGpuBusy') : T('pickAddr')), 7000)
      return false
    }
    if (droppedGpu) toast(T('homeMineHot'), 7000)
    else if (saved.shard0 && gpuBusy) toast(T('homeMineGpuBusy'), 7000)
    if (jobs.some(j => j.chain === 'shard0') && api.platform === 'win32' && !localStorage.getItem('defenderAsked112')) {
      localStorage.setItem('defenderAsked112', '1')
      if (await confirmBox(T('defender'), T('defAsk'), T('yes'), T('no'))) {
        const r = await api.invoke('miner:defender')
        toast(r && r.ok ? T('defenderOk') : T('defenderFail') + ' ' + ((r && r.error) || ''), 6000)
      }
    }
    let any = false
    for (const job of jobs) { if (await startOneHomeJob(job)) any = true }
    return any
  }
  async function homeMineToggle () {
    if (st.homeMine === 'starting' || st.homeMine === 'stopping' || st.actStarting) return
    const phase = miningBusy() ? 'mining' : 'stopped'
    const next = window.SCDOMineHome.reduceMinePhase(phase, 'click')
    if (next === phase) return
    st.homeMine = next
    refreshDash()
    try {
      if (next === 'stopping') {
        await stopAll()
        st.homeMine = ''
      } else {
        st.actStarting = true
        const ok = await startHomeMining()
        st.actStarting = false
        st.homeMine = ok ? 'mining' : ''
      }
    } catch (e) {
      st.actStarting = false
      st.homeMine = ''
    }
    refreshDash()
  }
  async function minerStop (src) {
    const classic = Number(st.mineShard) >= 1
    if (classic) {
      const backend = st.mineBackend === 'cpu' ? 'cpu' : 'gpu'
      toast(T('stopping'), 60000)
      await api.invoke('miner:stop', { chain: 'classic', backend })
      toast(T('stopped'))
      return
    }
    const ext = st.miners && st.miners.shard0 && st.miners.shard0.phase === 'external'
    if (!ext) toast(T('stopping'), 60000)
    await api.invoke('miner:stop', src === 'node' ? 'node' : 'mine')
    if (!ext) toast(T('stopped'))
  }
  function onMinerStatus (m) {
    const prev0 = st.miners && st.miners.shard0
    storeMiner(m)
    st.miner = viewMiner()
    noteEarn()
    noteCatHeights()
    catWatch()
    const cur0 = st.miners.shard0
    if (cur0 && cur0.code === 'DEFENDER' && (!prev0 || prev0.code !== 'DEFENDER') && api.platform === 'win32') {
      confirmBox(T('defender'), T('st_DEFENDER'), T('yes'), T('no')).then(async ok => { if (ok) { const r = await api.invoke('miner:defender'); toast(r && r.ok ? T('defenderOk') : T('defenderFail'), 6000); if (r && r.ok) mineStart() } })
    }
    if (st.homeMine === 'mining' && miningBusy()) st.homeMine = ''
    scheduleMinerDom()
  }

  // ---------------- events (one delegated handler) ----------------
  document.addEventListener('click', async (ev) => {
    const explained = ev.target.closest && ev.target.closest('.explain')
    const inChip = ev.target.closest && ev.target.closest('.isle-chip')
    const inHelp = ev.target.closest && ev.target.closest('#isleHelp')
    const inLegend = ev.target.closest && ev.target.closest('#isleLegend')
    const inPop = ev.target.closest && (inChip || explained || ev.target.closest('#islePop') || inHelp || inLegend)
    if (explained && !inChip) openIslePop(explained, true)
    if (!inPop) closeIslePop(true)
    if (isleLegendOn && !inLegend && !inHelp) dismissIsleLegend()
    const el = ev.target.closest('[data-act]'); if (!el) return
    const act = el.getAttribute('data-act'); const f = el.getAttribute('data-f'); const v = el.getAttribute('data-v')
    if (act === 'ddClose') { closeDd(); return }
    if (act !== 'accMenu' && act !== 'accChip') closeDd()
    switch (act) {
      case 'tab': if ($('md')) SD.clear($('modalRoot')); setTab(v); render(); if (v === 'mine' || v === 'mineSet') { ensureGpu(); ensureCaps() }; if (v === 'old' || v === 'acc' || v === 'home') refreshOld(); if (v === 'new' || v === 'acc' || v === 'home') refreshS0(); break
      case 'goHome': if ($('md')) SD.clear($('modalRoot')); setTab('home'); render(); refreshOld(); refreshS0(); break
      case 'isleHelp': closeIslePop(true); isleLegendOn = true; renderIsland(); break
      case 'isleHelpClose': isleLegendOn = false; renderIsland(); break
      case 'isleStart': {
        if (miningBusy() || st.actStarting) break
        st.actStarting = true
        renderActBar()
        askCat('開始挖礦').then(() => { st.actStarting = false; renderActBar() }, () => { st.actStarting = false; renderActBar() })
        break
      }
      case 'catOpen': if (!st.catOpen && $('aiCatAnim') && !CAT_ANIM.reduce) catAnimNext(); st.catOpen = !st.catOpen; renderCat(); if (st.catOpen) { const i = $('aiCatIn'); if (i) setTimeout(() => i.focus(), 30) } break
      case 'catSize': catSetPlace(null, v); break
      case 'catCorner': catSetPlace(v, null); break
      case 'catClose': case 'catLater': st.catOpen = false; renderCat(); break
      case 'catHide': localStorage.setItem('aiCat112', '0'); st.catOpen = false; renderCat(); toast(T('catHidden'), 7000); break
      case 'catType': { const row = $('aiCatInRow'); const b = $('catType'); if (row) row.hidden = false; if (b) b.hidden = true; const inp = $('aiCatIn'); if (inp) inp.focus(); break }
      case 'catRow': { if (v === 'mine' && (miningBusy() || st.actStarting)) { st.catLog.push('你：' + catPhrase(v)); await applyCatPlan(window.SCDOCat.reply('停止挖礦', catCtx())); break } if (v === 'mine') st.actStarting = true; try { await askCat(catPhrase(v)) } finally { if (v === 'mine') st.actStarting = false } break }
      case 'catAsk': { const inp = $('aiCatIn'); askCat(inp ? inp.value : ''); if (inp) inp.value = ''; break }
      case 'catChip': askCat(v); break
      case 'catEnabled': localStorage.setItem('aiCat112', catOn() ? '0' : '1'); renderCat(); settingsModal(); break
      case 'stopAll': stopAll(); break
      case 'mineShard': st.mineShard = [0, 1, 2, 3, 4].includes(Number(v)) ? Number(v) : 0; localStorage.setItem('mineShard112', String(st.mineShard)); render(); break
      case 'mineBackend': st.mineBackend = v === 'gpu' || v === 'external' ? v : 'cpu'; localStorage.setItem('mineBackend112', st.mineBackend); render(); break
      case 'homeSub': st.homeSub = v; localStorage.setItem('homeSub112', v); render(); break
      case 'accMenu':
      case 'accChip': if ($('dd')) closeDd(); else accChipMenu(el); break
      case 'pickAcc': { const ch = el.getAttribute('data-chain'); if (ch === 'old' || ch === 'new') { ui.net = ch; saveUi() } st.sel = f; localStorage.setItem('selAcc112', f); render(); break }
      case 'pickShard': ui.shard = [0, 1, 2, 3, 4].includes(Number(v)) ? Number(v) : 0; saveUi(); render(); break
      case 'settings': settingsModal(); break
      case 'setLang': setLangUi(v); break
      case 'hdrLang': setLangUi(v, true); break
      case 'copy': copyText(v); break
      case 'receive': receiveModal(f, el.getAttribute('data-chain') || 'new'); break
      case 'openPay': openRemitFor(f || (headerAccount() || {}).filename || st.sel); break
      case 'create': createModal(); break
      case 'import': if ($('md')) SD.clear($('modalRoot')); importKeyfiles(); break
      case 'unlock': unlock(f, el.getAttribute('data-in')); break
      case 'hide': setHidden(el.getAttribute('data-chain') || 'new', f, true); break
      case 'hideAll': case 'unhideAll': { const on = act === 'hideAll'; for (const ch of ['old', 'new']) { const l = ui.hidden[ch]; if (on && !l.includes(f)) l.push(f); if (!on) ui.hidden[ch] = l.filter(x => x !== f) } saveUi(); toast(on ? T('hideOk') : T('unhideOk')); render(); manageModal(); break }
      case 'importKey': createModal({ priv: true }); break
      case 'unhide': setHidden(el.getAttribute('data-chain') || 'new', f, false); break
      case 'toggleHidden': ui.showHidden = !ui.showHidden; saveUi(); if ($('md')) { SD.clear($('modalRoot')); render(); manageModal() } else render(); break
      case 'delete': deleteModal(f); break
      case 'rename': renameModal(f); break
      case 'cardMine': openMineFor(f, el.getAttribute('data-chain') || 'new'); break
      case 'cardRemit': openRemitFor(f); break
      case 'useOtherAddr': useOtherAddr(v); break
      case 'closeModal': closeModal(); break
      case 'openTx': if (/^0x[0-9a-fA-F]{64}$/.test(String(v || ''))) openExternal(shard0().explorerTx(v)); break
      case 'explorerAddr': openExternal(shard0().explorerAddress(v)); break
      case 'openLink': if (CONTACT_URLS.includes(String(v || ''))) openExternal(v); break
      case 'backupPick': backupPickModal(); break
      case 'backupOne': { const r = await api.invoke('keyfile:backupOnly', f); toast(r.ok ? T('backupOk', { p: r.backup }) : T('backupFail', { e: r.error }), 8000); break }
      case 'openBackups': api.invoke('keyfile:openBackups'); break
      case 'mineStart': mineStart(); break
      case 'homeMine': homeMineToggle(); break
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
      const lab = $('mThreadsLab')
      const cores = T('cpuCoresLine', { n: t.value, max: t.max })
      if (lab) { lab.textContent = cores; lab.setAttribute('data-tip-value', cores) }
      localStorage.setItem('mineThreads112', String(t.value))
      return
    }
    const half = t.id === 'mClassic-in' || t.id === 'mReward-in' || t.id === 'nPayout-in' || t.id === 'sTo' || t.id === 'sAmt' || t.id === 'payTo' || t.id === 'payAmt' || t.id === 'mGpuThreads' || t.id === 'mThreadBlocks' || t.id === 'mBlockThreads' || t.id === 'cPriv'
    if (!half) return
    const next = (t.id === 'sTo' || t.id === 'sAmt' || t.id === 'payTo' || t.id === 'payAmt' || t.id === 'cPriv') ? nhw(t.value) : miningInput(t.value)
    if (next !== t.value) {
      const pos = t.selectionStart
      t.value = next
      try { t.setSelectionRange(pos, pos) } catch (e) {}
    }
  })
  document.addEventListener('toggle', (ev) => { if (ev.target && ev.target.id === 'advBox') st.advOpen = ev.target.open }, true)
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      if ($('stopAllDlg')) { const n = $('cbNo'); if (n) n.click(); return }
      const popOpen = islePopPinned || ($('islePop') && !$('islePop').hidden)
      const legendOpen = isleLegendOn
      if (popOpen) closeIslePop(true)
      if (legendOpen) dismissIsleLegend()
      if (popOpen || legendOpen) return
      if (window.__closeAssetList && window.__closeAssetList()) return
      if ($('dd')) closeDd(); else if ($('md')) closeModal(); else if (st.catOpen) { st.catOpen = false; renderCat() }
    }
    if (ev.key === 'Enter' && ev.target && ev.target.id === 'aiCatIn') { ev.preventDefault(); askCat(ev.target.value); ev.target.value = '' }
  })

  // application menu (main process) -> page, over the allowlisted 'menu:action' event
  function openRemittance () { openRemitFor((headerAccount() || {}).filename || st.sel) }
  // 3.0.2: every action is reachable by hand from the window menu (the fallback if AI小貓 misbehaves).
  function goPage (v) {
    if ($('md')) SD.clear($('modalRoot'))
    setTab(v); render()
    if (v === 'mine' || v === 'mineSet') { ensureGpu(); ensureCaps() } else { refreshOld(); refreshS0() }
  }
  function goMineHome () {
    if ($('md')) SD.clear($('modalRoot'))
    setTab('home')
    st.scrollTo = 'homeMineCard'
    render()
    refreshOld()
    refreshS0()
  }
  async function menuStartMining () {
    if (miningBusy() || st.actStarting) { toast(currentMinePill().t, 5000); return }
    st.actStarting = true
    try { await askCat('開始挖礦', { quiet: true, toast: true }) } finally { st.actStarting = false }
  }
  function menuAction (a) {
    switch (a) {
      case 'create': createModal(); break
      case 'import': importChoiceModal(); break
      case 'backup': backupPickModal(); break
      case 'manage': manageModal(); break
      case 'mineStart': menuStartMining(); break
      case 'mineStop': stopAll(); break
      case 'reward': case 'mineSettings': goPage('mineSet'); break
      case 'openBackups': api.invoke('keyfile:openBackups'); break
      case 'home': case 'acc': case 'mine': goPage(a); break
      case 'mineHome': goMineHome(); break
      case 'send': openRemittance(); break
      case 'remit': openRemittance(); break
      case 'remitLogout': api.invoke('remit:logout').catch(() => {}); remitReset(); toast(T('remitLogout')); break
      case 'settings': settingsModal(); break
      case 'catShow': localStorage.setItem('aiCat112', '1'); st.catOpen = true; renderCat(); toast(T('catShown')); break
    }
  }
  api.on('menu:action', (a) => menuAction(a))

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

  async function refreshGpuTemp () {
    try { st.gpuTemp = await api.invoke('mining:gpuTemp') } catch (e) { st.gpuTemp = { ok: false, gpus: [] } }
    try { st.otherRigels = await api.invoke('miner:otherRigels') || [] } catch (e) {}
    renderIsland()
    refreshDash()
    catWatch()
  }

  // AI小貓: local rules only. It may start or restart a miner, and it may open a form.
  // It never calls s0:send, old:send, remit:login, or s0:review.
  function catOn () { return localStorage.getItem('aiCat112') !== '0' }
  function catTemp () {
    const temps = ((st.gpuTemp && st.gpuTemp.gpus) || []).map(t => Number(t.tempC)).filter(n => Number.isFinite(n))
    return temps.length ? Math.max.apply(null, temps) : null
  }
  function noteCatHeights () {
    const gpu = st.miners && st.miners.classicGpu
    if (gpu && gpu.running) {
      const slot = st.catH.classic || { h: null, at: gpu.startedAt || Date.now() }
      if (gpu.localBlock != null && gpu.localBlock !== slot.h) { slot.h = gpu.localBlock; slot.at = Date.now() }
      st.catH.classic = slot
    }
    const s0 = (st.miners && st.miners.shard0) || st.miner
    if (s0 && s0.running && (s0.peers === 0 || s0.code === 'NO_PEERS')) {
      if (!st.catH.peersAt) st.catH.peersAt = s0.startedAt || Date.now()
    } else st.catH.peersAt = 0
  }
  function catBalances () {
    const a = headerAccount()
    if (!a) return []
    if (headerChain() === 'old') {
      const v = fmtOld(a.pubkey)
      return [{ label: accLabel(a), text: (v != null ? v : '…') + ' SCDO' }]
    }
    if (!a.evm) return [{ label: accLabel(a), text: '尚未解鎖' }]
    const b = st.s0[a.filename]
    return [{ label: accLabel(a), text: (b && b.nativeWei != null ? fmtWei(b.nativeWei) : '…') + ' SCDO' }]
  }
  function catCtx (extra) {
    const caps = st.caps || {}
    const accounts = (st.accounts || []).map(a => {
      const p = parseClassicAddress(a.pubkey)
      return { label: accLabel(a), file: a.filename, shard: p ? p.shard : Number(a.shard), address: p ? p.address : '', evm: a.evm || '' }
    })
    const sel = headerAccount()
    let shard0Address = ''
    if (sel && window.SCDOZpow && window.SCDOZpow.ownRewardAddress) shard0Address = window.SCDOZpow.ownRewardAddress(sel) || ''
    if (!shard0Address) {
      const evm = (st.accounts || []).find(a => a.evm && /^0x[0-9a-fA-F]{40}$/.test(a.evm))
      if (evm) shard0Address = evm.evm
    }
    const classic = parseClassicAddress(sel && sel.pubkey)
    const gpu = st.miners && st.miners.classicGpu
    const s0 = (st.miners && st.miners.shard0) || st.miner || {}
    const slot = st.catH.classic
    return Object.assign({
      now: Date.now(),
      tempC: catTemp(),
      gpu: { available: !!(caps.gpu && caps.gpu.available), nvidia: !!(st.gpu && st.gpu.nvidia) },
      cpu: { available: !!(caps.cpu && caps.cpu.available) },
      accounts: accounts,
      preferShard: classic ? classic.shard : 0,
      shard0Address: shard0Address,
      selectedFile: sel ? sel.filename : '',
      pools: caps && caps.pools ? caps.pools : null,
      classicGpu: gpu ? { running: !!gpu.running, mode: gpu.mode, shard: gpu.shard, wallet: gpu.wallet, localBlock: gpu.localBlock, networkBlock: gpu.networkBlock, heightAgeMs: slot && slot.at ? Date.now() - slot.at : 0, code: gpu.code } : null,
      shard0: { running: !!s0.running, code: s0.code, peers: s0.peers, mode: s0.mode, wallet: s0.wallet, peerAgeMs: st.catH.peersAt ? Date.now() - st.catH.peersAt : 0 },
      mem: st.mem,
      balances: catBalances(),
      payees: allPayees()
    }, extra || {})
  }
  // 3.0.2 (v8): the user's cat art floats at the bottom right with an iOS-material label pill. Clicking opens the
  // iOS-style popup: two inset-grouped lists (coloured icon tiles, chevrons), an iMessage-style input, 下次再說 /
  // 先隱藏小貓 and the safety note. Each row goes through askCat() → SCDOCat.reply() → runCatAction(), which only opens
  // the wallet's own dialogs; transfers, remittance and signing always end in a visible confirmation.
  // 3.0.10: the popup keeps 修同步 only. Create, send, mining, balance and settings each have one place in the menu or on Home. Typing still opens those screens.
  const CAT_ROWS = [
    [['heal', 'catRowHeal', '#ff2d55', 'sync', '修同步']]
  ]
  const catPhrase = (k) => { for (const g of CAT_ROWS) for (const r of g) if (r[0] === k) return r[4]; return '' }
  // 3.0.5: animated AI小貓 in the launcher (same as the web wallet): a 68px cat replaces the avatar and cycles through
  // the frames listed in src/js/catPoses.js (window.SCDOCatPoses), one every holdMs (3 s), with a small pop + crossfade + breathing and a
  // soft dark ellipse shadow. Clicking advances one pose, then opens the same popup as before. prefers-reduced-motion
  // shows the static reducedMotionFrame and never animates. The timer only runs while the launcher is visible.
  const CAT_ANIM = (() => {
    const c = window.SCDOCatPoses || {}
    const frames = (Array.isArray(c.frames) ? c.frames : []).filter(f => typeof f === 'string' && /^[\w.-]+\.(webp|png)$/.test(f))
    const reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    const still = Math.max(0, frames.indexOf(c.reducedMotionFrame))
    return { dir: typeof c.dir === 'string' ? c.dir : './assets/cat/', hold: Math.max(400, Number(c.holdMs) || 3000), fade: Math.max(0, Number(c.fadeMs) || 600), popScale: Math.min(1.3, Math.max(1, Number(c.popScale) || 1.05)), popMs: Math.max(100, Number(c.popMs) || 450), frames, reduce, idx: reduce ? still : 0, timer: 0, bad: new Set() }
  })()
  function catAnimHtml () {
    if (!CAT_ANIM.frames.length) return '<span class="cap-av"><img src="./assets/ai-cat.png" alt=""></span>'
    const imgs = CAT_ANIM.frames.map((f, i) => `<img class="cat-f${i === CAT_ANIM.idx ? ' on' : ''}" data-i="${i}" src="${esc(CAT_ANIM.dir + f)}" alt="" draggable="false">`).join('')
    return `<span class="cap-av cat-anim${CAT_ANIM.reduce ? ' still' : ' breathe'}" id="aiCatAnim" style="--cat-fade:${CAT_ANIM.fade}ms;--cat-pop:${CAT_ANIM.popScale};--cat-pop-ms:${CAT_ANIM.popMs}ms"><i class="cat-shadow" aria-hidden="true"></i>${imgs}<span class="cat-grip" id="catGrip" data-act="catSize" data-v="next" role="button" title="" aria-label=""></span></span>`
  }
  function catAnimShow (i, pop) {
    const box = $('aiCatAnim'); const n = CAT_ANIM.frames.length
    if (!box || !n) return
    let k = ((i % n) + n) % n
    for (let t = 0; t < n && CAT_ANIM.bad.has(k); t++) k = (k + 1) % n // skip a frame that failed to load
    CAT_ANIM.idx = k
    for (const im of box.querySelectorAll('img.cat-f')) im.classList.toggle('on', Number(im.getAttribute('data-i')) === k)
    if (CAT_ANIM.reduce) return
    box.classList.remove('pop', 'breathe'); void box.offsetWidth
    if (pop) box.classList.add('pop')
    clearTimeout(CAT_ANIM.popT)
    CAT_ANIM.popT = setTimeout(() => { box.classList.remove('pop'); box.classList.add('breathe') }, CAT_ANIM.popMs)
  }
  function catAnimNext () { catAnimShow(CAT_ANIM.idx + 1, true) }
  function catAnimSync () {
    const box = $('aiCatAnim'); const btn = $('aiCatBtn')
    if (box && !box.getAttribute('data-wired')) {
      box.setAttribute('data-wired', '1')
      for (const im of box.querySelectorAll('img.cat-f')) {
        im.addEventListener('error', () => { CAT_ANIM.bad.add(Number(im.getAttribute('data-i'))); im.remove(); if (Number(im.getAttribute('data-i')) === CAT_ANIM.idx) catAnimNext() }, { once: true })
      }
    }
    catWireDrag(box ? btn : null)
    catPlaceApply()
    const run = !!(box && btn && !btn.hidden && !document.hidden && !CAT_ANIM.reduce && CAT_ANIM.frames.length > 1)
    if (run && !CAT_ANIM.timer) CAT_ANIM.timer = setInterval(() => { if (!document.hidden) catAnimNext() }, CAT_ANIM.hold)
    if (!run && CAT_ANIM.timer) { clearInterval(CAT_ANIM.timer); CAT_ANIM.timer = 0 }
  }
  document.addEventListener('visibilitychange', () => { try { catAnimSync() } catch (e) {} })
  // 3.0.7: drag the cat + 「AI小貓」 button to any corner (it snaps to the nearest one on release; a press that moves less
  // than 5px is still a plain click), three sizes (小 64px / 中 112px / 大 160px) from the grip on the cat or the popup,
  // 「放回右下角」 resets. Corner and size are kept in localStorage. The layout reserves the button's strip at that corner
  // (header for the top corners, footer or the end of main for the bottom corners, plus side padding), so the button
  // never covers any text; the popup opens from the same corner toward the inside of the window.
  const CAT_SIZES = { s: 64, m: 112, l: 160 }
  const CAT_CORNERS = ['tl', 'tr', 'bl', 'br']
  const catPlace = {
    corner: CAT_CORNERS.includes(localStorage.getItem('aiCatCorner')) ? localStorage.getItem('aiCatCorner') : 'br',
    size: CAT_SIZES[localStorage.getItem('aiCatSize')] ? localStorage.getItem('aiCatSize') : 's',
    h: 0, w: 0, dragAt: 0
  }
  function catReserve () {
    const on = !!$('aiCatAnim'); const btn = $('aiCatBtn'); const root = document.documentElement
    document.body.classList.toggle('cat-reserve', on)
    if (!on) return
    if (btn && !btn.hidden && !btn.classList.contains('dragging')) {
      const r = btn.getBoundingClientRect()
      if (r.height > 0) { catPlace.h = r.height; catPlace.w = r.width; catPlace.hSize = catPlace.size }
    }
    let h = catPlace.h; let w = catPlace.w
    if (!h || catPlace.hSize !== catPlace.size) { const px = CAT_SIZES[catPlace.size]; h = px + 8; w = px + 4 + 84 } // estimate until the button is measured at this size
    root.style.setProperty('--cat-res', Math.ceil(h + 20) + 'px')
    root.style.setProperty('--cat-side', Math.ceil(w + 16 + 14) + 'px')
  }
  function catPlaceApply () {
    const b = document.body; const c = catPlace.corner
    for (const k of CAT_CORNERS) b.classList.toggle('cat-at-' + k, k === c)
    b.classList.toggle('cat-top', c[0] === 't'); b.classList.toggle('cat-bottom', c[0] === 'b')
    document.documentElement.style.setProperty('--cat-px', CAT_SIZES[catPlace.size] + 'px')
    const order = ['s', 'm', 'l']; const next = order[(order.indexOf(catPlace.size) + 1) % 3]
    const grip = $('catGrip')
    if (grip) {
      const tip = T('catSizeTip', { s: T('catSize_' + catPlace.size), n: T('catSize_' + next) })
      if (grip.title !== tip) { grip.title = tip; grip.setAttribute('aria-label', tip) }
    }
    for (const k of order) { const e = $('catSize-' + k); if (e) { e.setAttribute('aria-pressed', String(k === catPlace.size)); e.classList.toggle('on', k === catPlace.size) } }
    const rs = $('catCornerReset'); if (rs) rs.disabled = c === 'br'
    catReserve()
    requestAnimationFrame(catReserve)
  }
  function catSetPlace (corner, size) {
    if (corner && CAT_CORNERS.includes(corner)) { catPlace.corner = corner; localStorage.setItem('aiCatCorner', corner) }
    if (size === 'next') { const o = ['s', 'm', 'l']; size = o[(o.indexOf(catPlace.size) + 1) % 3] }
    if (size && CAT_SIZES[size]) { catPlace.size = size; localStorage.setItem('aiCatSize', size) }
    catPlaceApply()
  }
  function catWireDrag (btn) {
    if (!btn || btn.getAttribute('data-drag')) return
    btn.setAttribute('data-drag', '1')
    let d = null
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
    // moves and the release are read on window (a fast drag leaves the button before the first move event arrives)
    const move = (e) => {
      if (!d || e.pointerId !== d.id) return
      if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) return
      if (!d.moved) { d.moved = true; btn.classList.add('dragging') }
      e.preventDefault()
      const r = btn.getBoundingClientRect()
      btn.style.left = clamp(e.clientX - d.dx, 0, innerWidth - r.width) + 'px'
      btn.style.top = clamp(e.clientY - d.dy, 0, innerHeight - r.height) + 'px'
      btn.style.right = 'auto'; btn.style.bottom = 'auto'
    }
    const end = (e) => {
      if (!d || (e && e.pointerId !== d.id)) return
      const moved = d.moved; d = null
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end)
      if (!moved) return
      const r = btn.getBoundingClientRect(); const cx = r.left + r.width / 2; const cy = r.top + r.height / 2
      btn.classList.remove('dragging')
      btn.style.left = ''; btn.style.top = ''; btn.style.right = ''; btn.style.bottom = ''
      catPlace.dragAt = Date.now()
      catSetPlace((cy < innerHeight / 2 ? 't' : 'b') + (cx < innerWidth / 2 ? 'l' : 'r'), null)
    }
    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return
      const r = btn.getBoundingClientRect()
      d = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: e.clientX - r.left, dy: e.clientY - r.top, moved: false }
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end)
    })
    btn.addEventListener('dragstart', (e) => e.preventDefault())
    btn.addEventListener('click', (e) => { if (Date.now() - catPlace.dragAt < 500) { e.stopPropagation(); e.preventDefault() } }, true)
  }
  window.addEventListener('resize', () => { try { catReserve() } catch (e) {} })
  function renderCat () {
    const root = $('aiCatRoot')
    if (!root) return
    if (!catOn() || !window.SCDOCat) { SD.clear(root); root.removeAttribute('data-lang'); document.body.classList.remove('cat-reserve'); return }
    if (!$('aiCatBtn') || root.getAttribute('data-lang') !== lang()) {
      root.setAttribute('data-lang', lang())
      const rows = CAT_ROWS.map(g => `<div class="ios-group">${g.map(([k, label, color, icon]) => `<button type="button" class="ios-row" data-act="catRow" data-v="${k}" id="catRow-${k}"><span class="ios-tile" style="background:${color}"><img src="./assets/ui/${icon}.svg" alt=""></span><span class="ios-lbl">${esc(T(label))}</span><img class="ios-chev" src="./assets/ui/chev.svg" alt=""></button>`).join('')}</div>`).join('')
      SD.html(root, `<button type="button" class="cat-launch cat-capsule" id="aiCatBtn" data-act="catOpen" title="${esc(T('catLauncher'))}" aria-label="${esc(T('catLauncher'))}">${catAnimHtml()}<span class="cap-t">${esc(T('catTitle'))}</span></button>
        <div class="cat-pop bubble" id="aiCatPanel" role="dialog" aria-label="AI小貓" hidden>
          <i class="bub b1" aria-hidden="true"></i><i class="bub b2" aria-hidden="true"></i><i class="bub b3" aria-hidden="true"></i><i class="bub b4" aria-hidden="true"></i>
          <button type="button" class="ios-x" data-act="catClose" title="${esc(T('catClose'))}" aria-label="${esc(T('catClose'))}"><img src="./assets/ui/x.svg" alt=""></button>
          <div class="ios-hd center"><span class="av"><img src="./assets/ai-cat.png" alt=""></span><div class="t1">${esc(T('catTitle'))}</div><div class="t2">${esc(T('catAskQ'))}</div></div>
          <div class="ios-log" id="aiCatLog" aria-live="polite"></div>
          ${rows}
          <button type="button" class="cat-type" id="catType" data-act="catType">${esc(T('catInput'))}</button>
          <div class="ios-in" id="aiCatInRow" hidden><input class="pill" id="aiCatIn" maxlength="200" placeholder="${esc(T('catInput'))}" autocomplete="off" spellcheck="false"><button type="button" class="send" data-act="catAsk" title="${esc(T('catSend'))}" aria-label="${esc(T('catSend'))}"><img src="./assets/ui/up.svg" alt=""></button></div>
          <div class="ios-foot"><button type="button" data-act="catLater" id="catLater">${esc(T('catLater'))}</button><button type="button" data-act="catHide" id="catHide">${esc(T('catHide'))}</button></div>
          <div class="cat-place" id="catPlace" role="group" aria-label="${esc(T('catSizeLbl'))}"><span class="cat-place-l">${esc(T('catSizeLbl'))}</span><span class="cat-seg">${['s', 'm', 'l'].map(k => `<button type="button" data-act="catSize" data-v="${k}" id="catSize-${k}" aria-pressed="false">${esc(T('catSize_' + k))}</button>`).join('')}</span><button type="button" class="cat-reset" data-act="catCorner" data-v="br" id="catCornerReset">${esc(T('catCornerReset'))}</button></div>
          <div class="ios-note">${esc(T('catNote'))}</div>
          <details class="cat-help"><summary>${esc(T('help_title'))}</summary>${contactHtml('catContact')}</details>
        </div>`)
    }
    const panel = $('aiCatPanel')
    if (panel) panel.hidden = !st.catOpen
    const btn = $('aiCatBtn')
    if (btn) btn.hidden = !!st.catOpen
    catAnimSync()
    const log = $('aiCatLog')
    if (!log) return
    log.textContent = ''
    const lines = st.catLog.slice(-4)
    log.hidden = !lines.length
    for (const line of lines) {
      const d = document.createElement('div')
      d.className = 'ai-line' + (String(line).startsWith('你：') ? ' me' : '')
      d.textContent = line
      log.appendChild(d)
    }
    log.scrollTop = log.scrollHeight
  }
  async function startCatJob (job) {
    if (!job || !job.address) return { fail: window.SCDOCat.startFail('BAD_ADDRESS') }
    if (job.chain === 'classic') {
      const backend = job.backend === 'gpu' ? 'gpu' : 'cpu'
      const gpu = gpuParams()
      const threads = backend === 'cpu' ? threadCount() : gpu.threads
      let r
      try {
        r = await api.invoke('miner:start', job.address, {
          chain: 'classic', backend: backend, gpuMiner: 'classic-node', shard: job.shard,
          threads: threads, threadblocks: gpu.threadblocks, blockthreads: gpu.blockthreads
        })
      } catch (e) { r = { ok: false, code: 'BAD_ADDRESS' } }
      if (!r || !r.ok) return { fail: window.SCDOCat.startFail(r && r.code) }
      localStorage.setItem(backend === 'cpu' ? 'minerRunClassicCpu' : 'minerRunClassicGpu', backend === 'cpu' ? '1' : 'gpu')
      localStorage.setItem(backend === 'cpu' ? 'minerClassicCpu' : 'minerClassicGpu', job.address)
      return { ok: true }
    }
    if (!(await okWithOtherRigel())) return { fail: window.SCDOCat.startFail('CANCELED') }
    let r
    try { r = await api.invoke('miner:start', job.address, { mode: job.mode === 'node' ? 'node' : 'mine' }) } catch (e) { r = { ok: false } }
    if (!r || !r.ok) return { fail: window.SCDOCat.startFail(r && r.code) }
    if (job.mode !== 'node') localStorage.setItem('minerRunShard0', '1')
    return { ok: true }
  }
  async function runCatAction (action) {
    if (!action || action.type === 'send' || action.type === 'sign' || action.type === 'spend' || action.type === 'review' || action.type === 'login') return { ok: false }
    if (action.type === 'stopGpu') {
      try { await api.invoke('miner:stop', { chain: 'classic', backend: 'gpu' }) } catch (e) {}
      const s0 = (st.miners && st.miners.shard0) || st.miner
      if (s0 && s0.running && s0.mode !== 'node') { try { await api.invoke('miner:stop', 'mine') } catch (e) {} }
      return { ok: true }
    }
    if (action.type === 'startJobs' || action.type === 'restartJobs') {
      const fails = []
      for (const job of action.jobs || []) {
        if (action.type === 'restartJobs') {
          try {
            if (job.chain === 'classic') await api.invoke('miner:stop', { chain: 'classic', backend: job.backend === 'gpu' ? 'gpu' : 'cpu' })
            else await api.invoke('miner:stop', job.mode === 'node' ? 'node' : 'mine')
          } catch (e) {}
        }
        const r = await startCatJob(job)
        if (r && r.fail) fails.push(r.fail)
      }
      return fails.length ? { fail: fails.join('') } : { ok: true }
    }
    if (action.type === 'prefill') {
      if (!action.file) return { fail: '請先選擇帳戶。' }
      payModal(action.file, { to: action.to || '', amount: action.amount || '' })
      return { ok: true }
    }
    if (action.type === 'openBackup') { backupPickModal(); return { ok: true } }
    if (action.type === 'open') {
      st.catOpen = false; renderCat()
      const f = action.form
      if (f === 'create') createModal()
      else if (f === 'import') importChoiceModal()
      else if (f === 'settings') settingsModal()
      else if (f === 'reward') goPage('mineSet')
      else if (f === 'send' || f === 'remit') openRemittance()
      else if (f === 'stop') stopAll()
      return { ok: true }
    }
    return { ok: true }
  }
  async function applyCatPlan (plan, opt) {
    if (!plan) return
    const fails = []
    for (const action of plan.actions || []) {
      const r = await runCatAction(action)
      if (r && r.fail) fails.push(r.fail)
    }
    const say = (plan.say || '') + (fails.length ? fails.join('') : '')
    if (!say) return
    st.catLog.push(say)
    if (st.catLog.length > 30) st.catLog.shift()
    renderCat()
    if (opt && opt.toast) toast(say, 6000)
  }
  async function askCat (text, opt) {
    const raw = String(text || '')
    if (/開始挖礦|一鍵挖礦|也挖|自我修復|修復/.test(raw)) {
      try { await ensureCaps() } catch (e) {}
      try { await ensureGpu() } catch (e) {}
      try { st.gpuTemp = await api.invoke('mining:gpuTemp') } catch (e) {}
      try { st.mem = await api.invoke('app:mem') } catch (e) {}
    }
    if (!window.SCDOCat.looksLikeSecret(raw) && !(opt && opt.quiet)) {
      const shown = raw.normalize('NFKC').trim().slice(0, 200)
      if (shown) st.catLog.push('你：' + shown)
    }
    await applyCatPlan(window.SCDOCat.reply(raw, catCtx({ mining: miningBusy() })), opt)
  }
  async function catWatch () {
    if (!catOn() || !window.SCDOCat) return
    noteCatHeights()
    const heat = window.SCDOCat.heatGuard(catCtx())
    if (heat && Date.now() - st.catHeatAt > 60000) {
      st.catHeatAt = Date.now()
      await applyCatPlan(heat, { toast: true })
      return
    }
    if (catTemp() != null && catTemp() < 80) st.catHeatAt = 0
    if (Date.now() - st.catWatchAt < 30000) return
    st.catWatchAt = Date.now()
    try { st.mem = await api.invoke('app:mem') } catch (e) {}
    const heal = window.SCDOCat.planHeal(catCtx())
    if (!heal.actions.length) { st.catHealKey = ''; return }
    const key = JSON.stringify(heal.actions)
    if (key === st.catHealKey && Date.now() - st.catHealAt < 10 * 60 * 1000) return
    st.catHealKey = key
    st.catHealAt = Date.now()
    await applyCatPlan(heal, { toast: true })
  }

  // Chip shimmer, pulse, and the spinning pick keep painting while the window
  // is in the background. Pause them on hide and on blur; resume on focus.
  function bindIsleMotion () {
    const root = document.documentElement
    if (!root || !root.classList || typeof window.addEventListener !== 'function') return
    let focused = typeof document.hasFocus !== 'function' || document.hasFocus()
    const apply = () => {
      root.classList.toggle('isle-paused', document.hidden === true || !focused)
    }
    document.addEventListener('visibilitychange', apply)
    window.addEventListener('blur', () => { focused = false; apply() })
    window.addEventListener('focus', () => { focused = true; apply() })
    apply()
  }
  bindIsleMotion()

  // ---------------- boot ----------------
  let APPVER = '2.0.9'
  let APPCOMMIT = ''
  api.on('miner:status', (m) => onMinerStatus(m))
  api.on('miner:classic', (m) => onMinerStatus(m))
  async function boot () {
    let info = null
    try { info = await api.invoke('app:info'); if (info && info.version) APPVER = info.displayVersion || info.version; if (info && info.commit) APPCOMMIT = info.commit } catch (e) {}
    try { storeMiner(await api.invoke('miner:status')) } catch (e) {}
    try { const c = await api.invoke('miner:classicStatus'); if (c) { st.miners.classicCpu = c.classicCpu; st.miners.classicGpu = c.classicGpu } } catch (e) {}
    st.miner = viewMiner()
    loadAccounts()
    render()
    if (window.__scdoBootDone) window.__scdoBootDone() // 2.0.6: the loading screen goes away once the real page is drawn
    // 2.0.6: right after an update, say so (titled dialog) and show the mining state
    if (info && info.updated) {
      const x = currentMinePill()
      modal(`<div class="mh"><h2>${esc(T('updatedTitle', { v: APPVER }))}</h2></div>
        <div style="font-size:18px;margin:10px 0">${esc(T('updatedMsg', { v: APPVER }))}</div>
        <div class="minepill ${x.cls}" id="updMine" style="display:inline-block;margin:6px 0 10px">${esc(x.t)}</div>
        <div class="lbl" style="font-size:16px">${esc(T('updatedTray'))}</div>
        <div class="foot"><button class="btn pri" data-act="updatedOk" id="updatedOk">${esc(T('done'))}</button></div>`, { width: 640, noFocus: true })
    }
    refreshS0(); refreshOld(); refreshGpuTemp(); renderCat()
    setInterval(refreshS0, 15000); setInterval(refreshOld, 30000); setInterval(refreshGpuTemp, 15000)
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
      if (r && !r.ok) toast(window.SCDOStartError.full(lang(), r.code, r.error), 7000)
    })
    if (st.tab === 'mineSet') render()
  }
  boot()
})()
