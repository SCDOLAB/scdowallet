// 3.1.9 Linux is a light AppImage: no miner bundle, no rig UI, signed linux feed, scdowallet:// desktop type.
'use strict'
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const Module = require('module')
const ch = require('../src/main/updateChannel')
const upd = require('../src/updater')
const session = require('../src/main/sessionMode')
const realLoad = Module._load
Module._load = function (req, parent, ...rest) {
  if (req === 'electron') return { Tray: function () {}, Menu: {}, nativeImage: {}, BrowserWindow: {}, screen: {} }
  return realLoad.call(this, req, parent, ...rest)
}
const { menuLines } = require('../src/main/trayStatus')
Module._load = realLoad

const root = path.join(__dirname, '..')
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8')
const pkg = require('../package.json')

assert.strictEqual(pkg.version, '3.1.15')
assert.ok(pkg.scripts['dist:linux'].includes('electron-builder --linux AppImage --x64 --publish never'))
assert.ok(!pkg.scripts['dist:linux'].includes('stage-zminer'))
assert.strictEqual(pkg.build.linux.artifactName, 'SCDOWallet-${version}-linux-x64.${ext}')
assert.strictEqual(pkg.build.linux.target[0].target, 'AppImage')
assert.strictEqual(pkg.build.linux.target[0].arch[0], 'x64')
assert.ok(!(pkg.build.linux.extraResources || []).some(x => String(x.from || '').includes('miner-bin/linux')))
assert.ok((pkg.build.win.extraResources || []).some(x => x.from === 'miner-bin/win32'))
assert.ok(pkg.build.protocols.some(p => (p.schemes || []).includes('scdowallet')))

const yml = read('.github/workflows/linux-appimage.yml')
assert.ok(yml.includes('runs-on: ubuntu-latest'))
assert.ok(yml.includes('npm run dist:linux'))
assert.ok(yml.includes('SCDOWallet-*-linux-x64.AppImage'))
assert.ok(yml.includes('actions/upload-artifact@v4'))
assert.ok(!read('.github/workflows/windows-nsis.yml').includes('dist:linux'))

assert.deepStrictEqual(ch.manifestUrls('stable', 'linux'), ['https://scdo.com.au/downloads/wallet/linux/latest.json'])
assert.deepStrictEqual(ch.manifestUrls('beta', 'linux'), [
  'https://scdo.com.au/downloads/wallet/linux/beta/latest.json',
  'https://scdo.com.au/downloads/wallet/linux/latest.json'
])
assert.deepStrictEqual(ch.manifestUrls('stable', 'win32'), ['https://scdo.com.au/downloads/wallet/latest.json'])
assert.deepStrictEqual(ch.manifestUrls('stable', 'darwin'), ['https://scdo.com.au/downloads/wallet/mac/latest.json'])
assert.strictEqual(ch.installerName('3.1.9', 'linux'), 'SCDOWallet-3.1.9-linux-x64.AppImage')
assert.strictEqual(ch.installerUrl('3.1.9', 'linux'), 'https://scdo.com.au/downloads/wallet/linux/SCDOWallet-3.1.9-linux-x64.AppImage')
assert.strictEqual(ch.installerName('3.1.9', 'win32'), 'SCDOWallet-3.1.9-win-x64-setup.exe')

