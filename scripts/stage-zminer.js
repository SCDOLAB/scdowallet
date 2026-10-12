// Put the reproducible zminer.exe into miner-bin/win32 for the Windows installer.
// Default source is the public GitHub release asset (no gh login, no env var).
// ZMINER_URL overrides that URL. A matching miner-zpow/dist/zminer.exe or a
// successful local build is used when the download is unavailable. A hash that
// is not the one in miner-zpow/SHA256SUMS is a hard failure. A file already
// sitting in the git-ignored miner-bin directory is never the source.
'use strict'
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const https = require('https')
const http = require('http')
const { spawnSync } = require('child_process')
const { lookupSha } = require('../src/miner/zpow/bins')

const ROOT = path.join(__dirname, '..')
const SUMS = path.join(ROOT, 'miner-zpow', 'SHA256SUMS')
const DIST = path.join(ROOT, 'miner-zpow', 'dist', 'zminer.exe')
const DEST_DIR = path.join(ROOT, 'miner-bin', 'win32')
const DEST = path.join(DEST_DIR, 'zminer.exe')
// Public release asset. The zminer workflow republishes this tag after a
// hash-matching build. Download needs no token.
const DEFAULT_ZMINER_URL = 'https://github.com/SCDOLAB/scdowallet/releases/download/zminer-windows-amd64/zminer.exe'

function sha256File (file) {
  const h = crypto.createHash('sha256')
  h.update(fs.readFileSync(file))
  return h.digest('hex')
}

function expectedHash () {
  const text = fs.readFileSync(SUMS, 'utf8')
  const hash = lookupSha(text, 'zminer.exe')
  if (!hash) {
    const err = new Error('miner-zpow/SHA256SUMS has no zminer.exe line')
    err.code = 'SHA256_MISSING'
    throw err
  }
  return hash
}

function download (url, dest) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http
    const req = lib.get(url, { headers: { 'user-agent': 'ScdoWallet', accept: 'application/octet-stream' } }, res => {
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

function ghAvailable () {
  const r = spawnSync('gh', ['--version'], { encoding: 'utf8' })
  return r.status === 0
}

function findArtifactExe (dir) {
  const direct = path.join(dir, 'zminer.exe')
  if (fs.existsSync(direct)) return direct
  const nested = path.join(dir, 'dist', 'zminer.exe')
  if (fs.existsSync(nested)) return nested
  return null
}

function fetchArtifact (dest) {
  if (!ghAvailable()) return null
  let sha = process.env.ZMINER_COMMIT || ''
  if (!sha) {
    const rev = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' })
    if (rev.status !== 0) return null
    sha = rev.stdout.trim()
  }
  const list = spawnSync('gh', [
    'run', 'list', '--repo', 'SCDOLAB/scdowallet', '--workflow', 'zminer.yml',
    '--commit', sha, '--json', 'databaseId,conclusion', '--limit', '20'
  ], { cwd: ROOT, encoding: 'utf8' })
  if (list.status !== 0) return null
  let runs = []
  try { runs = JSON.parse(list.stdout || '[]') } catch (e) { return null }
  const ok = runs.find(r => r.conclusion === 'success')
  if (!ok) return null
  return downloadRun(ok.databaseId, dest)
}

function downloadRun (id, dest) {
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'zminer-art-'))
  const dl = spawnSync('gh', [
    'run', 'download', String(id), '--repo', 'SCDOLAB/scdowallet',
    '--name', 'zminer-windows-amd64', '--dir', dir
  ], { cwd: ROOT, encoding: 'utf8' })
  if (dl.status !== 0) return null
  const exe = findArtifactExe(dir)
  if (!exe) return null
  fs.copyFileSync(exe, dest)
  return dest
}

// Newest successful zminer-windows-amd64 artifact whose file hash is the
// committed one. Not limited to this commit: a Windows pack of an unrelated
// commit still needs that exact prebuilt exe.
function fetchVerifiedArtifact (dest, want) {
  if (!ghAvailable() || !want) return null
  const list = spawnSync('gh', [
    'run', 'list', '--repo', 'SCDOLAB/scdowallet', '--workflow', 'zminer.yml',
    '--status', 'success', '--json', 'databaseId,conclusion', '--limit', '15'
  ], { cwd: ROOT, encoding: 'utf8' })
  if (list.status !== 0) return null
  let runs = []
  try { runs = JSON.parse(list.stdout || '[]') } catch (e) { return null }
  for (const run of runs) {
    if (!run || run.conclusion && run.conclusion !== 'success') continue
    const got = downloadRun(run.databaseId, dest)
    if (!got) continue
    try {
      if (sha256File(got) === want) return got
    } catch (e) { /* try the next run */ }
  }
  return null
}

