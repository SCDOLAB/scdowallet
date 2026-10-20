// Signed renderer bundle. Desktop only. The zip may replace index.html, CSS, and JS.
// It cannot replace the main process, preload, keys, or signing. The shell checks
// minShellVersion and the sha256 published in ui-latest.json.
'use strict'
const crypto = require('crypto')
const fs = require('fs')
const https = require('https')
const path = require('path')
const zlib = require('zlib')
const { compareVersions } = require('../updater')
const VER_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?$/
const { verifySigned } = require('../config/uiSign')

const HOSTS = ['apeccapital.org', 'scdo.com.au']
const UI_LATEST_URLS = HOSTS.map(h => 'https://' + h + '/wallet/ui-latest.json')
const MAX_ZIP = 32 * 1024 * 1024
const ALLOWED_EXT = {
  '.html': 1, '.css': 1, '.js': 1, '.json': 1, '.svg': 1, '.png': 1, '.jpg': 1,
  '.jpeg': 1, '.webp': 1, '.gif': 1, '.woff': 1, '.woff2': 1, '.txt': 1, '.map': 1
}

function shellCanRun (shell, minShell) {
  return compareVersions(shell, minShell) >= 0
}

function urlAllowed (input) {
  let u
  try { u = new URL(String(input || '')) } catch (e) { return false }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return false
  return HOSTS.indexOf(u.hostname.toLowerCase()) >= 0
}

function acceptLatest (doc, opts) {
  opts = opts || {}
  const verified = verifySigned(doc, { publicKey: opts.publicKey })
  if (!verified.ok) return null
  if (!doc || doc.v !== 1) return null
  if (typeof doc.version !== 'string' || !VER_RE.test(doc.version)) return null
  if (typeof doc.minShellVersion !== 'string' || !VER_RE.test(doc.minShellVersion)) return null
  if (!shellCanRun(opts.shellVersion || '0.0.0', doc.minShellVersion)) return null
  if (typeof doc.url !== 'string' || !urlAllowed(doc.url)) return null
  if (!/\/ui-bundle-[^/]+\.zip$/i.test(new URL(doc.url).pathname)) return null
  if (typeof doc.sha256 !== 'string' || !/^[0-9a-fA-F]{64}$/.test(doc.sha256)) return null
  return {
    v: 1,
    version: doc.version,
    url: new URL(doc.url).href,
    sha256: doc.sha256.toLowerCase(),
    minShellVersion: doc.minShellVersion
  }
}

function sha256 (buf) {
  return crypto.createHash('sha256').update(buf).digest('hex')
}

let CRC_TABLE = null
function crc32 (buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
      CRC_TABLE[n] = c >>> 0
    }
  }
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function u16 (n) { const b = Buffer.alloc(2); b.writeUInt16LE(n & 0xffff, 0); return b }
function u32 (n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0, 0); return b }

function packZip (entries) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(String(entry.name), 'utf8')
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data)
    const method = entry.method === 8 ? 8 : 0
    const payload = method === 8 ? zlib.deflateRawSync(data) : data
    const crc = crc32(data)
    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0), u16(method), u16(0), u16(0),
      u32(crc), u32(payload.length), u32(data.length), u16(name.length), u16(0),
      name, payload
    ])
    const central = Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(method), u16(0), u16(0),
      u32(crc), u32(payload.length), u32(data.length), u16(name.length), u16(0), u16(0),
      u16(0), u16(0), u32(0), u32(offset), name
    ])
    locals.push(local)
    centrals.push(central)
    offset += local.length
  }
  const centralBuf = Buffer.concat(centrals)
  const eocd = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(centralBuf.length), u32(offset), u16(0)
  ])
  return Buffer.concat(locals.concat([centralBuf, eocd]))
}

function safeZipName (name) {
  if (typeof name !== 'string' || !name || name.length > 180) return ''
  if (name.indexOf('\\') >= 0 || name.indexOf('\0') >= 0) return ''
  if (name.charAt(0) === '/' || /^[A-Za-z]:/.test(name)) return ''
  const parts = name.split('/')
  if (name.endsWith('/')) parts.pop()
  if (!parts.length || parts.some(p => !p || p === '.' || p === '..')) return ''
  const ext = path.extname(parts[parts.length - 1]).toLowerCase()
  if (!ALLOWED_EXT[ext]) return ''
  return parts.join('/')
}

