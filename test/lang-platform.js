// 3.0.8: first launch is 華語, a saved language is kept, and Mac-only settings lines
// follow window.scdo.platform. Windows wording stays byte-identical.
'use strict'
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const { execFileSync } = require('child_process')
const { normLang, menuLang } = require('../src/js/uiLang')
const { copyText, MAC_BACKUP_DISPLAY } = require('../src/js/platformCopy')
const macAfterSign = require('../scripts/mac-after-sign')
const { signPlan, macTarget } = macAfterSign

const root = path.join(__dirname, '..')
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8')

const WIN_CN_BACKUP = '把帳戶檔案複製到「文件\\ScdoWallet\\備份」。帳戶檔案和密碼一起才能恢復帳戶，請另外再存一份到隨身碟。'
const WIN_EN_BACKUP = 'Copies keyfiles to the backup folder below (inside Documents\\ScdoWallet). A keyfile plus its password restores the account; keep another copy on a USB stick.'
const WIN_CN_NOTIFY = '在 Windows 通知中心顯示；同一種通知 10 分鐘內最多一則。點按鈕可以開啟或關閉。'
const WIN_EN_NOTIFY = 'Shown in the Windows notification centre; at most one of each kind per 10 minutes. Click to turn one on or off.'

// ---- (1) language: unset is CN, a saved choice is kept, menu matches ----
for (const v of [undefined, null, '', '   ', 'zh-TW', 'zh-Hant', 'TW', 'CN', 'zh_HK', 'fr', 'ja']) {
  assert.strictEqual(normLang(v), 'CN', 'unset or non-English ' + JSON.stringify(v))
  assert.strictEqual(menuLang(v), 'CN', 'menu ' + JSON.stringify(v))
}
for (const v of ['EN', 'en', 'en-US', 'en_GB', ' EN ']) {
  assert.strictEqual(normLang(v), 'EN', 'saved English ' + JSON.stringify(v))
  assert.strictEqual(menuLang(v), 'EN')
}
const uiLangSrc = read('src/js/uiLang.js')
assert.ok(!/getLocale|navigator|process\.platform|app\.getLocale/.test(uiLangSrc), 'language default must not read the operating system')
assert.strictEqual(JSON.parse(read('src/json/viewconfig_1.1.json')).lang, 'CN')
assert.ok(read('src/api/scdoClient.js').includes('cfg.lang = "CN"'))
assert.ok(!read('src/api/scdoClient.js').includes('cfg.lang = "EN"'))
assert.ok(read('src/js/app112.js').includes('api.platform'))
assert.ok(read('src/js/app112.js').includes('window.SCDOUiLang'))
assert.ok(read('src/js/boot.js').includes("info.lang === 'EN' ? 'EN' : 'CN'"))
assert.ok(read('main.js').includes("walletService.currentLang() === 'EN' ? 'EN' : 'CN'"))
assert.ok(read('translations/i18n.js').includes("settings && settings.lang ? String(settings.lang) : 'CN'"))
assert.ok(!/getLocale\s*\(/.test(read('translations/i18n.js')))
assert.ok(read('index.html').includes('lang="zh-Hant-TW"'))
assert.ok(read('preload.js').includes('platform: process.platform'))

const Module = require('module')
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
const cnMenu = menu.buildTemplate(null, undefined)
const enMenu = menu.buildTemplate(null, 'EN')
assert.strictEqual(cnMenu[0].label, 'SCDO 錢包', 'first launch menu is 華語繁體')
assert.deepStrictEqual(cnMenu.slice(2, 8).map(m => m.label), ['首頁', 'GPU 共享', '錢包', '遊戲', '區塊鏈', '運算服務'])
assert.strictEqual(cnMenu.find(m => m.label === '錢包').submenu.map(s => s.label).join('|'), '收款|匯款…|設定|建立新地址（Shard0–Shard4 任選）…|匯入錢包（帳戶檔案或私鑰）…')
assert.strictEqual(cnMenu.find(m => m.label === '運算服務').submenu[0].label, '運算服務')
assert.strictEqual(enMenu[0].label, 'SCDO Wallet', 'saved English menu stays English')
assert.deepStrictEqual(enMenu.slice(2, 8).map(m => m.label), ['Home', 'GPU share', 'Wallet', 'Games', 'Blockchain', 'Mining'])
assert.strictEqual(enMenu.find(m => m.label === 'Mining').submenu[0].label, 'Mining')
assert.strictEqual(menu.buildTemplate(null, 'zh-Hant-TW')[7].label, '運算服務')
const flat = (t) => t.flatMap(m => [m.label].concat((m.submenu || []).flatMap(s => [s.label].concat((s.submenu || []).map(x => x.label))).filter(Boolean)))
assert.ok(!flat(cnMenu).includes('開始挖礦') && !flat(cnMenu).includes('停止挖礦…') && !flat(cnMenu).includes('轉帳…'))
assert.ok(flat(cnMenu).includes('匯款…') && flat(cnMenu).includes('收款') && flat(cnMenu).includes('設定'))
assert.ok(!flat(cnMenu).includes('挖礦'))
menu.createMenu({ isDestroyed: () => false }, undefined)
assert.strictEqual(menu.buildTemplate(null, 'EN').find(m => m.label === 'Wallet').submenu[2].label, 'Settings')
assert.strictEqual(menu.buildTemplate(null, 'CN').find(m => m.label === '錢包').submenu[2].label, '設定')

// ---- (2) platform strings: Windows bytes unchanged, Mac path and notification centre ----
const box = { window: {} }
vm.runInNewContext(read('src/js/i18n112.js'), box)
const I = box.window.I18N112
assert.strictEqual(I.CN.backupHint, WIN_CN_BACKUP)
assert.strictEqual(I.EN.backupHint, WIN_EN_BACKUP)
assert.strictEqual(I.CN.notifyHint, WIN_CN_NOTIFY)
assert.strictEqual(I.EN.notifyHint, WIN_EN_NOTIFY)
for (const platform of ['win32', 'linux', '', undefined]) {
  assert.strictEqual(copyText(I.CN, 'backupHint', platform), WIN_CN_BACKUP, 'CN backup ' + platform)
  assert.strictEqual(copyText(I.EN, 'backupHint', platform), WIN_EN_BACKUP, 'EN backup ' + platform)
  assert.strictEqual(copyText(I.CN, 'notifyHint', platform), WIN_CN_NOTIFY, 'CN notify ' + platform)
  assert.strictEqual(copyText(I.EN, 'notifyHint', platform), WIN_EN_NOTIFY, 'EN notify ' + platform)
}
const cnBack = copyText(I.CN, 'backupHint', 'darwin')
const enBack = copyText(I.EN, 'backupHint', 'darwin')
assert.ok(cnBack.includes(MAC_BACKUP_DISPLAY) && cnBack.includes('~/Documents/ScdoWallet'))
assert.ok(!cnBack.includes('文件\\ScdoWallet'))
assert.ok(enBack.includes('~/Documents/ScdoWallet') && !enBack.includes('Documents\\\\ScdoWallet') && !enBack.includes('Documents\\ScdoWallet'))
const cnNote = copyText(I.CN, 'notifyHint', 'darwin')
const enNote = copyText(I.EN, 'notifyHint', 'darwin')
assert.ok(cnNote.startsWith('在 Mac 通知中心顯示'))
assert.ok(!cnNote.includes('Windows'))
assert.ok(enNote.startsWith('Shown in macOS Notification Centre'))
assert.ok(!enNote.includes('Windows'))
assert.strictEqual(cnNote.slice('在 Mac 通知中心顯示'.length), WIN_CN_NOTIFY.slice('在 Windows 通知中心顯示'.length))
assert.strictEqual(enNote.slice('Shown in macOS Notification Centre'.length), WIN_EN_NOTIFY.slice('Shown in the Windows notification centre'.length))
assert.strictEqual(I.CN.relNotes[0].v, '3.1.0')
assert.strictEqual(I.EN.relNotes[0].v, '3.1.0')
assert.ok(I.CN.relNotes[0].items.join(' ').includes('顯卡正被其他程式使用'))
assert.ok(I.CN.relNotes.find(n => n.v === '3.0.8').items.join(' ').includes('華語繁體'))
assert.ok(!I.CN.relNotes.find(n => n.v === '3.0.8').items.join(' ').includes('繁體中文'))
assert.ok(!/[\u4e00-\u9fff]/.test(I.EN.relNotes[0].items.join(' ')))
assert.ok(read('src/js/app112.js').includes('T(\'backupHint\')') && read('src/js/app112.js').includes('T(\'notifyHint\')'))

// version and Windows build left as they were, plus the Mac signing gate
const pkg = require('../package.json')
assert.strictEqual(pkg.version, '3.1.0')
const lock = JSON.parse(read('package-lock.json'))
assert.strictEqual(lock.version, '3.1.0')
assert.strictEqual(lock.packages[''].version, '3.1.0')
const base = JSON.parse(execFileSync('git', ['show', 'c8049bb:package.json'], { encoding: 'utf8' }))
assert.deepStrictEqual(pkg.build.win, base.build.win)
assert.deepStrictEqual(pkg.build.nsis, base.build.nsis)
assert.deepStrictEqual(pkg.build.portable, base.build.portable)
assert.strictEqual(pkg.build.beforePack, base.build.beforePack)
assert.strictEqual(pkg.scripts['dist:win'], base.scripts['dist:win'])
assert.strictEqual(pkg.build.mac.identity, '-')
assert.strictEqual(pkg.build.mac.hardenedRuntime, true)
assert.strictEqual(pkg.build.mac.notarize, false)
assert.strictEqual(pkg.build.mac.entitlements, 'build/entitlements.mac.plist')
assert.strictEqual(pkg.build.mac.entitlementsInherit, 'build/entitlements.mac.plist')
assert.strictEqual(pkg.build.afterSign, 'scripts/mac-after-sign.js')
const ent = read('build/entitlements.mac.plist')
assert.ok(ent.includes('com.apple.security.cs.allow-jit'))
assert.ok(ent.includes('com.apple.security.cs.allow-unsigned-executable-memory'))
assert.ok(fs.existsSync(path.join(root, 'doc/mac-signing.md')))

assert.deepStrictEqual(signPlan({}), { mode: 'adhoc', identity: '-', hardenedRuntime: false, notarize: false, args: ['codesign', '--force', '--deep', '-s', '-'] })
assert.strictEqual(signPlan({ APPLE_ID: 'a@b.c', APPLE_APP_SPECIFIC_PASSWORD: 'x', APPLE_TEAM_ID: 'T', CSC_LINK: '' }).mode, 'adhoc')
assert.strictEqual(signPlan({ APPLE_ID: 'a@b.c', APPLE_APP_SPECIFIC_PASSWORD: 'x', APPLE_TEAM_ID: 'T' }).mode, 'adhoc')
const full = signPlan({ APPLE_ID: 'a@b.c', APPLE_APP_SPECIFIC_PASSWORD: 'x', APPLE_TEAM_ID: 'TEAMID', CSC_LINK: 'aabb' })
assert.strictEqual(full.mode, 'developer-id')
assert.strictEqual(full.hardenedRuntime, true)
assert.strictEqual(full.notarize, true)
assert.strictEqual(macTarget({ electronPlatformName: 'win32' }), false)
assert.strictEqual(macTarget({ electronPlatformName: 'darwin' }), true)
macAfterSign({ electronPlatformName: 'win32' }).then(r => {
  assert.deepStrictEqual(r, { skipped: true, reason: 'not-mac-target' })
  return macAfterSign({ electronPlatformName: 'darwin' })
}).then(r => {
  assert.strictEqual(r.skipped, true)
  assert.strictEqual(r.reason, 'not-macos-host')
  console.log('lang-platform: ok')
}).catch(err => { console.error(err); process.exit(1) })
