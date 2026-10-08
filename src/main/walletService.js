// SCDO Wallet 2.0.1 main-process wallet service.
// 2.0.0 ran all of this in the renderer (nodeIntegration: true): keyfile decryption, signing, fs access and RPC.
// In 2.0.1 the renderer is sandboxed (no Node), and every privileged step lives here behind a small IPC surface that
// preload.js allowlists. Private keys never leave this process; they are only held for the duration of one signing.
'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { ethers } = require('ethers')
const { dialog, BrowserWindow } = require('electron')
const ScdoClient = require('../api/scdoClient')
const { Shard0 } = require('../api/evm')
const { normalizeHalfWidth } = require('../js/halfWidth')

const S0_CHAIN_ID = 5680
const HOME = path.join(os.homedir(), '.ScdoWallet')
const UI_PATH = path.join(HOME, 'ui112.json')
const S0TX_PATH = path.join(HOME, 's0tx.json')
const ADDR_RE = /^0x[0-9a-fA-F]{40}$/
const CLASSIC_RE = /^[1-4]S[0-9a-fA-F]{40}$/
const REVIEW_TTL_MS = 10 * 60 * 1000

let client = null
let s0 = null
const reviews = new Map() // token -> { file, from, to, amount, asset, at }

function c () { if (!client) client = new ScdoClient(); return client }
function shard0 () {
  if (!s0) { const cfg = c().config || {}; s0 = new Shard0(Object.assign({}, cfg.shard0 || {}, { rpc: (cfg.connect && cfg.connect[0]) || 'https://scdoscan.io/rpc/0' })) }
  return s0
}
function readJson (p, d) { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch (e) { return d } }
function writeJson (p, v) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2)) }
const str = (x) => (x == null ? null : x.toString()) // bigint -> string for IPC
function plainErr (e) { return String((e && (e.shortMessage || e.message)) || e) }
const NET_RE = /ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|fetch failed|network error|socket hang up|TIMEOUT/i // 2.0.2 D-08
const netOr = m => (NET_RE.test(String(m)) ? 'NETWORK' : m)

function accounts () {
  const cl = c(); cl.accountList()
  return cl.accountArray.map(a => ({ filename: a.filename, pubkey: a.pubkey, shard: a.shard, evm: cl.evmAddressOf(a.filename) }))
}
function accByFile (f) { return accounts().find(a => a.filename === f) }
function safeName (f) {
  if (typeof f !== 'string' || !f || f !== path.basename(f) || f === '.' || f === '..' || /[\\/]/.test(f)) throw new Error('invalid keyfile name')
  return f
}

// ---------- shard0 activity (local file, same format as 2.0.0) ----------
function s0txAll () { return readJson(S0TX_PATH, []) }
function s0txAdd (r) { const l = s0txAll(); l.unshift(r); writeJson(S0TX_PATH, l.slice(0, 500)) }
function s0txUpdate (hash, patch) { const l = s0txAll(); const r = l.find(x => x.hash === hash); if (r) { Object.assign(r, patch); writeJson(S0TX_PATH, l) } }

