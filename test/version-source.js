// The menu, the updater, and About report package.json. A second version is a failed release.
'use strict'
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const Module = require('module')
const { VERSION, checkRuntime } = require('../src/version')
const { plan } = require('../scripts/authenticode')

const root = path.join(__dirname, '..')
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8')
const pkg = require('../package.json')

assert.strictEqual(VERSION, '3.1.14')
assert.strictEqual(VERSION, pkg.version)
assert.deepStrictEqual(checkRuntime(VERSION), { ok: true, version: VERSION, reported: VERSION })
const mismatch = checkRuntime('3.0.10')
assert.strictEqual(mismatch.ok, false)
assert.ok(mismatch.error.includes('3.0.10') && mismatch.error.includes('3.1.14'))

const realLoad = Module._load
Module._load = function (req, parent, ...rest) {
  if (req === 'electron') {
    return {
      Menu: { buildFromTemplate: (t) => t, setApplicationMenu () {} },
      app: { getVersion: () => '3.0.10' },
      shell: {}
    }
  }
  return realLoad.call(this, req, parent, ...rest)
}
const menu = require('../src/js/menu.js')
Module._load = realLoad
const ver = menu.buildTemplate(null, 'CN')[0].submenu.find(s => String(s.label).startsWith('版本'))
assert.strictEqual(ver.label, '版本 ' + VERSION)
assert.ok(!ver.label.includes('3.0.10'))
const about = menu.buildTemplate(null, 'CN').find(m => m.label === '關於')
assert.strictEqual(about.submenu[0].label, '關於這個錢包')
assert.ok(about.submenu.some(s => s.label === '團隊'))

const mainSrc = read('main.js')
assert.ok(mainSrc.includes("require('./src/version')"))
assert.ok(!/displayVersion\s*\|\|\s*app\.getVersion/.test(mainSrc))
assert.ok(mainSrc.includes('currentVersion: VERSION'))
assert.ok(mainSrc.includes('version: VERSION, displayVersion: VERSION'))

const updaterSrc = read('src/updater.js')
assert.ok(updaterSrc.includes("require('./version')"))
assert.ok(!updaterSrc.includes('electron.app.getVersion()'))
assert.ok(updaterSrc.includes('opts.currentVersion || VERSION'))

const infoSrc = read('scripts/build-info.js')
assert.ok(infoSrc.includes('checkRuntime'))
assert.ok(infoSrc.includes('process.exit(1)'))
assert.ok(infoSrc.includes('version: VERSION'))

assert.deepStrictEqual(plan({}), { sign: false, reason: 'no CSC_LINK or WIN_CSC_LINK signing secret' })
assert.strictEqual(plan({ CSC_LINK: '  ' }).sign, false)
const signed = plan({ WIN_CSC_LINK: 'cert-bytes', WIN_CSC_KEY_PASSWORD: 'pw' })
assert.strictEqual(signed.sign, true)
assert.strictEqual(signed.env.CSC_LINK, 'cert-bytes')
assert.strictEqual(signed.env.CSC_KEY_PASSWORD, 'pw')
assert.ok(read('scripts/dist-win.js').includes("require('./authenticode')"))
assert.ok(read('scripts/dist-win.js').includes('Authenticode') || read('scripts/authenticode.js').includes('Authenticode: skipped'))
const { nsisBuilderArgs, NO_MINER_ARTIFACT } = require('../scripts/dist-win')
assert.deepStrictEqual(nsisBuilderArgs({}), ['--win', 'nsis', '--x64', '--publish', 'never'])
assert.deepStrictEqual(nsisBuilderArgs({ GITHUB_ACTIONS: 'true' }), ['--win', 'nsis', '--x64', '--publish', 'never'])
const ciArgs = nsisBuilderArgs({ CI_SKIP_MINER_BUNDLE: '1' })
assert.ok(ciArgs.includes('-c.nsis.artifactName=' + NO_MINER_ARTIFACT))
assert.ok(ciArgs.some(a => a.includes('no-miner test')))
assert.ok(NO_MINER_ARTIFACT.includes('no-miner-test') && NO_MINER_ARTIFACT.endsWith('-win-x64-setup.${ext}'))
const pkgJson = JSON.parse(read('package.json'))
assert.strictEqual(pkgJson.build.nsis.artifactName, 'SCDOWallet-${version}-win-x64-setup.${ext}')
const yml = read('.github/workflows/windows-nsis.yml')
assert.ok(yml.includes('secrets.CSC_LINK') && yml.includes('secrets.WIN_CSC_LINK'))
assert.ok(yml.includes('node scripts/dist-win.js'))
assert.ok(yml.includes("CI_SKIP_MINER_BUNDLE: '1'"))
assert.ok(yml.includes('SCDOWallet-no-miner-test-win-x64-setup'))
assert.strictEqual((yml.match(/CI_SKIP_MINER_BUNDLE/g) || []).length, 1)

const nsh = read('build/installer.nsh')
assert.ok(nsh.includes('oldInstallDir'))
assert.ok(nsh.includes('setInstallModePerUser'))
assert.ok(!nsh.includes('setInstallModePerAllUsers'))
assert.ok(!nsh.includes('StrCpy $INSTDIR $R7'))
assert.ok(nsh.includes('Uninstall SCDO Wallet.exe'))
assert.ok(nsh.includes('!macro customUnInstall'))
assert.ok(nsh.includes('Do not delete account files.'))
assert.ok(!nsh.includes('RMDir') && !nsh.includes('deleteAppData') && !nsh.includes('.ScdoWallet'))
const init = nsh.slice(nsh.indexOf('!macro customInit'), nsh.indexOf('!macro customInstallMode'))
const inst = nsh.slice(nsh.indexOf('!macro customInstall\n'), nsh.indexOf('!macro customUnInstall'))
assert.ok(nsh.includes('QuietUninstallString'), 'detect the HKLM quiet uninstall command')
assert.ok(init.includes("ExecWait '$oldQuietUninstall --updated'"), 'run that command before the new files exist')
assert.ok(init.includes('--updated'), 'old uninstall must keep app data')
assert.ok(init.includes('/allusers'), 'old uninstall must stay on the all-users copy')
assert.ok(init.includes('UAC_RunElevated'))
assert.ok(init.includes('ExecWait'))
assert.ok(!init.includes('!insertmacro customCheckAppRunning'), 'customInit runs before $PowerShellPath exists')
assert.ok(init.includes('scdo-close-wallet.ps1'), 'close the old all-users app with the helper script')
assert.ok(!inst.includes('ExecWait'), 'do not run the old uninstaller after the new install is registered')
assert.ok(inst.includes('${IfNot} ${FileExists} "$appExe"'))
assert.ok(inst.includes('SetErrorLevel 1'))
assert.ok(inst.includes('/SD IDOK'))

console.log('version-source: ok')
