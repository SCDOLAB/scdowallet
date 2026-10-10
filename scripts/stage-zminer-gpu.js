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
const { spawnSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
const DEST = path.join(ROOT, 'resources', 'miners', 'zminer-gpu')
const ZMINER_GPU_URL = 'https://scdoscan.io/downloads/gpu-miner/zminer-gpu-0.1.3-win64.zip'
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

function unpack (zip, dest) {
  fs.mkdirSync(dest, { recursive: true })
  const names = FILES.map(n => n).concat(FILES.map(n => '*/' + n))
  const unzip = spawnSync('unzip', ['-o', '-j', zip, '-d', dest].concat(names), { encoding: 'utf8' })
  if (unzip.status === 0 && FILES.every(n => fs.existsSync(path.join(dest, n)))) return
  const py = spawnSync('python3', ['-c', [
    'import zipfile,sys',
    'z=zipfile.ZipFile(sys.argv[1])',
    'want=set(sys.argv[3:])',
    'dest=sys.argv[2]',
    'for info in z.infolist():',
    '    base=info.filename.replace("\\\\","/").split("/")[-1]',
    '    if base in want and not info.is_dir():',
    '        info.filename=base',
    '        z.extract(info, dest)'
  ].join('\n'), zip, dest].concat(FILES), { encoding: 'utf8' })
  if (py.status !== 0) {
    const err = new Error('could not unpack zminer-gpu zip: ' + ((unzip.stderr || py.stderr || '').trim()))
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
  unpack(zip, dest)
  const missing = FILES.filter(n => !fs.existsSync(path.join(dest, n)))
  if (missing.length) {
    const err = new Error('zminer-gpu zip did not contain ' + missing.join(', '))
    err.code = 'MINER_BIN_MISSING'
    throw err
  }
  fs.writeFileSync(path.join(dest, 'SHA256SUMS'), want + '  zminer-gpu-0.1.3-win64.zip\n')
  return { dir: dest, sha256: got, cached: false }
}

module.exports = { stageZminerGpu, ZMINER_GPU_URL, ZMINER_GPU_SHA256, FILES, sha256File, DEST }

if (require.main === module) {
  stageZminerGpu().then(r => {
    console.log((r.cached ? 'cached ' : 'staged ') + r.dir)
    console.log(r.sha256 + '  zminer-gpu-0.1.3-win64.zip')
  }).catch(err => {
    console.error(err.message || err)
    process.exit(1)
  })
}