// 2.0.2 D-01: incoming transfers were never listed (only local outgoing records). Merge the explorer's list.
// 3.0.4: every chain (Shard0 EVM and Shard1–Shard4) reads https://api.scdoscan.io/api/address/{addr}/txs, which lists
// incoming and outgoing transfers, block rewards and token transfers. Shard0 falls back to the etherscan-style txlist
// when that endpoint fails. Amounts stay integer units (string) plus decimals; the window formats them.
const EXPLORER_API = 'https://api.scdoscan.io/api'
const ADDR_TXS = (a) => EXPLORER_API + '/address/' + encodeURIComponent(a) + '/txs?page=1&limit=25'
const REWARD_FROM = /^0S0{40}$/i
async function fetchJson (url, ms) {
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), ms || 10000)
  try { const r = await fetch(url, { signal: ctl.signal }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json() } finally { clearTimeout(tm) }
}
// one indexer row -> wallet row { t, from, to, raw, decimals, asset, hash, block, status, dir }
function indexerRow (t, a, nativeDec) {
  const from = String(t.from || ''); const to = String(t.to || '')
  const tok = t.token && typeof t.token === 'object' ? t.token : null
  const dec = tok ? (tok.decimals == null ? null : Number(tok.decimals)) : nativeDec
  const isFrom = from.toLowerCase() === a; const isTo = to.toLowerCase() === a
  return {
    t: Number(t.time || 0) * 1000, from, to,
    raw: /^\d+$/.test(String(t.value || '')) ? String(t.value) : null, decimals: dec, amount: t.valueFormatted == null ? '' : String(t.valueFormatted),
    asset: tok ? String(tok.symbol || '?') : 'SCDO', hash: String(t.hash || ''), block: Number(t.block || 0),
    status: t.status === 'success' ? 'done' : t.status === 'failed' ? 'fail' : 'pending',
    dir: REWARD_FROM.test(from) ? 'reward' : (isFrom ? (isTo ? 'self' : 'out') : 'in')
  }
}
async function addrTxs (addr, nativeDec) {
  const j = await fetchJson(ADDR_TXS(addr))
  if (!j || !Array.isArray(j.txs)) throw new Error('BAD_INDEXER_REPLY')
  const a = String(addr).toLowerCase()
  return j.txs.map(t => indexerRow(t, a, nativeDec))
}
async function s0activity (addr) {
  const a = String(addr || '').toLowerCase(); if (!ADDR_RE.test(a)) return []
  const local = s0txAll().filter(r => r.from && r.from.toLowerCase() === a).map(r => { const o = Object.assign({ dir: r.to && r.to.toLowerCase() === a ? 'self' : 'out' }, r); delete o.raw; return o })
  let remote = []
  try { remote = await addrTxs(a, 18) } catch (e) {
    try {
      const j = await fetchJson(EXPLORER_API + '?module=account&action=txlist&address=' + a + '&page=1&offset=50&sort=desc')
      if (j && Array.isArray(j.result)) remote = j.result.map(t => ({ t: Number(t.timeStamp) * 1000, from: t.from, to: t.to, raw: String(BigInt(t.value || '0')), decimals: 18, amount: ethers.formatEther(BigInt(t.value || '0')), asset: 'SCDO', hash: t.hash, block: Number(t.blockNumber), status: t.isError === '1' || t.txreceipt_status === '0' ? 'fail' : 'done', dir: (t.from || '').toLowerCase() === a ? ((t.to || '').toLowerCase() === a ? 'self' : 'out') : 'in' }))
    } catch (e2) {}
  }
  const seen = new Map(); for (const r of remote) { const k = r.hash.toLowerCase() + (r.asset === 'SCDO' ? '' : ':' + r.asset); if (!seen.has(k)) seen.set(k, r) }
  for (const r of local) {
    const k = String(r.hash).toLowerCase(); const kt = k + ':' + r.asset
    if (seen.has(k) || seen.has(kt)) continue
    seen.set(r.asset === 'SCDO' ? k : kt, r)
  }
  return [...seen.values()].sort((x, y) => (y.t || 0) - (x.t || 0)).slice(0, 30)
}
// Shard1–Shard4: indexer rows plus this computer's own send records that the indexer doesn't list yet
async function oldActivity (addr) {
  const a = String(addr || '').trim()
  if (!CLASSIC_RE.test(a)) return { ok: false, rows: [] }
  const al = a.toLowerCase()
  let remote = []; let ok = true
  try { remote = await addrTxs(a, 8) } catch (e) { ok = false }
  let local = []
  try { const cl = c(); cl.getRecords(); local = (cl.txRecords || []).filter(r => r && (String(r.fa).toLowerCase() === al || String(r.ta).toLowerCase() === al)) } catch (e) {}
  const seen = new Set(remote.map(r => r.hash.toLowerCase()))
  for (const r of local) {
    const h = String(r.s || '').toLowerCase()
    if (h && seen.has(h)) continue
    const out = String(r.fa).toLowerCase() === al; const self = out && String(r.ta).toLowerCase() === al
    remote.push({ t: Number(r.t) || 0, from: r.fa, to: r.ta, raw: /^\d+$/.test(String(r.m)) ? String(r.m) : null, decimals: 8, asset: 'SCDO', hash: String(r.s || ''), block: 0, status: r.u == 1 ? 'done' : r.u == 0 ? 'fail' : 'pending', dir: self ? 'self' : (out ? 'out' : 'in'), local: true }) // eslint-disable-line eqeqeq
  }
  return { ok, rows: remote.sort((x, y) => (y.t || 0) - (x.t || 0)).slice(0, 30) }
}

