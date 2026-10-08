// SCDO Wallet 3.0.2 Home dashboard (approved v8 mockup): five identical full-width chain cards
// (Shard0 EVM, Shard1, Shard2, Shard3, Shard4), the recent-transactions list and the fixed 總餘額 footer.
// Read-only: the only controls are copy and QR on each receiving address. Every action lives in AI小貓 and the
// window menu. Pure functions (no DOM, no IPC) so the card structure can be tested in Node.
'use strict'
;(function () {
const FIELDS = ['sync', 'speed', 'blocks', 'gpu', 'temp', 'net']
const COPY_SVG = '<img class="ui-ico" src="./assets/ui/copy.svg" alt="" width="18" height="18">'
const QR_SVG = '<img class="ui-ico" src="./assets/ui/qr.svg" alt="" width="18" height="18">'

function num (v) { const n = Number(v); return Number.isFinite(n) ? n : null }

// input: { T, isl (window.SCDOIsland), miners: { shard0, classicCpu, classicGpu }, temps: [{ name, tempC }], gpuNames: [],
//   balances: [5 x text|null], accounts: [5 x { label, count, address, file, chain, locked }], blocks: [5 x number],
//   net: { s0Ok, s0Block, oldOk }, eta: (sec) => text }
function chainModels (input) {
  const T = input.T
  const isl = input.isl
  const miners = input.miners || {}
  const temps = (input.temps || []).map(t => num(t && t.tempC)).filter(n => n != null)
  const tempC = temps.length ? Math.max.apply(null, temps) : null
  const net = input.net || {}
  return [0, 1, 2, 3, 4].map(n => {
    const src = isl.shardSources(n, miners)
    const name = n === 0 ? 'Shard0 EVM' : 'Shard' + n
    const gpu = src.gpu && isl.isGpuMine(src.gpu) ? src.gpu : null
    const cpu = src.cpu
    const gpuOn = !!(gpu && isl.miningNow(gpu))
    const cpuOn = !!(cpu && isl.miningNow(cpu))
    const sync = src.syncFrom ? isl.syncOf(src.syncFrom) : (cpu ? { kind: 'pool' } : { kind: 'off' })
    const pct = isl.syncPct(sync)
    // 同步進度
    let syncText; let bar = 0; let part = false
    if ((sync.kind === 'synced' || sync.kind === 'syncing') && pct != null) {
      bar = pct; part = sync.kind === 'syncing'
      const when = sync.kind === 'syncing' ? ((sync.etaSec != null && Number(sync.etaSec) >= 5 && input.eta) ? input.eta(sync.etaSec) : T('isleEtaCalc')) : ''
      syncText = sync.kind === 'syncing' ? T('d_syncEta', { pct: pct, when: when }) : T('d_syncPct', { pct: pct })
    } else if (sync.kind === 'pending' || sync.kind === 'checking') { syncText = T('d_syncChecking'); part = true } else if (sync.kind === 'pool') { syncText = T('d_syncPool'); bar = 100 } else syncText = T('d_syncOff')
    // 挖礦速度
    const speeds = []
    if (gpuOn) speeds.push(T('d_speedDev', { speed: isl.speedWords(gpu.hashrate, T) || T('isleSpeedUnknown'), dev: T('d_devGpu') }))
    if (cpuOn) speeds.push(T('d_speedDev', { speed: isl.speedWords(cpu.hashrate, T) || T('isleSpeedUnknown'), dev: T('d_devCpu') }))
    let speedText = speeds.join(T('d_listSep'))
    if (!speedText) speedText = gpu && gpu.running ? T('d_waitSync') : T('d_notMining')
    // 本機已挖到
    const live = (gpu ? num(gpu.blocksFound) || 0 : 0) + (cpu ? num(cpu.blocksFound) || 0 : 0)
    const blocks = Math.max(live, num(input.blocks && input.blocks[n]) || 0)
    // 顯卡 / 顯卡溫度
    const gpuText = gpu ? ((input.gpuNames || []).filter(Boolean).join(T('d_listSep')) || T('d_gpuUnnamed')) : T('d_noGpuUse')
    let tempText; let tempBand = ''
    if (!gpu) tempText = T('d_noGpuTemp')
    else if (tempC == null) tempText = T('d_tempUnknown')
    else { tempBand = isl.tempBand(tempC); tempText = T('d_temp', { n: tempC, state: T(tempBand === 'hot' ? 'isleHot' : tempBand === 'warm' ? 'isleWarm' : 'isleOk') }) }
    // 網路
    const peers = isl.peersOf(gpu || cpu || (src.node && src.node.running ? src.node : null) || src.syncFrom)
    let netText
    if (peers != null) netText = T('d_peers', { n: peers })
    else {
      const ok = n === 0 ? net.s0Ok : net.oldOk
      if (ok) netText = n === 0 && net.s0Block != null ? T('d_publicBlock', { n: Number(net.s0Block).toLocaleString('en-US') }) : T('d_public')
      else if (ok === false) netText = T('d_offline')
      else netText = T('d_connecting')
    }
    // status pills
    const pills = []
    const err = [gpu, cpu, src.node].some(m => m && m.phase === 'error')
    // 3.0.3 (no duplicates): mining / not mining / syncing badges repeated the 挖礦速度 and 同步進度 fields
    // of the same card. Only badges that say something the fields don't are kept.
    if (src.node && src.node.running && src.node.mode === 'node') pills.push({ cls: 'off', text: T('d_pillNode') })
    if (err) pills.push({ cls: 'bad', text: T('d_pillError') })
    const acc = (input.accounts && input.accounts[n]) || {}
    return {
      n,
      name,
      dot: (n === 0 ? net.s0Ok : net.oldOk) == null ? '' : ((n === 0 ? net.s0Ok : net.oldOk) ? 'ok' : 'bad'),
      account: acc,
      pills,
      balance: input.balances && input.balances[n] != null ? input.balances[n] : '…',
      sync: { text: syncText, bar: bar, part: part },
      speed: speedText,
      blocks: T('d_blocks', { n: blocks.toLocaleString('en-US') }),
      gpu: gpuText,
      temp: tempText,
      tempBand,
      net: netText
    }
  })
}

function kv (esc, field, label, value, extra) {
  return `<div class="kv-item" data-field="${field}"><span class="lbl">${esc(label)}</span><b class="${extra && extra.cls ? esc(extra.cls) : ''}">${esc(value)}</b>${extra && extra.bar != null ? `<div class="bar${extra.part ? ' part' : ''}"><i style="width:${Number(extra.bar) || 0}%"></i></div>` : ''}</div>`
}

function cardHtml (m, T, esc) {
  const a = m.account || {}
  const tag = a.label ? (a.count > 1 ? T('d_acctMany', { name: a.label, n: a.count }) : a.label) : T('d_noAcct')
  let addr
  if (a.address) {
    addr = `<span class="mono" data-addr="${m.n}">${esc(a.address)}</span>
      <button type="button" class="ico" data-act="copy" data-v="${esc(a.address)}" title="${esc(T('d_copyAddr'))}" aria-label="${esc(T('d_copyAddr'))}">${COPY_SVG}</button>
      <button type="button" class="ico" data-act="receive" data-f="${esc(a.file || '')}" data-chain="${m.n === 0 ? 'new' : 'old'}" title="${esc(T('d_showQr'))}" aria-label="${esc(T('d_showQr'))}">${QR_SVG}</button>`
  } else addr = `<span class="muted">${esc(a.locked ? T('d_addrLocked') : T('d_addrNone'))}</span>`
  return `<div class="card dc chain" data-chain-card="${m.n}" id="chainCard${m.n}">
    <div class="top"><span class="dot ${esc(m.dot)}"></span><span class="nm">${esc(m.name)}</span><span class="tag">${esc(tag)}</span>${m.pills.map(p => `<span class="state ${esc(p.cls)}">${esc(p.text)}</span>`).join('')}</div>
    <div class="balrow" data-field="balance"><span class="lbl">${esc(T('d_balance'))}</span><span class="v" id="chainBal${m.n}">${esc(m.balance)}</span><span class="lbl">SCDO</span></div>
    <div class="kv">${kv(esc, 'sync', T('d_sync'), m.sync.text, { bar: m.sync.bar, part: m.sync.part })}${kv(esc, 'speed', T('d_speed'), m.speed)}${kv(esc, 'blocks', T('d_blocksLbl'), m.blocks)}${kv(esc, 'gpu', T('d_gpu'), m.gpu)}${kv(esc, 'temp', T('d_tempLbl'), m.temp, { cls: m.tempBand ? 'temp-' + m.tempBand : '' })}${kv(esc, 'net', T('d_net'), m.net)}</div>
    <div class="addr-row" data-field="address"><span class="lbl">${esc(T('d_addr'))}</span>${addr}</div></div>`
}

function tempKeyHtml (T, esc) {
  return `<div class="tkey top-key" id="tempKey"><span class="lbl">${esc(T('d_tempKey'))}</span><span class="isle-chip temp-ok"><span class="isle-val">${esc(T('d_tempKeyOk'))}</span></span><span class="isle-chip temp-warm"><span class="isle-val">${esc(T('d_tempKeyWarm'))}</span></span><span class="isle-chip temp-hot"><span class="isle-val">${esc(T('d_tempKeyHot'))}</span></span></div>`
}

// rows: [{ dir: 'in'|'out'|'mine', title, sub, amount, hash }]
function txHtml (rows, T, esc) {
  if (!rows || !rows.length) return `<div class="card tx" id="recentTx"><div class="r"><span class="muted">${esc(T('d_noTx'))}</span></div></div>`
  return `<div class="card tx" id="recentTx">${rows.map(r => `<div class="r"${r.hash ? ` data-act="openTx" data-v="${esc(r.hash)}"` : ''}><span class="ic">${r.dir === 'in' ? '\u2B07' : r.dir === 'mine' ? '\u26CF' : r.dir === 'self' ? '\u21C4' : '\u2B06'}</span><div class="w"><b>${esc(r.title)}</b><div class="lbl">${esc(r.sub)}</div></div><div class="amt ${r.dir === 'out' || r.dir === 'self' ? '' : 'plus'}">${esc(r.amount)}</div></div>`).join('')}</div>`
}

// totals: { all: text, per: [5 x text] }
// 3.0.3: one line only. Each shard's balance is already on its own card, so the footer no longer repeats them.
function footerHtml (totals, T, esc) {
  return `<div class="foot-line" id="footLine"><span class="foot-h">${esc(T('d_totalLine'))}</span><b id="footAll">${esc(totals.all)} SCDO</b></div>`
}

function homeHtml (models, txRows, T, esc) {
  return `<div class="page dash" id="homePage">
    <div class="dash-h"><span class="h1">${esc(T('d_title'))}</span></div>
    <div class="sec-h">${esc(T('d_accHead'))}</div>
    ${tempKeyHtml(T, esc)}
    <div class="chains" id="chainCards">${models.map(m => cardHtml(m, T, esc)).join('')}</div>
    <div class="sec-h">${esc(T('d_recent'))}</div><div id="recentTxHost">${txHtml(txRows, T, esc)}</div>
  </div>`
}

const api = { FIELDS, chainModels, cardHtml, tempKeyHtml, txHtml, footerHtml, homeHtml, COPY_SVG, QR_SVG }
if (typeof module !== 'undefined' && module.exports) module.exports = api
if (typeof window !== 'undefined') window.SCDODash = Object.freeze(api)
})()
