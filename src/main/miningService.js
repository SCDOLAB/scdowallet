// SCDO Wallet 2.0.1 mining batch 1 (main process): GPU pre-flight, network stats, sanitized log export, pool config.
// Adapted from the batch-1 spec (React/TS hooks) to this codebase: the renderer is plain JS, so the "hooks" are
// main-process IPC handlers plus small renderer modules in src/js/mining/. All IPC goes through the preload allowlist.
'use strict'
const fs = require('fs')
const path = require('path')
const https = require('https')
const { execFile } = require('child_process')
const { isVirtualDisplayName } = require('../miner/gpuSelect')


const REF_RPC = 'https://scdoscan.io/rpc/0'
const MIN_VRAM_GB = 4
const STATS_WINDOW = 120 // blocks

// ---------- GPU pre-flight ----------
function execP (cmd, args, timeout) {
  return new Promise(resolve => execFile(cmd, args, { windowsHide: true, timeout: timeout || 15000 }, (err, out) => resolve(err ? null : String(out))))
}
function nvidiaSmiPath () {
  if (process.platform !== 'win32') return 'nvidia-smi'
  const sys = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'nvidia-smi.exe')
  if (fs.existsSync(sys)) return sys
  const pf = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'NVIDIA Corporation', 'NVSMI', 'nvidia-smi.exe')
  return fs.existsSync(pf) ? pf : 'nvidia-smi'
}
function vendorOf (name) {
  const n = String(name || '').toLowerCase()
  if (/nvidia|geforce|quadro|tesla|rtx|gtx/.test(n)) return 'NVIDIA'
  if (/amd|radeon/.test(n)) return 'AMD'
  if (/intel|iris|uhd|arc/.test(n)) return 'Intel'
  return 'Unknown'
}
// -> { platform, supported, gpus: [{ vendor, deviceName, vramGB, driverVersion, cuda, status: ready|warn|notReady, reasons:[...] }], checkedAt }
async function gpuPreflight (minerGpu) {
  const res = { platform: process.platform, supported: true, gpus: [], checkedAt: new Date().toISOString() }
  if (process.platform === 'darwin') { res.supported = false; return res }
  const cudaDll = process.platform === 'win32' && fs.existsSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'nvcuda.dll'))
  const smi = await execP(nvidiaSmiPath(), ['--query-gpu=name,memory.total,driver_version', '--format=csv,noheader,nounits'], 15000)
  const seen = new Set()
  if (smi) {
    for (const line of smi.split(/\r?\n/).map(l => l.trim()).filter(Boolean)) {
      const [name, mem, drv] = line.split(',').map(x => x.trim())
      seen.add(name)
      res.gpus.push({ vendor: 'NVIDIA', deviceName: name, vramGB: Math.round((Number(mem) || 0) / 1024 * 10) / 10, driverVersion: drv || '', cuda: true })
    }
  }
  if (process.platform === 'win32') {
    const ps = await execP('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name + "|" + $_.AdapterRAM + "|" + $_.DriverVersion }'], 20000)
    for (const line of (ps || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean)) {
      const [name, ram, drv] = line.split('|')
      if (!name || seen.has(name) || /basic display|remote display|virtual/i.test(name) || isVirtualDisplayName(name)) continue
      const v = vendorOf(name)
      // Win32_VideoController.AdapterRAM is a 32-bit field (caps at 4 GB); only used when nvidia-smi gave nothing
      res.gpus.push({ vendor: v, deviceName: name, vramGB: Math.round((Number(ram) || 0) / 1073741824 * 10) / 10, vramApprox: true, driverVersion: drv || '', cuda: v === 'NVIDIA' && cudaDll })
    }
  }
  if (!res.gpus.length && minerGpu && Array.isArray(minerGpu.names)) {
    for (const n of minerGpu.names) if (!isVirtualDisplayName(n)) res.gpus.push({ vendor: vendorOf(n), deviceName: n, vramGB: 0, vramApprox: true, driverVersion: '', cuda: false })
  }
  for (const g of res.gpus) {
    const reasons = []; let status = 'ready'
    if (g.vendor !== 'NVIDIA') { status = 'notReady'; reasons.push('The built-in miner (Rigel) supports NVIDIA GPUs only.') } else {
      if (!g.driverVersion) { status = 'notReady'; reasons.push('NVIDIA driver not detected. Install the NVIDIA graphics driver.') }
      if (!g.cuda) { status = 'notReady'; reasons.push('CUDA runtime (nvcuda.dll / nvidia-smi) not found. Install or repair the NVIDIA driver.') }
      if (g.vramApprox && g.vramGB > 0 && g.vramGB <= 4) { if (status === 'ready') status = 'warn'; reasons.push('VRAM could not be measured exactly (nvidia-smi unavailable).') } else if (g.vramGB > 0 && g.vramGB < MIN_VRAM_GB) { status = 'notReady'; reasons.push('Not enough VRAM: at least ' + MIN_VRAM_GB + ' GB is required, found ' + g.vramGB + ' GB.') }
    }
    if (!reasons.length) reasons.push('All pre-flight checks passed.')
    g.status = status; g.reasons = reasons
  }
  return res
}