// ---------- address checks (P0 #1) ----------
// -> { ok, address (EIP-55), errors: [code], warnings: [code] }
// errors block the transfer; warnings must be acknowledged on the confirm screen.
async function checkAddress (from, to, asset) {
  const out = { ok: false, address: null, errors: [], warnings: [] }
  to = normalizeHalfWidth(to)
  if (CLASSIC_RE.test(to)) { out.errors.push('CLASSIC_ADDR'); return out }
  if (!ADDR_RE.test(to)) { out.errors.push('FORMAT'); return out }
  const body = to.slice(2)
  const mixed = body !== body.toLowerCase() && body !== body.toUpperCase()
  let cs
  try { cs = ethers.getAddress(mixed ? to : to.toLowerCase()) } catch (e) { out.errors.push('CHECKSUM'); return out } // mixed case with a wrong EIP-55 checksum
  if (/^0x0{40}$/.test(body)) { out.errors.push('ZERO_ADDR'); return out }
  if (!mixed) out.warnings.push('NO_CHECKSUM')
  if (from && ADDR_RE.test(from) && from.toLowerCase() === cs.toLowerCase()) out.warnings.push('SELF')
  const tok = asset && asset !== 'SCDO' ? shard0().token(asset) : null
  if (tok && tok.address.toLowerCase() === cs.toLowerCase()) out.warnings.push('TOKEN_CONTRACT')
  try {
    const code = await shard0().provider.getCode(cs)
    if (code && code !== '0x') out.warnings.push('CONTRACT')
  } catch (e) { out.warnings.push('CONTRACT_UNKNOWN') }
  out.ok = true; out.address = cs
  return out
}

function parseAmount (amount, decimals) {
  const v = normalizeHalfWidth(amount).replace(/,/g, '')
  if (!/^\d+(\.\d+)?$/.test(v)) throw new Error('BAD_AMOUNT')
  const w = ethers.parseUnits(v, decimals)
  if (w <= 0n) throw new Error('BAD_AMOUNT')
  return { v, w }
}

async function estimate (from, to, amount, asset) {
  const f = await shard0().estimateSend(from, to, amount && Number(amount) > 0 ? amount : '0', asset)
  return { gasLimit: str(f.gasLimit), maxFeePerGas: str(f.maxFeePerGas), baseFee: str(f.baseFee), tip: str(f.tip), maxFeeWei: str(f.maxFeeWei), estFeeWei: str(f.estFeeWei) }
}

// Build the confirm-screen data and park the reviewed parameters under a one-time token. s0:send signs exactly these.
async function review (p) {
  p = p || {}
  const a = accByFile(safeName(p.file))
  if (!a || !a.evm) throw new Error('NO_ACCOUNT')
  const asset = p.asset || 'SCDO'
  const tok = asset === 'SCDO' ? null : shard0().token(asset)
  if (asset !== 'SCDO' && !tok) throw new Error('UNKNOWN_ASSET')
  const chk = await checkAddress(a.evm, p.to, asset)
  if (!chk.ok) return { ok: false, check: chk }
  const { v, w } = parseAmount(p.amount, tok ? tok.decimals : 18)
  const ci = await shard0().chainInfo()
  if (ci.chainId !== S0_CHAIN_ID) return { ok: false, error: 'WRONG_CHAIN', chainId: ci.chainId }
  const fee = await shard0().estimateSend(a.evm, chk.address, v, asset)
  const bal = await shard0().balances(a.evm)
  const errors = []
  if (asset === 'SCDO') { if (w + fee.maxFeeWei > bal.nativeWei) errors.push('INSUFFICIENT') } else {
    const bt = bal.tokens.find(t => t.symbol === asset)
    if (!bt || bt.raw == null || w > bt.raw) errors.push('INSUFFICIENT')
    if (fee.maxFeeWei > bal.nativeWei) errors.push('NO_FEE_BALANCE')
  }
  const token = crypto.randomBytes(16).toString('hex')
  for (const [k, r] of reviews) if (Date.now() - r.at > REVIEW_TTL_MS) reviews.delete(k)
  if (!errors.length) reviews.set(token, { file: a.filename, from: a.evm, to: chk.address, amount: v, asset, at: Date.now() })
  return {
    ok: errors.length === 0,
    token: errors.length ? null : token,
    errors,
    check: chk,
    from: a.evm,
    to: chk.address,
    amount: v,
    asset,
    network: { name: 'SCDO Shard0 (EVM)', chainId: ci.chainId, block: ci.block },
    fee: { estFeeWei: str(fee.estFeeWei), maxFeeWei: str(fee.maxFeeWei), gasLimit: str(fee.gasLimit), maxFeePerGas: str(fee.maxFeePerGas) },
    totalEstWei: asset === 'SCDO' ? str(w + fee.estFeeWei) : null,
    totalMaxWei: asset === 'SCDO' ? str(w + fee.maxFeeWei) : null,
    balanceWei: str(bal.nativeWei)
  }
}

