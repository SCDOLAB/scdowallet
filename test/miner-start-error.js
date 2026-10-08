// Every main-chain miner failure code has a zh-Hant sentence, and that sentence
// does not include the raw English from manager.js.
'use strict'
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const err = require('../src/js/minerStartError')

const src = fs.readFileSync(path.join(__dirname, '../src/miner/manager.js'), 'utf8')

function managerErrorCodes (text) {
  const codes = new Set()
  for (const m of text.matchAll(/(?:err|e)\.code = '([A-Z0-9_]+)'/g)) codes.add(m[1])
  for (const m of text.matchAll(/phase: 'error', code: '([A-Z0-9_]+)'/g)) codes.add(m[1])
  for (const m of text.matchAll(/\{ code: '([A-Z0-9_]+)' \}/g)) codes.add(m[1])
  if (text.includes("|| 'ERROR'")) codes.add('ERROR')
  if (text.includes("code: 'EXTERNAL_DOWN'")) codes.add('EXTERNAL_DOWN')
  return [...codes].sort()
}

const codes = managerErrorCodes(src)
assert.deepStrictEqual(codes, ['BAD_PAYOUT', 'BAD_POOL', 'CRASHING', 'DEFENDER', 'ERROR', 'EXTERNAL_DOWN', 'NO_NVIDIA', 'PORTS'])

const raw = {
  DEFENDER: 'DEFENDER: rigel.exe disappeared after extraction – Windows Defender most likely quarantined it (all GPU miners are flagged as "potentially unwanted"). Click "Allow miner in Windows Defender" and start again.',
  PORTS: 'no free local ports for the SCDO node (18545+ are all in use)',
  NO_NVIDIA: 'No NVIDIA GPU found on this PC – GPU mining is not possible. Use "Run node only".',
  BAD_POOL: 'invalid pool address – use stratum+tcp://host:port (also stratum+ssl, ethproxy+tcp, ethstratum+tcp)',
  BAD_PAYOUT: 'invalid node service fee address 0xabc',
  CRASHING: 'rigel keeps crashing – stopped. See the log below.',
  EXTERNAL_DOWN: 'The other SCDO node on this PC is not answering (timeout).',
  ERROR: 'missing /opt/geth'
}
for (const code of codes) {
  const cn = err.full('CN', code, raw[code] || '')
  assert.ok(cn && /[\u4e00-\u9fff]/.test(cn), code + ' has no zh-Hant label')
  assert.ok(!cn.includes(code), code + ' code leaked: ' + cn)
  assert.ok(!cn.includes(raw[code] || '___none___'), code + ' raw English leaked')
  const tip = err.tooltipError('CN', code, raw[code] || '')
  assert.ok(tip.startsWith('挖礦程式出錯：'), tip)
  assert.ok(/[\u4e00-\u9fff]/.test(tip.slice(6)), tip)
}

assert.strictEqual(err.full('CN', 'DEFENDER', raw.DEFENDER), '防毒軟體（Windows Defender）把顯示卡挖礦程式刪掉了。請在防毒軟體裡把 SCDO Wallet 的資料夾加入允許清單，再按「開始挖礦」。')
assert.strictEqual(err.full('CN', '', 'download timeout'), '挖礦程式下載失敗，請檢查網路後再試一次。')
assert.strictEqual(err.full('CN', 'ERROR', 'HTTP 404 for https://github.com/rigelminer/rigel/releases/download/x'), '挖礦程式下載失敗，請檢查網路後再試一次。')
assert.strictEqual(err.full('CN', '', 'Rigel SHA256 mismatch (got abc), file deleted – try again'), '下載的挖礦程式不完整，已幫你刪掉，請再試一次。')
assert.strictEqual(err.full('CN', 'PORTS', raw.PORTS), '這台電腦挖礦要用的連線埠被別的程式佔用了，請關掉其他挖礦程式或重新開機後再試。')
assert.strictEqual(err.full('CN', 'ERROR', 'something unexpected'), '挖礦程式沒有啟動成功，請再試一次；如果一直失敗，可以在「設定」匯出診斷資料。')
assert.strictEqual(err.tooltipError('CN', 'DEFENDER', raw.DEFENDER), '挖礦程式出錯：被防毒軟體刪掉')
assert.strictEqual(err.tooltipError('CN', 'ERROR', 'nope'), '挖礦程式出錯：沒有啟動成功')
assert.ok(err.full('EN', 'DEFENDER', raw.DEFENDER).startsWith('Antivirus software'))
assert.ok(!err.full('EN', '', 'download timeout').includes('下載'))

assert.strictEqual(err.minersRunning(null), false)
assert.strictEqual(err.minersRunning({ running: false, phase: 'idle' }), false)
assert.strictEqual(err.minersRunning({ running: true, mode: 'node' }), false)
assert.strictEqual(err.minersRunning({ running: false, phase: 'error', code: 'DEFENDER' }), false)
assert.strictEqual(err.minersRunning({ running: true, mode: 'mine' }), true)
assert.strictEqual(err.minersRunning({ running: true, mode: 'pool' }), true)
assert.strictEqual(err.minersRunning({ running: false, classicNote: 'Classic 處理器礦池' }), true)

const app = fs.readFileSync(path.join(__dirname, '../src/js/app112.js'), 'utf8')
assert.ok(app.includes("window.SCDOStartError.full('CN', r.code, r.error)"))
assert.ok(app.includes("code === 'ERROR') return window.SCDOStartError.full('CN', code, m.message)"))
const tray = fs.readFileSync(path.join(__dirname, '../src/main/trayStatus.js'), 'utf8')
assert.ok(tray.includes('enabled: mining'))
assert.ok(tray.includes('tooltipError(lang, st.code, st.message)'))
assert.ok(!tray.includes("L.minerError + ': '"))

console.log('miner-start-error: ok')
