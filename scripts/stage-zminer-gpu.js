// Download zminer-gpu 0.1.3 at pack time, check the zip sha256, and unpack
// zminer-gpu.exe, zpowdet.dll and cudart64_12.dll into one folder.
// A mismatch fails the build. npm test does not need the files on disk.
'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const https = require('https')
const http = require('http')
const zlib = require('zlib')
const { spawnSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
const DEST = path.join(ROOT, 'resources', 'miners', 'zminer-gpu')
const ZMINER_GPU_URL = 'https://apeccapital.org/downloads/gpu-miner/zminer-gpu-0.1.3-win64.zip'
const ZMINER_GPU_SHA256 = '6efc25597620e145a6de53aa3c8105d861a7ea44a5f419c7d6bb7a1b5a463a96'
const FILES = ['zminer-gpu.exe', 'zpowdet.dll', 'cudart64_12.dll']

function sha256File (file) {
  const h = crypto.createHash('sha256')
  h.update(fs.readFileSync(file))
  return h.digest('hex')
}

function download (url, dest) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http
    const req = lib.get(url, { headers: { 'user-agent': 'ScdoWallet' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        return resolve(download(res.headers.location, dest))
      }
      if (res.statusCode !== 200) {
        res.resume()
        return reject(new Error('download HTTP ' + res.statusCode + ' for ' + url))
      }
      const out = fs.createWriteStream(dest)
      res.pipe(out)
      out.on('finish', () => out.close(() => resolve(dest)))
      out.on('error', reject)
    })
    req.on('error', reject)
  })
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    t[n] = c >>> 0
  }
  return t
})()

function crc32 (buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function readZipEntries (buf) {
  let eocd = -1
  const min = Math.max(0, buf.length - (0xffff + 22))
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('zip end record not found')
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  const out = []
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('zip directory is damaged')
    const method = buf.readUInt16LE(p + 10)
    const compSize = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localOff = buf.readUInt32LE(p + 42)
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8').replace(/\\/g, '/')
    p += 46 + nameLen + extraLen + commentLen
    if (!name || name.endsWith('/')) continue
    if (buf.readUInt32LE(localOff) !== 0x04034b50) throw new Error('zip local header is damaged')
    const localName = buf.readUInt16LE(localOff + 26)
    const localExtra = buf.readUInt16LE(localOff + 28)
    const dataOff = localOff + 30 + localName + localExtra
    const comp = buf.slice(dataOff, dataOff + compSize)
    let data
    if (method === 0) data = Buffer.from(comp)
    else if (method === 8) data = zlib.inflateRawSync(comp)
    else throw new Error('zip method ' + method + ' is not supported')
    out.push({ name: name, data: data })
  }
  return out
}

