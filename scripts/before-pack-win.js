// electron-builder beforePack. Windows builds stage zminer.exe from the
// reproducible build or the CI artifact, then refuse to continue if its
// SHA256 is not miner-zpow/SHA256SUMS, or if any miner binary the wallet
// launches is missing from miner-bin/win32.
'use strict'
const path = require('path')
const { stageZminer } = require('./stage-zminer')
const { assertMinerBinsPresent } = require('./require-miner-bins')

module.exports = async function beforePackWin (context) {
  if (!context || context.electronPlatformName !== 'win32') return
  await stageZminer()
  assertMinerBinsPresent(path.join(__dirname, '..', 'miner-bin', 'win32'), 'win32')
}
