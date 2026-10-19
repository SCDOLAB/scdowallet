#!/usr/bin/env node
// Sign wallet-ui.json (or any UI JSON document) with an external Ed25519 PEM key.
// The key path must sit outside this repository. The key is never written into the file
// except as the detached signature. wallet-ui.json uses "signature", the same
// field the update feed uses. Pass --field sig for ui-latest.json.
//
//   node tools/sign-ui-config.js --key /path/to/ed25519.pem --in wallet-ui.json --out wallet-ui.json
'use strict'
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { signDoc } = require('../src/config/uiSign')

function arg (name) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : ''
}

function fail (msg) {
  console.error(msg)
  process.exit(1)
}

const keyPath = arg('--key')
const inPath = arg('--in')
const outPath = arg('--out') || inPath
if (!keyPath || !inPath) fail('usage: node tools/sign-ui-config.js --key <pem> --in <json> [--out <json>]')

const root = path.resolve(__dirname, '..')
const resolvedKey = path.resolve(keyPath)
if (resolvedKey === root || resolvedKey.indexOf(root + path.sep) === 0) {
  fail('refusing to sign with a key inside the repository')
}
const pem = fs.readFileSync(resolvedKey, 'utf8')
if (!/PRIVATE KEY/.test(pem)) fail('key file is not a PEM private key')
let privateKey
try { privateKey = crypto.createPrivateKey(pem) } catch (e) { fail('could not read the private key') }
if (privateKey.asymmetricKeyType !== 'ed25519') fail('key must be Ed25519')

const doc = JSON.parse(fs.readFileSync(inPath, 'utf8'))
if (!doc || typeof doc !== 'object' || Array.isArray(doc)) fail('input must be a JSON object')
const field = arg('--field') === 'sig' ? 'sig' : 'signature'
const signed = signDoc(doc, privateKey, field)
fs.writeFileSync(outPath, JSON.stringify(signed, null, 2) + '\n')
console.log('signed ' + outPath)