const linuxManifest = {
  version: '3.1.9',
  url: 'https://scdo.com.au/downloads/wallet/linux/SCDOWallet-3.1.9-linux-x64.AppImage',
  size: 10,
  sha256: 'a'.repeat(64)
}
assert.strictEqual(upd.validateManifest(linuxManifest, null, 'linux'), null)
assert.ok(upd.validateManifest(Object.assign({}, linuxManifest, { url: 'https://scdo.com.au/downloads/wallet/SCDOWallet-3.1.9-win-x64-setup.exe' }), null, 'linux'))
assert.ok(upd.validateManifest(Object.assign({}, linuxManifest, { url: 'http://scdo.com.au/downloads/wallet/linux/SCDOWallet-3.1.9-linux-x64.AppImage' }), null, 'linux'))
assert.ok(upd.validateManifest(Object.assign({}, linuxManifest, { url: 'https://evil.example/SCDOWallet-3.1.9-linux-x64.AppImage' }), null, 'linux'))
assert.strictEqual(upd.validateManifest(Object.assign({}, linuxManifest, { url: 'https://scdo.com.au/downloads/wallet/SCDOWallet-3.1.9-win-x64-setup.exe' }), null, 'win32'), null)
assert.strictEqual(upd.linuxInstallPlan({ APPIMAGE: '/home/me/SCDOWallet.AppImage' }, '/tmp/new.AppImage').mode, 'replace')
assert.strictEqual(upd.linuxInstallPlan({}, '/tmp/new.AppImage').mode, 'open')
assert.strictEqual(upd.linuxInstallPlan({ APPIMAGE: 'relative.AppImage' }, '/tmp/new.AppImage').mode, 'open')
assert.strictEqual(upd.linuxInstallPlan({ APPIMAGE: "/tmp/bad'.AppImage" }, '/tmp/new.AppImage').mode, 'open')

assert.strictEqual(session.linuxLight('linux'), true)
assert.strictEqual(session.linuxLight('win32'), false)
assert.strictEqual(session.linuxLight('darwin'), false)
const main = read('main.js')
assert.ok(main.includes('sessionMode.linuxLight(process.platform) || sessionMode.resolveLight'))
assert.ok(main.includes('if (sessionMode.linuxLight(process.platform))'))
const agent = read('src/agent/agentService.js')
const tick = agent.slice(agent.indexOf('async tick'), agent.indexOf('start ()'))
assert.ok(tick.includes("heartbeatBody({ code: 'ONLINE' }"))

const app = read('src/js/app112.js')
assert.ok(app.includes("function rigUi () { return !api || api.platform !== 'linux' }"))
assert.ok(app.includes('id="homeMineState"'))
assert.ok(app.includes('data-v="mine"'))
const menu = menuLines('CN', { running: true, code: 'MINING', hashrate: 4150068 }, { agentOnline: true }, 'linux')
assert.ok(menu.lines.includes('在線·請保持程式執行'))
assert.ok(menu.lines.includes('結束'))
assert.ok(!menu.lines.some(line => /記帳|恢復記帳|輕量模式/.test(line)))
const macMenu = menuLines('CN', { running: true, code: 'MINING', hashrate: 4150068 }, { agentOnline: true, light: true })
assert.ok(macMenu.lines.includes('記帳中：記帳速度 4.15 MH/s'))

const Join = require('../src/js/agentJoin')
const labels = { agentCardTitle: 'Agent', agentOnlineLine: 'Online', agentOfflineLine: 'Offline', agentStatus: 'Status', agentPending: 'Pending', agentScdoAddr: 'SCDO', agentX402: 'x402', agentBook: 'Bookkeeping', agentStartBook: 'Start bookkeeping', agentEntries: 'Entries', agentEntriesEmpty: 'None', homeLineIdle: 'Idle' }
const t = (k) => labels[k] || k
const hidden = Join.agentCardHtml(t, (s) => s, { hideRig: true, status: 'registered', bookkeeping: 'Idle' })
assert.ok(hidden.includes('agent-presence online'))
assert.ok(!hidden.includes('id="agentBookBtn"'))
assert.ok(!hidden.includes('id="agentBook"'))
const shown = Join.agentCardHtml(t, (s) => s, { status: 'registered', bookkeeping: 'Idle' })
assert.ok(shown.includes('id="agentBookBtn"'))

const helper = read('node_modules/app-builder-lib/out/targets/LinuxTargetHelper.js')
assert.ok(helper.includes('x-scheme-handler/${scheme}'))
assert.ok(helper.includes('packager.config.protocols'))
const mime = []
for (const protocol of pkg.build.protocols) {
  for (const scheme of protocol.schemes || []) mime.push('x-scheme-handler/' + scheme)
}
assert.strictEqual(mime.join(';') + ';', 'x-scheme-handler/scdowallet;')

console.log('linux-build: ok')
