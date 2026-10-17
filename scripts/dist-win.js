// NSIS pack used by the Windows workflow. Signs when a certificate secret is present.
// CI_SKIP_MINER_BUNDLE=1 (unsigned-nsis only) names the installer as a no-miner
// test build. Local release builds leave it unset and keep the package.json name.
'use strict'
const path = require('path')
const { spawnSync } = require('child_process')
const { apply } = require('./authenticode')

const NO_MINER_ARTIFACT = 'SCDOWallet-${version}-no-miner-test-win-x64-setup.${ext}'

function nsisBuilderArgs (env) {
  const args = ['--win', 'nsis', '--x64', '--publish', 'never']
  if (env && env.CI_SKIP_MINER_BUNDLE === '1') {
    args.push(
      '-c.nsis.artifactName=' + NO_MINER_ARTIFACT,
      '-c.nsis.shortcutName=SCDO Wallet no-miner test',
      '-c.nsis.uninstallDisplayName=SCDO Wallet ${version} no-miner test'
    )
  }
  return args
}

function main () {
  apply(process.env)
  if (process.env.CI_SKIP_MINER_BUNDLE === '1') {
    console.warn('CI no-miner test build: this installer is not a release and may omit miner binaries that are not in git.')
  }
  const root = path.join(__dirname, '..')
  const cli = path.join(root, 'node_modules', 'electron-builder', 'cli.js')
  const r = spawnSync(process.execPath, [cli].concat(nsisBuilderArgs(process.env)), {
    cwd: root,
    env: process.env,
    stdio: 'inherit'
  })
  process.exit(r.status == null ? 1 : r.status)
}

module.exports = { nsisBuilderArgs, NO_MINER_ARTIFACT }

if (require.main === module) main()