// 2.0.2 D-02: one signing+broadcast at a time per from-address
const sendLocks = new Map()
function send (p) {
  const r0 = reviews.get(String((p && p.token) || ''))
  const key = r0 ? r0.from.toLowerCase() : '-'
  const prev = sendLocks.get(key) || Promise.resolve()
  const run = prev.catch(() => {}).then(() => sendNow(p))
  sendLocks.set(key, run.catch(() => {}))
  return run
}
async function sendNow (p) {
  p = p || {}
  const r = reviews.get(String(p.token || ''))
  if (!r) throw new Error('REVIEW_EXPIRED')
  reviews.delete(p.token) // one-time
  if (Date.now() - r.at > REVIEW_TTL_MS) throw new Error('REVIEW_EXPIRED')
  if (typeof p.password !== 'string' || !p.password) throw new Error('NO_PASSWORD')
  const chk = await checkAddress(r.from, r.to, r.asset) // re-check right before signing
  if (!chk.ok || chk.address !== r.to) throw new Error('ADDRESS_CHANGED')
  let priv
  try { priv = await c().decKeyFile(r.file, p.password) } catch (e) { throw new Error('WRONG_PASSWORD') }
  try {
    if (Shard0.addressFromPrivateKey(priv).toLowerCase() !== r.from.toLowerCase()) throw new Error('KEY_MISMATCH')
    return await signAndBroadcast(priv, r)
  } finally { priv = null }
}