// ---------- network stats ----------
function rpc (url, method, params, timeoutMs) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params || [] })
    const u = new URL(url)
    if (u.protocol !== 'https:') return reject(new Error('https only'))
    const req = https.request(u, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }, timeout: timeoutMs || 8000 }, res => {
      let d = ''; res.on('data', ch => { d += ch }); res.on('end', () => { try { const j = JSON.parse(d); j.error ? reject(new Error(j.error.message)) : resolve(j.result) } catch (e) { reject(e) } })
    })
    req.on('timeout', () => req.destroy(new Error('timeout'))); req.on('error', reject); req.end(body)
  })
}
let statsCache = null
// -> { height, difficulty (string), blockTimeSec, networkHashrate (H/s, estimate), localHashrate, sharePercent, window, source, asOf }
async function networkStats (localHashrate) {
  if (!statsCache || Date.now() - statsCache.at > 20000) {
    const tip = await rpc(REF_RPC, 'eth_getBlockByNumber', ['latest', false])
    const h = parseInt(tip.number, 16)
    const n = Math.min(STATS_WINDOW, h)
    const old = await rpc(REF_RPC, 'eth_getBlockByNumber', ['0x' + (h - n).toString(16), false])
    const dt = parseInt(tip.timestamp, 16) - parseInt(old.timestamp, 16)
    const blockTime = n > 0 && dt > 0 ? dt / n : null
    const diff = BigInt(tip.difficulty)
    const hashrate = blockTime ? Number(diff) / blockTime : null
    statsCache = { at: Date.now(), height: h, difficulty: diff.toString(), blockTimeSec: blockTime, networkHashrate: hashrate, window: n, source: 'scdoscan.io RPC (SCDO Shard0)', asOf: new Date().toISOString() }
  }
  const lh = Number(localHashrate) > 0 ? Number(localHashrate) : 0
  const share = statsCache.networkHashrate && lh ? (lh / statsCache.networkHashrate) * 100 : 0
  const { at, ...pub } = statsCache // eslint-disable-line no-unused-vars
  return Object.assign(pub, { localHashrate: lh, sharePercent: share })
}

