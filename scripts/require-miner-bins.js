// Windows pack must contain every miner binary the wallet launches.
// These files are gitignored. npm test does not require them on disk.
'use strict'
const fs = require('fs')
const path = require('path')

const WIN32_FILES = ['zminer.exe', 'geth.exe', 'scdo-stratum.exe', 'classic/node.exe']

function referencedMinerFiles (platform) {
  if (platform === 'win32') return WIN32_FILES.slice()
  return []
}

function missingMinerBins (binDir, platform) {
  const missing = []
  for (const rel of referencedMinerFiles(platform)) {
    if (!fs.existsSync(path.join(binDir, ...rel.split('/')))) missing.push(rel)
  }
  if (platform === 'win32') {
    let names = []
    try { names = fs.readdirSync(path.join(binDir, 'classic')) } catch (e) { names = [] }
    if (!names.some(n => /^libcudart.*\.dll$/i.test(n))) missing.push('classic/libcudart.dll')
  }
  return missing
}

function assertMinerBinsPresent (binDir, platform) {
  const missing = missingMinerBins(binDir, platform)
  if (!missing.length) return missing
  const err = new Error('miner bundle is missing ' + missing.join(', ') + ' under ' + binDir)
  err.code = 'MINER_BIN_MISSING'
  err.missing = missing
  throw err
}

module.exports = { referencedMinerFiles, missingMinerBins, assertMinerBinsPresent }
