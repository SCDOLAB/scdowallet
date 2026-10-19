#!/usr/bin/env node
// Pack a renderer-only UI bundle and write a signed ui-latest.json.
// The key path must sit outside this repository.
//
//   node tools/build-ui-bundle.js \
//     --key /path/to/ed25519.pem \
//     --version 3.1.9-ui.1 \
//     --min-shell 3.1.9 \
//     --src ./renderer \
//     --out ./dist-ui \
//     --url https://scdo.com.au/wallet/ui-bundle-3.1.9-ui.1.zip
'use strict'
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { signDoc } = require('../src/config/uiSign')
const { packZip, sha256, safeZipName } = require('../src/main/uiBundle')

function arg (name) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : ''
}
function fail (msg) {
  console.error(msg)
  process.exit(1)
}

const keyPath = arg('--key')
const version = arg('--version')
const minShell = arg('--min-shell')
const src = arg('--src')
const outDir = arg('--out')
if (!keyPath || !version || !minShell || !src || !outDir) {
  fail('usage: node tools/build-ui-bundle.js --key <pem> --version <ver> --min-shell <ver> --src <dir> --out <dir> [--url <https>]')
}
const VER_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?$/
if (!VER_RE.test(version) || !VER_RE.test(minShell)) fail('version and min-shell must look like 3.1.9 or 3.1.9-ui.1')

const root = path.resolve(__dirname, '..')
const resolvedKey = path.resolve(keyPath)
if (resolvedKey === root || resolvedKey.indexOf(root + path.sep) === 0) fail('refusing to sign with a key inside the repository')
const pem = fs.readFileSync(resolvedKey, 'utf8')
if (!/PRIVATE KEY/.test(pem)) fail('key file is not a PEM private key')
const privateKey = crypto.createPrivateKey(pem)
if (privateKey.asymmetricKeyType !== 'ed25519') fail('key must be Ed25519')

const srcRoot = path.resolve(src)
function walk (dir, prefix, out) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'manifest.json') continue
    const abs = path.join(dir, name)
    const rel = prefix ? prefix + '/' + name : name
    const st = fs.statSync(abs)
    if (st.isDirectory()) walk(abs, rel, out)
    else if (st.isFile()) out.push({ name: rel, abs: abs })
  }
}
const found = []
walk(srcRoot, '', found)
if (!found.some(f => f.name === 'index.html')) fail('src must contain index.html')
const entries = []
for (const file of found) {
  if (!safeZipName(file.name)) fail('refusing file ' + file.name)
  entries.push({ name: file.name, data: fs.readFileSync(file.abs) })
}
entries.push({
  name: 'manifest.json',
  data: Buffer.from(JSON.stringify({ version: version, minShellVersion: minShell }))
})
const zip = packZip(entries)
const zipName = 'ui-bundle-' + version + '.zip'
const url = arg('--url') || ('https://scdo.com.au/wallet/' + zipName)
if (!/^https:\/\/(scdo\.com\.au|apeccapital\.org)\/wallet\/ui-bundle-[^/]+\.zip$/.test(url)) {
  fail('url must be https://scdo.com.au or https://apeccapital.org /wallet/ui-bundle-….zip')
}
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, zipName), zip)
const latest = signDoc({
  v: 1,
  version: version,
  url: url,
  sha256: sha256(zip),
  minShellVersion: minShell
}, privateKey)
fs.writeFileSync(path.join(outDir, 'ui-latest.json'), JSON.stringify(latest, null, 2) + '\n')
console.log('wrote ' + path.join(outDir, zipName))
console.log('wrote ' + path.join(outDir, 'ui-latest.json'))
