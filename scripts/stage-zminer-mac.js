// 3.1.5: put the reproducible darwin/amd64 zminer into miner-bin/darwin for the Mac app
// (extraResources -> Contents/Resources/miner/bin). Source is miner-zpow/dist from
// scripts/build-zminer.sh, or ZMINER_DARWIN=/path. The sha256 must match miner-zpow/SHA256SUMS.
// The Mac release signs it with the Developer ID and hardened runtime (build/entitlements.zminer.plist)
// and writes the signed hash into Resources/miner/bin/SHA256SUMS.
'use strict'
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { lookupSha } = require('../src/miner/zpow/bins')
const ROOT = path.join(__dirname, '..')
const NAME = 'zminer-darwin-amd64'
const src = process.env.ZMINER_DARWIN || path.join(ROOT, 'miner-zpow', 'dist', NAME)
const want = lookupSha(fs.readFileSync(path.join(ROOT, 'miner-zpow', 'SHA256SUMS'), 'utf8'), NAME)
if (!fs.existsSync(src)) { console.error(NAME + ' not found at ' + src + '. Run scripts/build-zminer.sh on Linux first.'); process.exit(1) }
const got = crypto.createHash('sha256').update(fs.readFileSync(src)).digest('hex')
if (got !== want) { console.error(NAME + ' sha256 ' + got + ' != miner-zpow/SHA256SUMS ' + want); process.exit(1) }
const dir = path.join(ROOT, 'miner-bin', 'darwin')
fs.mkdirSync(dir, { recursive: true })
fs.copyFileSync(src, path.join(dir, NAME))
fs.chmodSync(path.join(dir, NAME), 0o755)
console.log('staged ' + NAME + ' ' + got)