function packZip (entries) {
  const parts = []
  const centrals = []
  let offset = 0
  for (const ent of entries) {
    const name = Buffer.from(String(ent.name).replace(/\\/g, '/'), 'utf8')
    const raw = Buffer.isBuffer(ent.data) ? ent.data : Buffer.from(String(ent.data))
    const comp = zlib.deflateRawSync(raw)
    const local = Buffer.alloc(30 + name.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(crc32(raw), 14)
    local.writeUInt32LE(comp.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    name.copy(local, 30)
    parts.push(local, comp)
    const central = Buffer.alloc(46 + name.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(crc32(raw), 16)
    central.writeUInt32LE(comp.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    name.copy(central, 46)
    centrals.push(central)
    offset += local.length + comp.length
  }
  const centralBuf = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat(parts.concat([centralBuf, eocd]))
}

function wantedReady (dest) {
  return FILES.every(n => fs.existsSync(path.join(dest, n)))
}

function placeWanted (dest, entries) {
  const want = new Set(FILES)
  for (const ent of entries) {
    const base = String(ent.name).split('/').pop()
    if (want.has(base)) fs.writeFileSync(path.join(dest, base), ent.data)
  }
}

function flattenWanted (dir, dest) {
  const walk = (d) => {
    for (const name of fs.readdirSync(d)) {
      const p = path.join(d, name)
      if (fs.statSync(p).isDirectory()) walk(p)
      else if (FILES.includes(name)) fs.copyFileSync(p, path.join(dest, name))
    }
  }
  walk(dir)
}

function quotePs (p) {
  return "'" + String(p).replace(/'/g, "''") + "'"
}

function spawnOut (bin, args) {
  return spawnSync(bin, args, { encoding: 'utf8', windowsHide: true })
}

function noteSpawn (bin, result, errors) {
  if (result && result.error && result.error.code === 'ENOENT') return
  const text = result && (result.stderr || result.error && result.error.message) || (bin + ' failed')
  errors.push((bin + ': ' + String(text).trim()).trim())
}

function takeFlattened (sub, dest, errors) {
  try { flattenWanted(sub, dest) } catch (e) { errors.push(e.message || String(e)) }
  try { fs.rmSync(sub, { recursive: true, force: true }) } catch (e) {}
}

// Windows 10+ ships bsdtar as tar.exe, which unpacks zip. GNU tar does not.
function tarCandidates () {
  const list = []
  if (process.platform === 'win32') {
    const root = process.env.SystemRoot || 'C:\\Windows'
    list.push(path.join(root, 'System32', 'tar.exe'))
    list.push('tar.exe')
  }
  list.push('tar')
  return list
}

function unpackExternal (zip, dest, errors) {
  for (const bin of tarCandidates()) {
    if (wantedReady(dest)) return
    const sub = fs.mkdtempSync(path.join(dest, '.unpack-'))
    const tar = spawnOut(bin, ['-xf', zip, '-C', sub])
    if (tar.status === 0) takeFlattened(sub, dest, errors)
    else {
      noteSpawn(bin, tar, errors)
      try { fs.rmSync(sub, { recursive: true, force: true }) } catch (e) {}
    }
  }
  if (wantedReady(dest) || process.platform !== 'win32') return
  const sub = fs.mkdtempSync(path.join(dest, '.unpack-'))
  const ps = spawnOut('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    'Expand-Archive -LiteralPath ' + quotePs(zip) + ' -DestinationPath ' + quotePs(sub) + ' -Force'])
  if (ps.status === 0) takeFlattened(sub, dest, errors)
  else {
    noteSpawn('Expand-Archive', ps, errors)
    try { fs.rmSync(sub, { recursive: true, force: true }) } catch (e) {}
  }
}

function unpack (zip, dest, opts) {
  opts = opts || {}
  fs.mkdirSync(dest, { recursive: true })
  const errors = []
  if (!opts.skipBuiltin) {
    try {
      placeWanted(dest, readZipEntries(fs.readFileSync(zip)))
    } catch (e) { errors.push(e.message || String(e)) }
  }
  if (!wantedReady(dest)) unpackExternal(zip, dest, errors)
  if (!wantedReady(dest)) {
    const names = FILES.concat(FILES.map(n => '*/' + n))
    const unzip = spawnOut('unzip', ['-o', '-j', zip, '-d', dest].concat(names))
    if (unzip.status !== 0) noteSpawn('unzip', unzip, errors)
  }
  if (!wantedReady(dest)) {
    const pyCode = [
      'import zipfile,sys',
      'z=zipfile.ZipFile(sys.argv[1])',
      'want=set(sys.argv[3:])',
      'dest=sys.argv[2]',
      'for info in z.infolist():',
      '    base=info.filename.replace("\\\\","/").split("/")[-1]',
      '    if base in want and not info.is_dir():',
      '        info.filename=base',
      '        z.extract(info, dest)'
    ].join('\n')
    for (const bin of ['python3', 'python']) {
      const py = spawnOut(bin, ['-c', pyCode, zip, dest].concat(FILES))
      if (py.status === 0 && wantedReady(dest)) break
      noteSpawn(bin, py, errors)
    }
  }
  if (!wantedReady(dest)) {
    const err = new Error('could not unpack zminer-gpu zip: ' + errors.filter(Boolean).join(' | '))
    err.code = 'UNPACK_FAILED'
    throw err
  }
}

function staged (dest, want) {
  try {
    const stamp = fs.readFileSync(path.join(dest, 'SHA256SUMS'), 'utf8')
    if (!stamp.toLowerCase().includes(want)) return false
    return FILES.every(n => fs.existsSync(path.join(dest, n)))
  } catch (e) { return false }
}

async function stageZminerGpu (opts) {
  opts = opts || {}
  const want = String(opts.expected || ZMINER_GPU_SHA256).toLowerCase()
  const dest = opts.dest || DEST
  if (!opts.sourceFile && !opts.force && staged(dest, want)) return { dir: dest, sha256: want, cached: true }
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'zminer-gpu-'))
  const zip = path.join(work, 'zminer-gpu.zip')
  if (opts.sourceFile) fs.copyFileSync(opts.sourceFile, zip)
  else await download(opts.url || ZMINER_GPU_URL, zip)
  const got = sha256File(zip)
  if (got !== want) {
    const err = new Error('zminer-gpu zip SHA256 mismatch (got ' + got + ', expected ' + want + ')')
    err.code = 'SHA256_MISMATCH'
    throw err
  }
  unpack(zip, dest, { skipBuiltin: !!opts.skipBuiltin })
  const missing = FILES.filter(n => !fs.existsSync(path.join(dest, n)))
  if (missing.length) {
    const err = new Error('zminer-gpu zip did not contain ' + missing.join(', '))
    err.code = 'MINER_BIN_MISSING'
    throw err
  }
  fs.writeFileSync(path.join(dest, 'SHA256SUMS'), want + '  zminer-gpu-0.1.3-win64.zip\n')
  return { dir: dest, sha256: got, cached: false }
}

module.exports = { stageZminerGpu, ZMINER_GPU_URL, ZMINER_GPU_SHA256, FILES, sha256File, DEST, packZip, readZipEntries }

if (require.main === module) {
  stageZminerGpu().then(r => {
    console.log((r.cached ? 'cached ' : 'staged ') + r.dir)
    console.log(r.sha256 + '  zminer-gpu-0.1.3-win64.zip')
  }).catch(err => {
    console.error(err.message || err)
    process.exit(1)
  })
}