// ---------- 2.0.2 rerun (10-04): robust Shard0 sends ----------
// N-1 nonce = max(eth_getTransactionCount(from,'pending'), 1 + highest nonce of this wallet's own still-pending txs that the node
//     still knows; lost ones are re-broadcast first so they never leave a gap). Sends are already serialised per address (send()).
// N-2 retry with a corrected nonce on "nonce too low" / "replacement underpriced"; "already known" = success.
// N-3 every attempt is recorded BEFORE broadcasting (hash is computed locally); any failure is kept in Activity as Failed
//     (status 'error' + code) or, when the outcome is unknown (timeout), as Pending; nothing is silently dropped.
// N-4 pending txs are re-broadcast every minute until mined; after STUCK_AFTER_MS they are flagged "not confirmed yet".
const BCAST_TIMEOUT_MS = 20000
const RPC_TIMEOUT_MS = 15000
const RECEIPT_TIMEOUT_MS = 180000
const STUCK_AFTER_MS = 5 * 60 * 1000
const REBCAST_EVERY_MS = 60 * 1000
const MAX_NONCE_RETRIES = 4
const lastNonce = new Map() // from(lower) -> highest nonce broadcast by this process (local tracked max)
function tmo (p, ms, code) { let t; return Promise.race([p, new Promise((resolve, reject) => { t = setTimeout(() => reject(new Error(code)), ms) })]).finally(() => clearTimeout(t)) }
function classify (m) {
  m = String(m || '')
  if (/already known|ALREADY_EXISTS|known transaction/i.test(m)) return 'KNOWN'
  if (/nonce too low|NONCE_EXPIRED/i.test(m)) return 'NONCE_LOW'
  if (/replacement|underpriced/i.test(m)) return 'NONCE_TAKEN'
  if (/INSUFFICIENT_FUNDS|insufficient funds/i.test(m)) return 'INSUFFICIENT'
  if (/BROADCAST_TIMEOUT|RPC_TIMEOUT/.test(m) || NET_RE.test(m)) return 'NETWORK'
  return 'OTHER'
}
function s0txUpsert (hash, rec) { const l = s0txAll(); const x = l.find(y => y.hash === hash); if (x) Object.assign(x, rec); else l.unshift(Object.assign({ hash }, rec)); writeJson(S0TX_PATH, l.slice(0, 500)) }
function s0txRemove (hash) { writeJson(S0TX_PATH, s0txAll().filter(x => x.hash !== hash)) }
async function nodeKnows (hash) { try { return !!(await tmo(shard0().provider.getTransaction(hash), RPC_TIMEOUT_MS, 'RPC_TIMEOUT')) } catch (e) { return null } }
async function rebroadcast (r) {
  if (!r.raw) return 'NO_RAW'
  try { await shard0().broadcastRaw(r.raw, BCAST_TIMEOUT_MS); s0txUpdate(r.hash, { lastBcast: Date.now(), rebroadcast: (r.rebroadcast || 0) + 1 }); return 'OK' } catch (e) { const k = classify(plainErr(e)); if (k === 'KNOWN') { s0txUpdate(r.hash, { lastBcast: Date.now() }); return 'OK' } return k }
}
async function nextNonce (from) {
  const p = shard0().provider
  const [latest, pending] = await tmo(Promise.all([p.getTransactionCount(from, 'latest'), p.getTransactionCount(from, 'pending')]), RPC_TIMEOUT_MS, 'RPC_TIMEOUT')
  let localNext = 0
  const own = s0txAll().filter(r => r.from && r.from.toLowerCase() === from.toLowerCase() && r.status === 'pending' && Number.isInteger(r.nonce) && r.nonce >= latest).sort((x, y) => x.nonce - y.nonce)
  for (const r of own) {
    let known = await nodeKnows(r.hash)
    if (known === false) known = (await rebroadcast(r)) === 'OK'
    if (known && r.nonce + 1 > localNext) localNext = r.nonce + 1
  }
  const mem = lastNonce.has(from.toLowerCase()) ? lastNonce.get(from.toLowerCase()) + 1 : 0
  // the in-memory max is only used when it does not open a gap (i.e. the node already covers it)
  return Math.max(pending, localNext, mem <= Math.max(pending, localNext) ? mem : 0)
}
async function signAndBroadcast (priv, r) {
  const base = { t: Date.now(), from: r.from, to: r.to, amount: r.amount, asset: r.asset }
  const failRec = (code, hash) => { const h = hash || ('local-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex')); s0txUpsert(h, Object.assign({}, base, { status: 'error', error: code, raw: undefined })); return h }
  let nonce
  try { nonce = await nextNonce(r.from) } catch (e) { const k = classify(plainErr(e)); const code = k === 'NETWORK' ? 'NETWORK' : 'NONCE_READ'; failRec(code); throw new Error(code) }
  let lastCode = null
  for (let attempt = 0; attempt < MAX_NONCE_RETRIES; attempt++) {
    let s
    try { s = await shard0().signWithNonce(priv, r.to, r.amount, r.asset, nonce) } catch (e) {
      const m = plainErr(e); const k = classify(m); const code = k === 'INSUFFICIENT' ? 'INSUFFICIENT' : k === 'NETWORK' ? 'NETWORK' : m.split(' (')[0].slice(0, 200)
      failRec(code); throw new Error(code)
    }
    if (Number(s.tx.chainId) !== S0_CHAIN_ID) { failRec('WRONG_CHAIN'); throw new Error('WRONG_CHAIN') }
    s0txUpsert(s.hash, Object.assign({}, base, { status: 'pending', nonce, raw: s.raw, attempt, lastBcast: Date.now() }))
    try {
      await shard0().broadcastRaw(s.raw, BCAST_TIMEOUT_MS)
      lastNonce.set(r.from.toLowerCase(), Math.max(nonce, lastNonce.get(r.from.toLowerCase()) ?? -1))
      return { ok: true, hash: s.hash, nonce, retries: attempt }
    } catch (e) {
      const k = classify(plainErr(e))
      if (k === 'KNOWN') { lastNonce.set(r.from.toLowerCase(), nonce); return { ok: true, hash: s.hash, nonce, retries: attempt } }
      if (k === 'NONCE_LOW' || k === 'NONCE_TAKEN') {
        s0txRemove(s.hash) // never accepted by the node
        lastCode = 'NONCE_BUSY'
        let pend = nonce + 1
        try { pend = await tmo(shard0().provider.getTransactionCount(r.from, 'pending'), RPC_TIMEOUT_MS, 'RPC_TIMEOUT') } catch (e2) {}
        nonce = Math.max(nonce + 1, pend)
        continue
      }
      if (k === 'NETWORK') {
        // outcome unknown: the node may have the tx. Keep it as Pending; refreshPending re-broadcasts it until it is mined.
        s0txUpdate(s.hash, { bcast: 'unknown' })
        return { ok: false, error: 'BROADCAST_TIMEOUT', hash: s.hash, nonce }
      }
      const code = k === 'INSUFFICIENT' ? 'INSUFFICIENT' : plainErr(e).split(' (')[0].slice(0, 200)
      s0txUpdate(s.hash, { status: 'error', error: code, raw: undefined })
      throw new Error(code)
    }
  }
  failRec(lastCode || 'NONCE_BUSY'); throw new Error(lastCode || 'NONCE_BUSY')
}
// receipts + re-broadcast for every pending tx of this wallet
let refreshing = null
function refreshPendingAll () {
  if (refreshing) return refreshing
  refreshing = (async () => {
    const pend = s0txAll().filter(r => r.status === 'pending').slice(0, 30)
    for (const r of pend) {
      try {
        const rc = await tmo(shard0().provider.getTransactionReceipt(r.hash), RPC_TIMEOUT_MS, 'RPC_TIMEOUT')
        if (rc) { s0txUpdate(r.hash, { status: rc.status === 1 ? 'done' : 'fail', block: rc.blockNumber, stuck: false, raw: undefined }); continue }
        const age = Date.now() - (r.t || 0)
        if (age > STUCK_AFTER_MS && !r.stuck) s0txUpdate(r.hash, { stuck: true })
        if (Date.now() - (r.lastBcast || r.t || 0) > REBCAST_EVERY_MS) {
          const k = await rebroadcast(r)
          if (k === 'NONCE_LOW') {
            // the nonce was used by another tx: if ours has no receipt it was replaced and will never be mined
            const rc2 = await shard0().provider.getTransactionReceipt(r.hash).catch(() => null)
            if (rc2) s0txUpdate(r.hash, { status: rc2.status === 1 ? 'done' : 'fail', block: rc2.blockNumber, raw: undefined })
            else s0txUpdate(r.hash, { status: 'error', error: 'REPLACED', raw: undefined })
          } else if (k === 'INSUFFICIENT') s0txUpdate(r.hash, { status: 'error', error: 'INSUFFICIENT', raw: undefined })
        }
      } catch (e) {}
    }
    return true
  })().finally(() => { refreshing = null })
  return refreshing
}
async function waitReceiptPoll (hash) {
  const t0 = Date.now(); let rebroadcasted = false
  while (Date.now() - t0 < RECEIPT_TIMEOUT_MS) {
    try {
      const rc = await tmo(shard0().provider.getTransactionReceipt(hash), RPC_TIMEOUT_MS, 'RPC_TIMEOUT')
      if (rc) { const ok = rc.status === 1; s0txUpdate(hash, { status: ok ? 'done' : 'fail', block: rc.blockNumber, stuck: false, raw: undefined }); return { ok, block: rc.blockNumber } }
    } catch (e) {}
    if (!rebroadcasted && Date.now() - t0 > 45000) { const r = s0txAll().find(x => x.hash === hash); if (r && r.status === 'pending') await rebroadcast(r); rebroadcasted = true }
    await new Promise(res => setTimeout(res, 3000))
  }
  s0txUpdate(hash, { stuck: true })
  return { ok: false, timeout: true }
}

