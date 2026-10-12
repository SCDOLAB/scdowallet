// Backup page: optional 12-word save, no quiz, keys stay put on uninstall.
'use strict'
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const vm = require('vm')
const { HDNodeWallet } = require('ethers')
const mnemonic = require('../src/api/mnemonic')
const card = require('../src/js/backupCard.js')

const root = path.join(__dirname, '..')
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8')

const g = mnemonic.generateAccount()
assert.strictEqual(g.words.length, 12)
assert.strictEqual(g.path, "m/44'/60'/0'/0/0")
assert.strictEqual(HDNodeWallet.fromPhrase(g.phrase, '', g.path).privateKey, g.privateKey)
assert.strictEqual(mnemonic.privateKeyFromPhrase(g.phrase.toUpperCase()), g.privateKey)
assert.ok(mnemonic.isPhrase(g.phrase))
assert.ok(!mnemonic.isPhrase('0x' + 'ab'.repeat(32)))

const day = '2026-10-11'
const reminder = '溫馨提醒：這個檔案就是錢包鑰匙，建議另存一份到離線的地方'
const address = '0x' + 'ab'.repeat(20)
const lines = card.lines({ words: g.words, address, date: day, reminder, dateLabel: '日期', addrLabel: 'Shard0 EVM' })
const text = lines.join('\n')
assert.ok(text.includes(reminder))
assert.ok(text.includes('Shard0 EVM ' + address))
assert.ok(text.includes('日期 ' + day))
g.words.forEach((w, i) => assert.ok(text.includes((i + 1) + '. ' + w)))
assert.strictEqual(mnemonic.saveDefaultPath('/home/me/Documents', 'png', day), path.join('/home/me/Documents', 'ScdoWallet', 'SCDO-backup-' + day + '.png'))
assert.strictEqual(mnemonic.saveDefaultPath('/home/me/Documents', 'txt', day), path.join('/home/me/Documents', 'ScdoWallet', 'SCDO-backup-' + day + '.txt'))

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scdo-phrase-'))
function finish (sealedJson) {
  // The seal is hex, so a short word can appear inside the ciphertext.
  // The phrase contains spaces, and a word counts only as its own token.
  assert.ok(!sealedJson.includes(g.phrase))
  g.words.forEach(w => assert.ok(!new RegExp('\\b' + w + '\\b').test(sealedJson), w))
  return mnemonic.open(sealedJson, 'Aa1!aaaa').then(opened => {
    assert.strictEqual(opened, g.phrase)
    assert.strictEqual(mnemonic.meta(sealedJson).created, day)
    return assert.rejects(() => mnemonic.open(sealedJson, 'nope'), err => err.message === 'WRONG_PASSWORD' && !String(err.message).includes(g.words[0]))
  }).then(() => {
    mnemonic.writeSeal(dir, 'account1.1', sealedJson)
    assert.deepStrictEqual(mnemonic.listPending(dir), ['account1.1'])
    mnemonic.removeSeal(dir, 'account1.1')
    assert.deepStrictEqual(mnemonic.listPending(dir), [])
    fs.rmSync(dir, { recursive: true, force: true })
  })
}

const box = { window: {} }
vm.runInNewContext(read('src/js/i18n112.js'), box)
const CN = box.window.I18N112.CN
const EN = box.window.I18N112.EN
assert.strictEqual(CN.phraseBanner, '溫馨提醒：這個錢包還沒備份助記詞')
assert.strictEqual(CN.phraseFileWarn, reminder)
assert.strictEqual(CN.phraseSavePng, '儲存為圖片')
assert.strictEqual(CN.phraseSaveTxt, '儲存為檔案')
assert.strictEqual(CN.phraseWrote, '我已抄寫')
assert.strictEqual(CN.phraseLater, '稍後備份')
assert.ok(CN.phraseLegacy && EN.phraseLegacy && EN.phraseBanner)
assert.ok(!/[\u4e00-\u9fff]/.test([EN.phraseBanner, EN.phraseFileWarn, EN.phraseSavePng, EN.phraseSaveTxt, EN.phraseWrote, EN.phraseLater, EN.phraseLegacy].join(' ')))

const ui = read('src/js/app112.js')
const page = ui.slice(ui.indexOf('function showBackupPage'), ui.indexOf('function askPhrasePassword'))
for (const id of ['phrasePng', 'phraseTxt', 'phraseWrote', 'phraseLaterBtn']) assert.ok(page.includes('id="' + id + '"'), id)
assert.ok(page.includes("T('phraseFileWarn')") && page.includes("saveBackup('png'") && page.includes("saveBackup('txt'"))
assert.ok(ui.includes('function laterLeave') && ui.includes("setTab('home')"))
assert.ok(ui.includes("data-act=\"phraseOpen\"") && ui.includes('class="home-backup-banner"'))
assert.ok(ui.includes('legacyBackupDismiss') && ui.includes('ui.backupHintSeen = true'))
assert.ok(!ui.includes('phraseQuiz') && !ui.includes('quizOk'))
assert.ok(ui.includes("api.invoke('phrase:save'") && ui.includes("api.invoke('phrase:done'") && ui.includes("api.invoke('phrase:show'"))
const css = read('src/css/shell310.css')
assert.ok(css.includes('.home-backup-banner') && css.includes('#fff4cc') && css.includes('font-size: 13px'))
const ws = read('src/main/walletService.js')
assert.ok(ws.includes('mnemonic.generateAccount') && ws.includes('mnemonic.writeSeal') && ws.includes('saveDefaultPath'))
assert.ok(ws.includes("if (typeof pw !== 'string' || !pw) throw new Error('NO_PASSWORD')"))
assert.ok(!ws.slice(ws.indexOf('async function create'), ws.indexOf('async function showPhrase')).includes('backupKeyfile'))
const main = read('main.js')
assert.ok(main.includes("app.setPath('userData', path.join(app.getPath('appData'), 'ScdoWalletBeta'))"))
assert.ok(main.includes("path.join(os.homedir(), '.ScdoWallet', 'account')"))
assert.ok(main.includes("path.join(app.getPath('documents'), 'ScdoWallet')"))
assert.ok(main.includes('removeSeal'))
const nsh = read('build/installer.nsh')
const pkg = require('../package.json')
assert.strictEqual(pkg.build.nsis.oneClick, false)
assert.strictEqual(pkg.build.nsis.deleteAppDataOnUninstall, false)
assert.ok(!nsh.includes('RMDir') && !nsh.includes('deleteAppData') && !nsh.includes('.ScdoWallet'))
assert.ok(nsh.includes('!macro customUnInstall'))
assert.ok(nsh.includes('Do not delete account files.'))
const preload = read('preload.js')
assert.ok(preload.includes("'phrase:show'") && preload.includes("'phrase:save'") && preload.includes("'phrase:done'"))

mnemonic.seal(g.phrase, 'Aa1!aaaa', { created: day }).then(finish).then(() => {
  console.log('backup-phrase: ok')
}).catch(err => { console.error(err); process.exit(1) })
