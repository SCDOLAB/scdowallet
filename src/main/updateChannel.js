// SCDO Wallet 2.0.7 (P3, mining department): stable / beta update channel + installer SHA-256 in About.
// Based on 豆包's updateChannel.js; adapted to this codebase:
//  - the channel is kept in the wallet's existing main-process settings file (miner-intent.json via main.js settingsStore),
//    key "updateChannel"; default "stable"
//  - the manifests are the wallet's real update manifests on scdoscan.io (same host, same Ed25519 key as 2.0.5/2.0.6):
//      stable  https://scdo.com.au/downloads/wallet/latest.json        (unchanged; what every 2.0.x has always read)
//      beta    https://scdo.com.au/downloads/wallet/beta/latest.json   (sibling folder; beta users also read stable and
//                                                                       get whichever verified manifest is newer)
//  - every installer on the download page has a sha256sum-format file next to it: <installer>.sha256
//      https://scdo.com.au/downloads/wallet/SCDOWallet-<v>-win-x64-setup.exe.sha256   (beta builds: .../wallet/beta/...)
//  - the channel only picks between these two built-in URLs; nothing else about the updater can be changed at run time,
//    and every manifest still has to pass the same signature + field checks (src/updater.js)
'use strict'
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const STORE_KEY = 'updateChannel'
const DEFAULT_CHANNEL = 'stable'
const CHANNELS = Object.freeze(['stable', 'beta'])
const DOWNLOAD_BASE = 'https://scdo.com.au/downloads/wallet/'
const MANIFEST_URLS = Object.freeze({
  stable: DOWNLOAD_BASE + 'latest.json',
  beta: DOWNLOAD_BASE + 'beta/latest.json'
})

function getChannel (store) {
  let v = null
  try { v = store.get(STORE_KEY, DEFAULT_CHANNEL) } catch (e) {}
  return CHANNELS.includes(v) ? v : DEFAULT_CHANNEL
}
function setChannel (store, ch) {
  if (!CHANNELS.includes(ch)) return { ok: false, error: 'unknown channel', channel: getChannel(store) }
  store.set(STORE_KEY, ch)
  return { ok: true, channel: ch }
}
// manifests to read, in order. beta reads its own manifest first, then stable (the newer verified one wins).
// 3.1.5: macOS reads its own feed, so a Mac never gets offered the Windows installer.
const MAC_DOWNLOAD_BASE = 'https://scdo.com.au/downloads/wallet/'
const MAC_MANIFEST_URLS = Object.freeze({
  stable: MAC_DOWNLOAD_BASE + 'mac/latest.json',
  beta: MAC_DOWNLOAD_BASE + 'mac/beta/latest.json'
})
const LINUX_MANIFEST_URLS = Object.freeze({
  stable: DOWNLOAD_BASE + 'linux/latest.json',
  beta: DOWNLOAD_BASE + 'linux/beta/latest.json'
})
function manifestUrls (ch, platform) {
  const plat = platform || process.platform
  const u = plat === 'darwin' ? MAC_MANIFEST_URLS : plat === 'linux' ? LINUX_MANIFEST_URLS : MANIFEST_URLS
  return ch === 'beta' ? [u.beta, u.stable] : [u.stable]
}

const isPre = (v) => /-/.test(String(v || ''))
function installerName (version, platform) {
  const v = path.basename(String(version))
  if (platform === 'darwin') return 'SCDOWallet-' + v + '-mac-arm64.dmg'
  if (platform === 'linux') return 'SCDOWallet-' + v + '-linux-x64.AppImage'
  return 'SCDOWallet-' + v + '-win-x64-setup.exe'
}
function installerUrl (version, platform) {
  const pre = isPre(version) ? 'beta/' : ''
  if (platform === 'linux') return DOWNLOAD_BASE + 'linux/' + pre + installerName(version, platform)
  return (platform === 'darwin' ? MAC_DOWNLOAD_BASE : DOWNLOAD_BASE) + pre + installerName(version, platform)
}
function sha256Url (version, platform) { return installerUrl(version, platform) + '.sha256' }
// sha256sum format: "<64 hex>  <file name>" (one line per file; the line for our file wins, else the first hash)
function parseSha256File (text, fileName) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  let first = null
  for (const l of lines) {
    const m = /^([0-9a-fA-F]{64})(?:\s+\*?(.+))?$/.exec(l)
    if (!m) continue
    if (!first) first = m[1].toLowerCase()
    if (fileName && m[2] && path.basename(m[2].trim()) === fileName) return m[1].toLowerCase()
  }
  return first
}
function sha256Line (hash, fileName) { return hash.toLowerCase() + '  ' + fileName + '\n' }
function sha256FileSync (f) { return crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex') }

// SHA-256 of the installer of the running version, for Settings > About. Best source first:
//   installer  the installer the in-app updater downloaded and verified (<userData>/updates/<installer>)
//   manifest   the signed update manifest, when it describes this version
//   published  the <installer>.sha256 file on the download page
// opts: { version, platform, userData, manifest (last verified manifest or null), fetchText(url) -> Promise<string> }
async function buildHashInfo (opts) {
  const file = installerName(opts.version, opts.platform)
  const out = { version: opts.version, file, sha256: null, source: null, verifyUrl: sha256Url(opts.version, opts.platform), downloadUrl: installerUrl(opts.version, opts.platform) }
  try {
    const local = path.join(opts.userData, 'updates', file)
    if (opts.platform !== 'darwin' && fs.existsSync(local)) { out.sha256 = sha256FileSync(local); out.source = 'installer'; return out }
  } catch (e) {}
  const m = opts.manifest
  if (m && m.version === opts.version && /^[0-9a-fA-F]{64}$/.test(m.sha256 || '') && opts.platform !== 'darwin') { out.sha256 = m.sha256.toLowerCase(); out.source = 'manifest'; return out }
  if (opts.fetchText) {
    try { const h = parseSha256File(await opts.fetchText(out.verifyUrl), file); if (h) { out.sha256 = h; out.source = 'published' } } catch (e) { out.error = e.message }
  }
  return out
}

module.exports = { STORE_KEY, DEFAULT_CHANNEL, CHANNELS, DOWNLOAD_BASE, MANIFEST_URLS, MAC_MANIFEST_URLS, LINUX_MANIFEST_URLS, getChannel, setChannel, manifestUrls, installerName, installerUrl, sha256Url, parseSha256File, sha256Line, buildHashInfo }
