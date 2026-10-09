// electron-builder afterSign. Windows and Linux targets return immediately.
// On macOS the .app is ad-hoc signed (codesign --force --deep -s -) unless
// APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID and CSC_LINK are all set.
// Only then: Developer ID signature, hardened runtime, entitlements, notarization.
'use strict'
const { execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const DEV_ENV = ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID', 'CSC_LINK']
const ENTITLEMENTS = path.join(__dirname, '..', 'build', 'entitlements.mac.plist')

function filled (env, key) {
  return typeof env[key] === 'string' && env[key].trim() !== ''
}
function developerIdReady (env) {
  env = env || process.env
  return DEV_ENV.every(k => filled(env, k))
}
function signPlan (env) {
  if (!developerIdReady(env)) {
    return {
      mode: 'adhoc',
      identity: '-',
      hardenedRuntime: false,
      notarize: false,
      args: ['codesign', '--force', '--deep', '-s', '-']
    }
  }
  return {
    mode: 'developer-id',
    hardenedRuntime: true,
    notarize: true,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist'
  }
}
function macTarget (context) {
  return !!(context && context.electronPlatformName === 'darwin')
}
function appBundle (context) {
  const name = context.packager && context.packager.appInfo && context.packager.appInfo.productFilename
  if (!name || !context.appOutDir) throw new Error('mac afterSign: app path is missing')
  return path.join(context.appOutDir, name + '.app')
}
function adHocSign (appPath) {
  execFileSync('codesign', ['--force', '--deep', '-s', '-', appPath], { stdio: 'inherit' })
}
function materializeP12 (dir, link) {
  const dest = path.join(dir, 'developer-id.p12')
  const trimmed = String(link).trim()
  if (fs.existsSync(trimmed)) {
    fs.copyFileSync(trimmed, dest)
    return dest
  }
  const body = trimmed.replace(/^file:\/\//, '')
  if (body.startsWith('/') && fs.existsSync(body)) {
    fs.copyFileSync(body, dest)
    return dest
  }
  const buf = Buffer.from(trimmed, 'base64')
  if (buf.length < 4) throw new Error('CSC_LINK is not a p12 path or base64 certificate')
  fs.writeFileSync(dest, buf)
  return dest
}
function signDeveloperId (appPath) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scdo-mac-sign-'))
  const keychain = path.join(dir, 'scdo.keychain-db')
  const keychainPass = 'scdo-' + Math.random().toString(36).slice(2)
  const p12Pass = process.env.CSC_KEY_PASSWORD || ''
  try {
    const p12 = materializeP12(dir, process.env.CSC_LINK)
    execFileSync('security', ['create-keychain', '-p', keychainPass, keychain])
    execFileSync('security', ['unlock-keychain', '-p', keychainPass, keychain])
    execFileSync('security', ['set-keychain-settings', '-t', '3600', '-u', keychain])
    const importArgs = ['import', p12, '-k', keychain, '-T', '/usr/bin/codesign', '-T', '/usr/bin/security']
    if (p12Pass) importArgs.push('-P', p12Pass)
    execFileSync('security', importArgs, { stdio: 'inherit' })
    execFileSync('security', ['set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-s', '-k', keychainPass, keychain])
    const ids = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning', keychain], { encoding: 'utf8' })
    const found = ids.match(/"([^"]*Developer ID Application:[^"]*)"/)
    if (!found) throw new Error('CSC_LINK has no Developer ID Application identity')
    execFileSync('codesign', [
      '--force', '--deep', '--options', 'runtime',
      '--entitlements', ENTITLEMENTS,
      '--keychain', keychain,
      '-s', found[1],
      appPath
    ], { stdio: 'inherit' })
  } finally {
    try { execFileSync('security', ['delete-keychain', keychain], { stdio: 'ignore' }) } catch (e) {}
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch (e) {}
  }
}
async function notarizeApp (appPath) {
  const { notarize } = require('@electron/notarize')
  await notarize({
    appPath,
    appleId: process.env.APPLE_ID.trim(),
    appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD.trim(),
    teamId: process.env.APPLE_TEAM_ID.trim()
  })
}
async function macAfterSign (context) {
  if (!macTarget(context)) return { skipped: true, reason: 'not-mac-target' }
  if (process.platform !== 'darwin') return { skipped: true, reason: 'not-macos-host' }
  const appPath = appBundle(context)
  const plan = signPlan(process.env)
  if (plan.mode === 'adhoc') {
    adHocSign(appPath)
    return { skipped: false, plan }
  }
  signDeveloperId(appPath)
  await notarizeApp(appPath)
  return { skipped: false, plan }
}

module.exports = macAfterSign
module.exports.developerIdReady = developerIdReady
module.exports.signPlan = signPlan
module.exports.macTarget = macTarget
module.exports.materializeP12 = materializeP12