function unpackZip (buf, dest) {
  if (!Buffer.isBuffer(buf) || buf.length < 22 || buf.length > MAX_ZIP) throw new Error('bad zip')
  let eocd = -1
  const start = Math.max(0, buf.length - 65557)
  for (let i = buf.length - 22; i >= start; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('bad zip')
  const count = buf.readUInt16LE(eocd + 10)
  const centralOff = buf.readUInt32LE(eocd + 16)
  if (count > 200) throw new Error('too many files')
  const root = path.resolve(dest)
  fs.mkdirSync(root, { recursive: true })
  const files = []
  let pos = centralOff
  let rawTotal = 0
  for (let n = 0; n < count; n++) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== 0x02014b50) throw new Error('bad central directory')
    const flags = buf.readUInt16LE(pos + 8)
    const method = buf.readUInt16LE(pos + 10)
    const crc = buf.readUInt32LE(pos + 16)
    const compSize = buf.readUInt32LE(pos + 20)
    const rawSize = buf.readUInt32LE(pos + 24)
    const nameLen = buf.readUInt16LE(pos + 28)
    const extraLen = buf.readUInt16LE(pos + 30)
    const commentLen = buf.readUInt16LE(pos + 32)
    const localOff = buf.readUInt32LE(pos + 42)
    const name = buf.slice(pos + 46, pos + 46 + nameLen).toString('utf8')
    pos += 46 + nameLen + extraLen + commentLen
    if (flags & 1 || flags & 8) throw new Error('unsupported zip')
    if (name.endsWith('/')) continue
    const clean = safeZipName(name)
    if (!clean) throw new Error('rejected path ' + name.slice(0, 80))
    if (method !== 0 && method !== 8) throw new Error('unsupported method')
    if (localOff + 30 > buf.length || buf.readUInt32LE(localOff) !== 0x04034b50) throw new Error('bad local header')
    const localName = buf.readUInt16LE(localOff + 26)
    const localExtra = buf.readUInt16LE(localOff + 28)
    const dataOff = localOff + 30 + localName + localExtra
    if (dataOff + compSize > buf.length) throw new Error('truncated zip')
    const payload = buf.slice(dataOff, dataOff + compSize)
    const data = method === 8 ? zlib.inflateRawSync(payload) : payload
    if (data.length !== rawSize || crc32(data) !== crc) throw new Error('crc mismatch')
    rawTotal += data.length
    if (rawTotal > MAX_ZIP) throw new Error('zip too large')
    const target = path.resolve(root, clean)
    if (target !== root && target.indexOf(root + path.sep) !== 0) throw new Error('zip slip')
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, data)
    files.push(clean)
  }
  return { files: files }
}

function safeVersionDir (version) {
  const s = String(version || '').replace(/[^0-9A-Za-z._-]/g, '')
  if (!s || s !== version) return ''
  return s
}

function emptyState () {
  return { version: '', crashes: 0, ready: false, dir: '' }
}

function readState (file) {
  try {
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!doc || typeof doc !== 'object') return emptyState()
    return {
      version: typeof doc.version === 'string' ? doc.version : '',
      crashes: Number.isInteger(doc.crashes) && doc.crashes > 0 ? doc.crashes : 0,
      ready: doc.ready === true,
      dir: typeof doc.dir === 'string' ? doc.dir : ''
    }
  } catch (e) { return emptyState() }
}

function writeState (file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(state))
}

function noteCrash (state, reason) {
  const cur = Object.assign(emptyState(), state || {})
  if (!cur.ready || !cur.version) return { state: cur, rollback: false }
  if (reason === 'clean-exit') return { state: cur, rollback: false }
  cur.crashes = (cur.crashes || 0) + 1
  if (cur.crashes >= 2) return { state: emptyState(), rollback: true }
  return { state: cur, rollback: false }
}

function noteLoadFail (state) {
  const cur = Object.assign(emptyState(), state || {})
  if (!cur.ready || !cur.version) return { state: cur, rollback: false }
  return { state: emptyState(), rollback: true }
}

