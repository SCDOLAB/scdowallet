// NSIS pack used by the Windows workflow. Signs when a certificate secret is present.
'use strict'
const path = require('path')
const { spawnSync } = require('child_process')
const { apply } = require('./authenticode')

apply(process.env)
const root = path.join(__dirname, '..')
const cli = path.join(root, 'node_modules', 'electron-builder', 'cli.js')
const r = spawnSync(process.execPath, [cli, '--win', 'nsis', '--x64', '--publish', 'never'], {
  cwd: root,
  env: process.env,
  stdio: 'inherit'
})
process.exit(r.status == null ? 1 : r.status)
