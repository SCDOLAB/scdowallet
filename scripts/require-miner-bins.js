// Windows pack must contain every miner binary the wallet launches.
// These files are gitignored. npm test does not require them on disk.
'use strict'
const fs = require('fs')
const path = require('path')

const WIN32_FILES = [
  'zminer.exe',
  'geth.exe',
  'scdo-stratum.exe',
  'classic/node.exe',
  'zminer-gpu/zminer-gpu.exe',
  'zminer-gpu/zpowdet.dll',
  'zminer-gpu/cudart64_12.dll'
]

function referencedMinerFiles (platform) {
  if (platform === 'win32') return WIN32_FILES.slice()
  return []
}

function missingMinerBins (binDir, platform, gpuDir) {
  const missing = []
  const gpu = gpuDir || path.join(binDir, 'zminer-gpu')
  for (const rel of referencedMinerFiles(platform)) {
    if (rel.startsWith('zminer-gpu/')) {
      if (!fs.existsSync(path.join(gpu, rel.slice('zminer-gpu/'.length)))) missing.push(rel)
      continue
    }
    if (!fs.existsSync(path.join(binDir, ...rel.split('/')))) missing.push(rel)
  }
  if (platform === 'win32') {
    let names = []
    try { names = fs.readdirSync(path.join(binDir, 'classic')) } catch (e) { names = [] }
    if (!names.some(n => /^libcudart.*\.dll$/i.test(n))) missing.push('classic/libcudart.dll')
  }
  return missing
}

// CI_SKIP_MINER_BUNDLE=1 is set only by .github/workflows/windows-nsis.yml.
// GITHUB_ACTIONS alone does not skip: a local or release build stays strict.
function ciSkipsMinerBundle (env) {
  return (env || process.env).CI_SKIP_MINER_BUNDLE === '1'
}

function assertMinerBinsPresent (binDir, platform, gpuDir, env) {
  const missing = missingMinerBins(binDir, platform, gpuDir)
  if (!missing.length) return missing
  if (ciSkipsMinerBundle(env)) {
    console.warn('CI no-miner test build: miner bundle is missing ' + missing.join(', ') + ' under ' + binDir + '. Local release builds still require these files.')
    return missing
  }
  const err = new Error('miner bundle is missing ' + missing.join(', ') + ' under ' + binDir)
  err.code = 'MINER_BIN_MISSING'
  err.missing = missing
  throw err
}

module.exports = { referencedMinerFiles, missingMinerBins, assertMinerBinsPresent, ciSkipsMinerBundle }