function bundleReady (state) {
  if (!state || !state.ready || !state.dir || (state.crashes || 0) >= 2) return ''
  const index = path.join(state.dir, 'index.html')
  try { if (fs.existsSync(index)) return index } catch (e) {}
  return ''
}

function checkUnpacked (dir, latest) {
  const index = path.join(dir, 'index.html')
  const manifestPath = path.join(dir, 'manifest.json')
  if (!fs.existsSync(index) || !fs.existsSync(manifestPath)) throw new Error('bundle missing index')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  if (!manifest || manifest.version !== latest.version || manifest.minShellVersion !== latest.minShellVersion) {
    throw new Error('bundle manifest mismatch')
  }
}

function download (url, timeoutMs) {
  if (!urlAllowed(url)) return Promise.reject(new Error('url not allowed'))
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs || 60000 }, res => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)) }
      const chunks = []
      let size = 0
      res.on('data', d => {
        size += d.length
        if (size > MAX_ZIP) { req.destroy(new Error('zip too large')); return }
        chunks.push(d)
      })
      res.on('end', () => resolve(Buffer.concat(chunks)))
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
  })
}

async function refresh (opts) {
  opts = opts || {}
  const urls = opts.urls || UI_LATEST_URLS
  const userData = opts.userData
  const stateFile = opts.stateFile || (userData ? path.join(userData, 'ui-bundle-state.json') : '')
  const fsImpl = opts.fs || fs
  let state = stateFile ? readState(stateFile) : emptyState()
  const errors = []
  const fetchImpl = opts.fetchImpl
  const downloadImpl = opts.downloadImpl || download
  if (typeof fetchImpl !== 'function' || !userData) return { state: state, from: '', errors: ['missing fetch'] }
  let latest = null
  let from = ''
  for (let i = 0; i < urls.length; i++) {
    try {
      const body = await fetchImpl(urls[i])
      const doc = typeof body === 'string' ? JSON.parse(body) : body
      const accepted = acceptLatest(doc, { publicKey: opts.publicKey, shellVersion: opts.shellVersion })
      if (accepted) { latest = accepted; from = urls[i]; break }
      errors.push(urls[i] + ': rejected')
    } catch (e) { errors.push(urls[i] + ': ' + ((e && e.message) || e)) }
  }
  if (!latest) return { state: state, from: '', errors: errors }
  if (state.ready && state.version === latest.version && bundleReady(state)) {
    return { state: state, from: from, skipped: true, errors: errors }
  }
  let zip
  try { zip = await downloadImpl(latest.url) } catch (e) {
    errors.push('download: ' + ((e && e.message) || e))
    return { state: state, from: '', errors: errors }
  }
  if (!Buffer.isBuffer(zip)) zip = Buffer.from(zip)
  if (sha256(zip) !== latest.sha256) {
    errors.push('sha256 mismatch')
    return { state: state, from: '', errors: errors }
  }
  const dirName = safeVersionDir(latest.version)
  if (!dirName) { errors.push('bad version'); return { state: state, from: '', errors: errors } }
  const dir = path.join(userData, 'ui-bundles', dirName)
  try {
    fsImpl.rmSync ? fsImpl.rmSync(dir, { recursive: true, force: true }) : fs.rmSync(dir, { recursive: true, force: true })
    unpackZip(zip, dir)
    checkUnpacked(dir, latest)
  } catch (e) {
    errors.push('unpack: ' + ((e && e.message) || e))
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch (err) {}
    return { state: state, from: '', errors: errors }
  }
  state = { version: latest.version, crashes: 0, ready: true, dir: dir }
  if (stateFile) writeState(stateFile, state)
  return { state: state, from: from, errors: errors }
}

module.exports = {
  HOSTS: HOSTS,
  UI_LATEST_URLS: UI_LATEST_URLS,
  MAX_ZIP: MAX_ZIP,
  shellCanRun: shellCanRun,
  urlAllowed: urlAllowed,
  acceptLatest: acceptLatest,
  sha256: sha256,
  packZip: packZip,
  unpackZip: unpackZip,
  safeZipName: safeZipName,
  readState: readState,
  writeState: writeState,
  noteCrash: noteCrash,
  noteLoadFail: noteLoadFail,
  bundleReady: bundleReady,
  download: download,
  refresh: refresh,
  emptyState: emptyState
}
