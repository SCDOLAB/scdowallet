// electron-builder beforePack. Windows builds stage zminer.exe from the
// reproducible build or the CI artifact, then refuse to continue if its
// SHA256 is not miner-zpow/SHA256SUMS.
'use strict'
const { stageZminer } = require('./stage-zminer')

module.exports = async function beforePackWin (context) {
  if (!context || context.electronPlatformName !== 'win32') return
  await stageZminer()
}
