// electron-builder beforePack. Windows builds stage zminer.exe and the
// zminer-gpu zip (sha256 checked), then refuse to continue if any miner
// binary the wallet launches is missing.
'use strict'
const path = require('path')
const { stageZminer } = require('./stage-zminer')
const { stageZminerGpu } = require('./stage-zminer-gpu')
const { assertMinerBinsPresent } = require('./require-miner-bins')

module.exports = async function beforePackWin (context) {
  if (!context || context.electronPlatformName !== 'win32') return
  const root = path.join(__dirname, '..')
  await stageZminer()
  await stageZminerGpu()
  assertMinerBinsPresent(
    path.join(root, 'miner-bin', 'win32'),
    'win32',
    path.join(root, 'resources', 'miners', 'zminer-gpu')
  )
}