function canBuildHere () {
  if (process.env.ZMINER_BUILD === '0') return false
  return process.platform !== 'win32'
}

function missingMessage (want) {
  return 'miner-zpow/dist/zminer.exe is missing and no prebuilt matched sha256 ' + want + '. ' +
    'The default download is ' + DEFAULT_ZMINER_URL + ' (no gh login). ' +
    'scripts/build-zminer.sh only runs on Linux (Go 1.12.7 linux-amd64). ' +
    'Set ZMINER_URL to override that file, or place the verified exe at miner-zpow/dist/zminer.exe. ' +
    'Set ZMINER_SKIP=1 to continue this build without the CPU miner.'
}

function buildLocal () {
  const r = spawnSync('bash', [path.join(ROOT, 'scripts', 'build-zminer.sh')], {
    cwd: ROOT, stdio: 'inherit'
  })
  if (r.status !== 0) {
    const err = new Error('scripts/build-zminer.sh failed')
    err.code = 'BUILD_FAILED'
    throw err
  }
  if (!fs.existsSync(DIST)) {
    const err = new Error('build did not write miner-zpow/dist/zminer.exe')
    err.code = 'BUILD_FAILED'
    throw err
  }
  return DIST
}

async function obtain (work) {
  if (process.env.ZMINER_URL) {
    const dest = path.join(work, 'zminer.exe')
    await download(process.env.ZMINER_URL, dest)
    return dest
  }
  const want = expectedHash()
  if (fs.existsSync(DIST) && sha256File(DIST) === want) return DIST
  if (process.env.ZMINER_FETCH !== '0') {
    const release = path.join(work, 'from-release.exe')
    try {
      await download(DEFAULT_ZMINER_URL, release)
      if (sha256File(release) === want) return release
      console.error('prebuilt ' + DEFAULT_ZMINER_URL + ' sha256 did not match ' + want)
    } catch (e) {
      console.error('prebuilt zminer download failed (' + DEFAULT_ZMINER_URL + '): ' + (e.message || e))
    }
    const dest = path.join(work, 'from-artifact.exe')
    const got = fetchArtifact(dest)
    if (got && sha256File(got) === want) return got
    const any = fetchVerifiedArtifact(path.join(work, 'from-any.exe'), want)
    if (any) return any
  }
  if (!canBuildHere()) {
    const err = new Error(missingMessage(want))
    err.code = 'ZMINER_MISSING'
    throw err
  }
  return buildLocal()
}

function rejectMismatch (file, want) {
  const got = sha256File(file)
  if (got !== want) {
    const err = new Error('zminer.exe SHA256 mismatch (got ' + got + ', committed ' + want + '). The Windows installer will not pack a hand-placed miner-bin file.')
    err.code = 'SHA256_MISMATCH'
    throw err
  }
  return got
}

async function stageZminer () {
  const want = expectedHash()
  const work = fs.mkdtempSync(path.join(require('os').tmpdir(), 'zminer-stage-'))
  let src
  try {
    src = await obtain(work)
  } catch (err) {
    if (process.env.ZMINER_SKIP === '1' && (err.code === 'ZMINER_MISSING' || err.code === 'BUILD_FAILED')) {
      console.error(err.message || err)
      console.error('ZMINER_SKIP=1: continuing without packing zminer.exe')
      return { file: null, sha256: null, skipped: true }
    }
    throw err
  }
  rejectMismatch(src, want)
  fs.mkdirSync(DEST_DIR, { recursive: true })
  const staged = path.join(work, 'staged.exe')
  fs.copyFileSync(src, staged)
  if (sha256File(staged) !== want) {
    const err = new Error('staged zminer.exe changed while copying')
    err.code = 'SHA256_MISMATCH'
    throw err
  }
  fs.copyFileSync(staged, DEST)
  fs.writeFileSync(path.join(DEST_DIR, 'SHA256SUMS'), want + '  zminer.exe\n')
  if (sha256File(DEST) !== want) {
    fs.unlinkSync(DEST)
    const err = new Error('miner-bin/win32/zminer.exe hash changed after copy')
    err.code = 'SHA256_MISMATCH'
    throw err
  }
  return { file: DEST, sha256: want }
}

module.exports = {
  stageZminer, expectedHash, sha256File, rejectMismatch, findArtifactExe,
  canBuildHere, missingMessage, fetchVerifiedArtifact, DEFAULT_ZMINER_URL
}

if (require.main === module) {
  stageZminer().then(r => {
    if (r && r.skipped) {
      console.log('skipped zminer.exe')
      return
    }
    console.log('staged ' + r.file)
    console.log(r.sha256 + '  zminer.exe')
  }).catch(err => {
    console.error(err.message || err)
    process.exit(1)
  })
}