// ---------- classic shards ----------
function rawUnits (v) {
  try { if (typeof v === 'bigint') return v.toString(); if (typeof v === 'number') return Number.isFinite(v) ? BigInt(Math.trunc(v)).toString() : null; const t = String(v).trim(); return /^\d+$/.test(t) ? BigInt(t).toString() : null } catch (e) { return null }
}
function oldBalance (pubkey, shard) {
  return new Promise(resolve => {
    let done = false
    const t = setTimeout(() => { if (!done) { done = true; resolve(null) } }, 20000)
    try {
      c().getBalance({ pubkey, shard }, (info, err) => {
        if (done) return; done = true; clearTimeout(t)
        resolve(!err && info && info.Balance != null ? rawUnits(info.Balance) : null) // 3.0.4: integer units as a string, no float
      })
    } catch (e) { if (!done) { done = true; clearTimeout(t); resolve(null) } }
  })
}
function oldEstimateGas (from, to) {
  return new Promise(resolve => {
    const t = setTimeout(() => resolve(null), 20000)
    try { c().estimateGas(from, to, '', (info, err) => { clearTimeout(t); resolve(!err && info ? Number(info) : null) }) } catch (e) { clearTimeout(t); resolve(null) }
  })
}
// async re-implementation of scdoClient.sendtx: 2.0.0 used client.sendSync('getAccountNonce'), a synchronous XHR that the
// node 'xmlhttprequest' package emulates by spawning process.argv[0] - in the main process that is the wallet exe itself.
async function oldSend (p) {
  p = p || {}
  const a = accByFile(safeName(p.file)); if (!a) throw new Error('NO_ACCOUNT')
  const to = String(p.to || '').trim()
  if (!CLASSIC_RE.test(to)) throw new Error('BAD_ADDRESS')
  const cl = c()
  if (String(to[0]) !== String(a.shard) && !(cl.config && cl.config.allowCrossShard)) throw new Error('CROSS_SHARD')
  const amount = String(p.amount || '')
  if (!/^\d+(\.\d{1,8})?$/.test(amount) || Number(amount) <= 0) throw new Error('BAD_AMOUNT')
  if (typeof p.password !== 'string' || !p.password) throw new Error('NO_PASSWORD')
  // 2.0.2 D-04 refused sends to the account's own address (a UI safeguard: the bug list flagged "self-send allowed").
  // 3.0.4: the chain processes it like any transfer (go-scdo has no from == to rule; the EVM path subtracts then adds
  // the amount), so the coins stay and only the fee is spent. Allowed on all five chains once the user ticks the box.
  if (to.toLowerCase() === String(a.pubkey).toLowerCase() && p.selfOk !== true) throw new Error('SELF')
  const rpc = cl.client[a.shard]
  const BigNumber = require('bignumber.js')
  const units = BigInt(new BigNumber(amount).times(1e8).integerValue(BigNumber.ROUND_DOWN).toFixed(0))
  if (units <= 0n) throw new Error('BAD_AMOUNT')
  { const bal = await oldBalance(a.pubkey, a.shard); const gas = BigInt(parseInt(p.gas || 21000)) * BigInt(parseInt(p.price || 1)); if (bal != null && units + gas > BigInt(bal)) throw new Error('INSUFFICIENT') } // 2.0.2 D-04: pre-check, was a raw node JSON error
  const nonce = Number(await rpc.send('getAccountNonce', a.pubkey, '', -1)) + 1
  const rawTx = { Type: 0, From: a.pubkey, To: to, Amount: parseInt(new BigNumber(amount).times(1e8).integerValue(BigNumber.ROUND_DOWN).toFixed(0)), AccountNonce: nonce, GasPrice: parseInt(p.price || 1), GasLimit: parseInt(p.gas || 21000), Timestamp: 0, Payload: '' }
  let priv
  try { priv = await cl.decKeyFile(a.filename, p.password) } catch (e) { throw new Error('WRONG_PASSWORD') }
  let tx
  try { tx = rpc.generateTx(priv, rawTx) } finally { priv = null }
  const rec = { t: Date.now(), fa: a.pubkey, fs: cl.getShardNum(a.pubkey), ta: to, ts: cl.getShardNum(to), m: rawTx.Amount, s: tx.Hash, n: nonce, u: 2 }
  await new Promise((resolve, reject) => rpc.addTx(tx, (info, err) => { if (!err) return resolve(info); const m = plainErr(err); reject(new Error(/balance is not enough/i.test(m) ? 'INSUFFICIENT' : (m.match(/"message":"([^"]{1,200})/) || [0, m.slice(0, 200)])[1])) }))
  try { cl.saveRecord(JSON.stringify(rec)) } catch (e) {}
  return { ok: true, hash: tx.Hash }
}

