// Where the Classic miners live. Binaries are not committed (see miner-bin/README.md).
// zminer is built by scripts/build-zminer.sh. The Classic CUDA node is built from
// SCDOLAB/go-scdo when a CUDA toolkit is available; otherwise set SCDO_CLASSIC_NODE.
'use strict'
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

function zminerName (platform) {
  return platform === 'win32' ? 'zminer.exe' : 'zminer-linux-amd64'
}

function nodeName (platform) {
  if (platform === 'win32') return 'node.exe'
  return 'node'
}

// Runtime CUDA library only. libgoGpuDet.a is linked into node.exe; the node
// does not load a DLL named goGpuDet.dll. A copy of libcudart under that name
// is not the GPU kernel.
function cudartNames (platform) {
  if (platform === 'win32') return [/^libcudart.*\.dll$/i]
  if (platform === 'darwin') return [/^libcudart.*\.dylib$/i]
  return [/^libcudart\.so/]
}

function firstExisting (list) {
  for (const p of list) if (p && fs.existsSync(p)) return p
  return null
}

function zminerCandidates (opts) {
  const env = opts.env || {}
  const platform = opts.platform || process.platform
  const list = []
  if (env.SCDO_ZMINER_EXE) list.push(env.SCDO_ZMINER_EXE)
  if (opts.binDir) list.push(path.join(opts.binDir, platform === 'win32' ? 'zminer.exe' : 'zminer'))
  if (opts.root) list.push(path.join(opts.root, 'miner-zpow', 'dist', zminerName(platform)))
  return list
}

function gpuPoolCandidates (opts) {
  const env = opts.env || {}
  const platform = opts.platform || process.platform
  const name = platform === 'win32' ? 'zminer-gpu.exe' : 'zminer-gpu'
  const list = []
  if (env.SCDO_ZPOW_GPU_BIN) list.push(env.SCDO_ZPOW_GPU_BIN)
  if (opts.binDir) {
    list.push(path.join(opts.binDir, name))
    list.push(path.join(opts.binDir, 'classic', name))
  }
  if (opts.root) list.push(path.join(opts.root, 'miner-zpow', 'dist', name))
  return list
}

function classicNodeCandidates (opts) {
  const env = opts.env || {}
  const platform = opts.platform || process.platform
  const name = nodeName(platform)
  const list = []
  if (env.SCDO_CLASSIC_NODE) list.push(env.SCDO_CLASSIC_NODE)
  if (opts.binDir) list.push(path.join(opts.binDir, 'classic', name))
  if (opts.root) list.push(path.join(opts.root, 'miner-zpow', 'dist', 'classic', name))
  return list
}

function findCudart (exe, platform, env) {
  env = env || {}
  const dirs = []
  if (env.SCDO_CUDART_DIR) dirs.push(env.SCDO_CUDART_DIR)
  if (exe) dirs.push(path.dirname(exe))
  const patterns = cudartNames(platform)
  for (const dir of dirs) {
    let names = []
    try { names = fs.readdirSync(dir) } catch (e) { continue }
    const hit = names.find(n => patterns.some(re => re.test(n)))
    if (hit) return path.join(dir, hit)
  }
  return null
}

function lookupSha (sumsText, base) {
  const want = String(base).toLowerCase()
  for (const line of String(sumsText || '').split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64})\s+\*?(\S+)/.exec(line.trim())
    if (m && m[2].toLowerCase() === want) return m[1].toLowerCase()
  }
  return null
}

function sha256File (file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256')
    fs.createReadStream(file).on('data', d => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject)
  })
}

// required: zminer must have a published hash. The Classic node is checked only
// when a hash is configured (sums file next to it, or SCDO_CLASSIC_NODE_SHA256).
async function assertSha256 (file, opts) {
  opts = opts || {}
  const base = path.basename(file)
  let expected = (opts.expected || '').trim().toLowerCase()
  if (!expected && opts.sumsFile && fs.existsSync(opts.sumsFile)) {
    expected = lookupSha(fs.readFileSync(opts.sumsFile, 'utf8'), base) || ''
  }
  if (!expected && opts.sumsText) expected = lookupSha(opts.sumsText, base) || ''
  if (!expected) {
    if (!opts.required) return { ok: true, unchecked: true }
    const err = new Error('no SHA256 published for ' + base + ' (build it with scripts/build-zminer.sh so SHA256SUMS sits beside the binary)')
    err.code = 'SHA256_MISSING'
    throw err
  }
  const got = await sha256File(file)
  if (got !== expected) {
    const err = new Error(base + ' SHA256 mismatch (got ' + got + ')')
    err.code = 'SHA256_MISMATCH'
    throw err
  }
  return { ok: true, sha256: got }
}

function sumsBeside (file) {
  return path.join(path.dirname(file), 'SHA256SUMS')
}

module.exports = {
  zminerName,
  nodeName,
  zminerCandidates,
  classicNodeCandidates,
  gpuPoolCandidates,
  findCudart,
  firstExisting,
  lookupSha,
  sha256File,
  assertSha256,
  sumsBeside
}