// ---------- sanitized log export ----------
function maskAddr (a) { return a.slice(0, 6) + '…' + a.slice(-4) }
function sanitizeLog (text, extra) {
  let t = String(text)
  t = t.replace(/\b(0x)?[0-9a-fA-F]{64}\b/g, '[redacted-64hex]') // private keys, tx/block hashes, keystore ciphertext
  t = t.replace(/\b(?:enode:\/\/)[0-9a-fA-F]{128}@/g, 'enode://[redacted]@')
  t = t.replace(/\b0x[0-9a-fA-F]{40}\b/g, m => maskAddr(m))
  t = t.replace(/\b[1-4]S[0-9a-fA-F]{40}\b/g, m => maskAddr(m))
  t = t.replace(/("?(?:password|passphrase|privatekey|private_key|mnemonic|seed|ciphertext|mac|salt|iv)"?\s*[:=]\s*)("[^"]*"|\S+)/gi, '$1[redacted]')
  t = t.replace(/([A-Za-z]:\\Users\\)[^\\\s"']+/gi, '$1<user>').replace(/(\/(?:home|Users)\/)[^/\s"']+/g, '$1<user>')
  for (const s of (extra || [])) if (s && s.length >= 3) t = t.split(s).join('<redacted>')
  return t
}
function tailFile (f, maxBytes) {
  try {
    const st = fs.statSync(f); const len = Math.min(st.size, maxBytes)
    const fd = fs.openSync(f, 'r'); const b = Buffer.alloc(len)
    try { fs.readSync(fd, b, 0, len, st.size - len) } finally { fs.closeSync(fd) }
    return b.toString('utf8')
  } catch (e) { return '' }
}
async function exportLogs (win, miner, appInfo) {
  const logDir = miner ? miner.logDir : null
  const parts = []
  parts.push('SCDO Wallet ' + appInfo.version + ' mining log export (sanitized: keys and hashes removed, addresses shortened, user name removed)')
  parts.push('Exported: ' + new Date().toISOString() + '  Platform: ' + process.platform + ' ' + process.arch)
  if (miner) { const s = miner.status(); parts.push('Miner: mode=' + (s.mode || '-') + ' code=' + s.code + ' running=' + s.running + ' hashrate=' + (s.hashrate || 0) + ' H/s') }
  for (const n of ['wallet-miner.log', 'rigel.log', 'proxy.log', 'geth.log']) {
    const t = logDir ? tailFile(path.join(logDir, n), 512 * 1024) : ''
    if (t) parts.push('\n===== ' + n + ' (last 512 KB) =====\n' + t)
  }
  const os = require('os')
  const text = sanitizeLog(parts.join('\n'), [os.userInfo().username, os.hostname()])
  const def = path.join(require('electron').app.getPath('documents'), 'scdo-wallet-mining-log-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.txt')
  const { dialog } = require('electron')
  const r = await dialog.showSaveDialog(win, { title: 'Export mining logs (sanitized)', defaultPath: def, filters: [{ name: 'Text', extensions: ['txt'] }] })
  if (!r || r.canceled || !r.filePath) return { ok: false, canceled: true }
  fs.writeFileSync(r.filePath, text)
  return { ok: true, file: r.filePath, bytes: Buffer.byteLength(text) }
}

// ---------- 2.0.7 (P2): SCDO pool account (payout progress card + payout notifications) ----------
// Uses the same main-process https client as the network stats (the renderer has no network access: CSP connect-src 'self').
// Only the official SCDO pool publishes a miner API: https://scdoscan.io/pool/api/accounts/<addr> (open-ethereum-pool;
// amounts are in Shannon = 1e-9 SCDO). Only https://scdoscan.io/ URLs are ever fetched here.
const POOL_API = 'https://scdoscan.io/pool/api/accounts/'
const OFFICIAL_POOL_HOSTS = ['82.223.19.88:3333']
const SHANNON = 1000000000n
function httpsGetText (url, timeoutMs, maxBytes) {
  return new Promise((resolve, reject) => {
    let u; try { u = new URL(url) } catch (e) { return reject(new Error('bad url')) }
    if (u.protocol !== 'https:' || u.host !== 'scdoscan.io' || u.username || u.password) return reject(new Error('url not allowed'))
    const req = https.get(u, { headers: { Accept: 'application/json, text/plain' }, timeout: timeoutMs || 10000 }, res => {
      if (res.statusCode !== 200) { res.resume(); const e = new Error('HTTP ' + res.statusCode); e.status = res.statusCode; return reject(e) }
      let n = 0; const chunks = []
      res.on('data', d => { n += d.length; if (n > (maxBytes || 2 * 1024 * 1024)) { req.destroy(new Error('response too large')); return } chunks.push(d) })
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      res.on('error', reject)
    })
    req.on('timeout', () => req.destroy(new Error('timeout'))); req.on('error', reject)
  })
}
function isOfficialPool (poolUrl) {
  const m = /^[a-z0-9+]+:\/\/([^/]+)$/i.exec(String(poolUrl || '').trim())
  return !!m && OFFICIAL_POOL_HOSTS.includes(m[1].toLowerCase())
}
// Shannon (integer, number or string) -> SCDO decimal string, up to 6 decimals, no float rounding
function shannonToScdo (v, dec) {
  let b; try { b = BigInt(String(v == null ? 0 : v).split('.')[0]) } catch (e) { return '0' }
  const neg = b < 0n; if (neg) b = -b
  const whole = b / SHANNON; let frac = (b % SHANNON).toString().padStart(9, '0').slice(0, dec == null ? 6 : dec).replace(/0+$/, '')
  return (neg ? '-' : '') + whole.toString() + (frac ? '.' + frac : '')
}
// pure: pool API JSON -> what the card / notifier need
function parsePoolAccount (j) {
  const s = (j && j.stats) || {}
  const toInt = (x) => { try { return BigInt(String(x == null ? 0 : x).split('.')[0]) } catch (e) { return 0n } }
  const threshold = toInt(j && j.threshold) > 0n ? toInt(j.threshold) : SHANNON
  const balance = toInt(s.balance)
  const p = Array.isArray(j && j.payments) && j.payments.length ? j.payments[0] : null
  const pct = Number((balance * 10000n) / threshold) / 100
  return {
    ok: true, known: true,
    balance: shannonToScdo(balance), immature: shannonToScdo(s.immature), pending: shannonToScdo(s.pending), threshold: shannonToScdo(threshold),
    progressPercent: Math.max(0, Math.min(100, pct)), overThreshold: balance >= threshold,
    lastPayout: p && /^0x[0-9a-fA-F]{64}$/.test(String(p.tx || '')) ? { amount: shannonToScdo(p.amount), timestamp: Number(p.timestamp) || null, tx: p.tx } : null,
    asOf: new Date().toISOString()
  }
}
async function poolAccount (addr, fetchText) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(String(addr || ''))) return { ok: false, error: 'bad address' }
  let txt
  try { txt = await (fetchText || httpsGetText)(POOL_API + String(addr).toLowerCase(), 10000) } catch (e) {
    if (e && e.status === 404) return { ok: true, known: false, asOf: new Date().toISOString() } // the pool has no record of this address yet
    return { ok: false, unreachable: true, error: (e && e.message) || 'unreachable' }
  }
  let j; try { j = JSON.parse(txt) } catch (e) { return { ok: false, unreachable: true, error: 'invalid pool response' } }
  try { return parsePoolAccount(j) } catch (e) { return { ok: false, unreachable: true, error: 'invalid pool response' } }
}

module.exports = { gpuPreflight, networkStats, exportLogs, sanitizeLog, maskAddr, poolAccount, parsePoolAccount, isOfficialPool, shannonToScdo, httpsGetText, POOL_API, OFFICIAL_POOL_HOSTS }