// ---------- accounts ----------
async function create (p) {
  p = p || {}
  const name = String(p.name || '').trim(); const pw = String(p.password || ''); const shard = String(p.shard || '1')
  if (name.length > 40 || /[\\/:*?"<>|\u0000-\u001f]/.test(name)) throw new Error('BAD_NAME')
  if (!/(?=.*[0-9])(?=.*[A-Z])(?=.*[a-z])(?=.*[^a-zA-Z0-9]).{8,15}/.test(pw)) throw new Error('BAD_PASSWORD')
  if (!/^[1-4]$/.test(shard)) throw new Error('BAD_SHARD')
  const cl = c()
  let priv = String(p.priv || '').trim()
  if (priv) { if (/^[0-9a-fA-F]{64}$/.test(priv)) priv = '0x' + priv; priv = priv.toLowerCase(); if (!/^0x[0-9a-f]{64}$/.test(priv)) throw new Error('BAD_KEY') }
  if (!priv) priv = cl.keyTool.generateKeys(shard).privatekey
  else { const addr = cl.getAddressFromPriKey(priv, shard); if (!addr) throw new Error('BAD_KEY'); if (accounts().some(x => x.pubkey === addr)) throw new Error('EXISTS') }
  const file = (name || 'account' + (Number(p.no) || 0)) + '.' + Date.now()
  safeName(file)
  try { await cl.keyStore(file, priv, pw, shard); cl.rememberEvmAddress(file, priv) } finally { priv = null }
  return { ok: true, file }
}
// 2.0.12 匯款: decrypt for a single personal_sign in remitService (main process only, never sent over IPC)
function decryptForRemit (file, pw) { return c().decKeyFile(safeName(file), String(pw || '')) }
async function unlock (file, pw) {
  try { await c().decKeyFile(safeName(file), String(pw || '')); return { ok: true, evm: c().evmAddressOf(file) } } catch (e) { return { ok: false } }
}
async function importKeyfiles (win) {
  const r = await dialog.showOpenDialog(win, { title: 'Import keyfile(s)', properties: ['openFile', 'multiSelections'] })
  if (!r || r.canceled) return { canceled: true, results: [] }
  const cl = c(); const results = []
  for (const src of r.filePaths) {
    const name = path.basename(src)
    const list = accounts()
    const pub = cl.keyfileisvalid(src)
    if (!pub) { results.push({ name, ok: false, code: 'FORMAT' }); continue }
    if (list.some(x => x.filename === name)) { results.push({ name, ok: false, code: 'NAME_EXISTS' }); continue }
    if (list.some(x => x.pubkey === pub)) { results.push({ name, ok: false, code: 'EXISTS' }); continue }
    try { fs.copyFileSync(src, path.join(cl.accountPath, name), fs.constants.COPYFILE_EXCL); results.push({ name, ok: true }) } catch (e) { results.push({ name, ok: false, code: 'COPY', error: e.message }) }
  }
  return { canceled: false, results }
}

// ---------- ui112.json (display state only: names, hidden lists, tab) ----------
function saveUi (ui) {
  if (!ui || typeof ui !== 'object' || Array.isArray(ui)) throw new Error('bad ui state')
  const j = JSON.stringify(ui)
  if (j.length > 256 * 1024) throw new Error('ui state too large')
  writeJson(UI_PATH, JSON.parse(j))
  return true
}

// 2.0.4: UI language. Only 'EN' (English, default) and 'CN' (= 繁體中文 / Traditional Chinese) exist.
// 'CN' stays the stored value so older wallets that share viewconfig_1.1.json keep reading it.
function normLang (v) {
  const s = String(v == null ? '' : v).trim().toUpperCase()
  if (s === 'CN' || s === 'TW' || s === 'ZH' || s.startsWith('ZH-') || s.startsWith('ZH_') || s === 'HK') return 'CN'
  return 'EN'
}
function setLang (v) {
  const l = normLang(v)
  const cl = c()
  let cfg = {}
  try { cfg = JSON.parse(fs.readFileSync(cl.configpath, 'utf8')) || {} } catch (e) { cfg = Object.assign({}, cl.config || {}) }
  cfg.lang = l
  fs.writeFileSync(cl.configpath, JSON.stringify(cfg, null, 2))
  if (cl.config && typeof cl.config === 'object') cl.config.lang = l
  return { ok: true, lang: l }
}

function boot () {
  const cl = c()
  const cfg = cl.config || {}
  // 2.0.4: the saved language is respected (English is the default for new installs). The Chinese UI is
  // Traditional Chinese only; an old saved "CN" (or any zh / TW value) maps to the Traditional strings.
  return {
    config: { lang: normLang(cfg.lang), connect: (cfg.connect || []).slice(0, 5), allowCrossShard: !!cfg.allowCrossShard },
    shard0: { chainId: shard0().cfg.chainId, explorer: shard0().cfg.explorer, tokens: shard0().cfg.tokens.map(t => ({ symbol: t.symbol, address: t.address, decimals: t.decimals })) },
    ui: readJson(UI_PATH, {}),
    accounts: accounts()
  }
}

function register (ipcMain, getWin) {
  const h = (ch, fn) => ipcMain.handle(ch, fn)
  h('wallet:boot', () => boot())
  h('wallet:accounts', () => accounts())
  h('wallet:saveUi', (e, ui) => saveUi(ui))
  h('wallet:setLang', (e, l) => { try { return setLang(l) } catch (err) { return { ok: false, error: err.message } } })
  h('acct:create', (e, p) => create(p).catch(err => ({ ok: false, error: err.message })))
  h('acct:unlock', (e, f, pw) => unlock(f, pw))
  h('acct:import', () => importKeyfiles(getWin()))
  h('s0:chainInfo', async () => { const ci = await shard0().chainInfo(); return { chainId: ci.chainId, block: ci.block } })
  h('s0:balances', async (e, addr) => {
    if (!ADDR_RE.test(String(addr || ''))) throw new Error('bad address')
    const b = await shard0().balances(addr)
    return { nativeWei: str(b.nativeWei), tokens: b.tokens.map(t => ({ symbol: t.symbol, decimals: t.decimals, raw: str(t.raw), balance: t.balance })) }
  })
  h('s0:activity', (e, addr) => s0activity(addr))
  h('s0:refreshPending', () => refreshPendingAll())
  h('s0:waitReceipt', async (e, hash) => {
    if (!/^0x[0-9a-fA-F]{64}$/.test(String(hash || ''))) throw new Error('bad hash')
    return waitReceiptPoll(hash)
  })
  if (!global.__s0PendTimer) global.__s0PendTimer = setInterval(() => { refreshPendingAll().catch(() => {}) }, 30000)
  h('s0:checkAddress', (e, from, to, asset) => checkAddress(from, to, asset))
  h('s0:estimate', (e, from, to, amount, asset) => estimate(from, to, amount, asset).catch(() => null))
  h('s0:review', (e, p) => review(p).catch(err => ({ ok: false, error: netOr(err.message) })))
  h('s0:cancelReview', (e, token) => { reviews.delete(String(token || '')); return true })
  h('s0:send', (e, p) => send(p).catch(err => ({ ok: false, error: err.message })))
  h('old:balance', (e, pubkey, shard) => (CLASSIC_RE.test(String(pubkey || '')) ? oldBalance(pubkey, shard) : null))
  h('old:activity', (e, addr) => oldActivity(addr))
  h('old:records', () => { try { const cl = c(); cl.getRecords(); return (cl.txRecords || []).filter(Boolean).slice(0, 20) } catch (e) { return [] } })
  h('old:estimateGas', (e, from, to) => oldEstimateGas(from, to))
  h('old:send', (e, p) => oldSend(p).catch(err => ({ ok: false, error: err.message })))
}

// 2.0.6: language for main-process dialogs / tray / window titles
function currentLang () { try { return normLang((c().config || {}).lang) } catch (e) { return 'EN' } }
module.exports = { register, checkAddress, parseAmount, currentLang, normalizeHalfWidth, decryptForRemit, _test: { reviews, indexerRow, rawUnits, ADDR_TXS } }
