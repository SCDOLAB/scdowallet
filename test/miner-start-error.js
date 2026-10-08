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
assert.strictEqual(err.full('CN', 'ERROR', 'something unexpected'), '挖礦程式沒有啟動成功，請再試一次；如果一直失敗，可以在「挖礦」頁的「日誌」按「匯出挖礦日誌」，把檔案傳給客服。')
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
assert.ok(app.includes("window.SCDOStartError.full(lang(), r.code, r.error)"))
assert.ok(app.includes("code === 'ERROR') return window.SCDOStartError.full('CN', code, m.message)"))

// Every mapped code has a plain sentence in both languages: no Chinese in English,
// no developer words (program file names, env vars, checksums) in either.
const CJK = /[\u3000-\u303f\u3400-\u9fff\uf900-\ufaff\uff00-\uffef]/
const JARGON = /zminer|miner-bin|SHA256|SHA-256|SHA256SUMS|SCDO_[A-Z_]+|node\.exe|geth|rigel|cudart|\.exe\b|build script|建置|diagnostic|診斷/i
for (const table of [err.FULL, err.SHORT]) {
  assert.deepStrictEqual(Object.keys(table).sort(), Object.keys(err.FULL).sort())
  for (const [code, row] of Object.entries(table)) {
    assert.ok(row.CN && /[\u4e00-\u9fff]/.test(row.CN), code + ' CN missing')
    assert.ok(row.EN && !CJK.test(row.EN), code + ' EN has Chinese: ' + row.EN)
    assert.ok(!JARGON.test(row.CN), code + ' CN jargon: ' + row.CN)
    assert.ok(!JARGON.test(row.EN), code + ' EN jargon: ' + row.EN)
    assert.ok(!row.CN.includes('「設定」') && !/in Settings/.test(row.EN), code + ' points at a Settings export that does not exist')
  }
}
for (const code of ['BAD_ARGS', 'BAD_POOLS', 'BAD_DATADIR', 'BAD_KEY', 'NO_ZMINER', 'NO_CLASSIC_NODE', 'NO_CUDART', 'SHA256_MISSING', 'SHA256_MISMATCH']) {
  assert.ok(err.FULL[code], code + ' not mapped')
  assert.strictEqual(err.kind(code, 'raw English detail'), code)
  assert.strictEqual(err.full('CN', code, 'x'), err.FULL[code].CN)
  assert.strictEqual(err.full('EN', code, 'x'), err.FULL[code].EN)
}
assert.strictEqual(err.full('CN', 'BAD_POOLS', 'SCDO_ZPOW_POOLS is not JSON'), err.FULL.BAD_POOLS.CN)
assert.strictEqual(err.full('CN', 'SHA256_MISMATCH', 'sha256 mismatch for zminer'), '下載的挖礦程式跟官方版本對不上，為了安全已經停止啟動。請重新安裝或再試一次。')
assert.strictEqual(err.full('CN', 'NO_ZMINER', 'zminer binary not found ... set SCDO_ZMINER_EXE.'), '找不到處理器挖礦程式。請重新安裝 SCDO Wallet。')
assert.ok(err.FULL.CRASHING.EN.includes('"Export mining logs (sanitized)"'))
assert.ok(err.FULL.CRASHING.CN.includes('「匯出挖礦日誌」'))
// the English button label quoted in the sentences is the real one
const types = fs.readFileSync(path.join(__dirname, '../src/js/mining/types.js'), 'utf8')
assert.ok(types.includes('"Export mining logs (sanitized)": "匯出挖礦日誌（已去除敏感資訊）"'))
assert.ok(types.includes('"Logs": "日誌"'))

// Classic start pop-up: mapped code, then timeout/HTTP, then the i18n line, never the raw English
assert.strictEqual(err.classicStartText('CN', 'BAD_KEY', 'p2p key must be a fresh 0x + 32-byte hex key', ''), err.FULL.BAD_KEY.CN)
assert.strictEqual(err.classicStartText('EN', 'BAD_DATADIR', 'node config dir must be absolute', ''), err.FULL.BAD_DATADIR.EN)
assert.strictEqual(err.classicStartText('CN', undefined, 'timeout', ''), err.FULL.NETWORK.CN)
assert.strictEqual(err.classicStartText('EN', '', 'HTTP 502', ''), err.FULL.NETWORK.EN)
assert.strictEqual(err.classicStartText('CN', 'LOGIN', 'pool said no', '礦池拒絕登入（地址分片可能不對）。'), '礦池拒絕登入（地址分片可能不對）。')
assert.strictEqual(err.classicStartText('EN', 'WEIRD', 'something odd', ''), err.FULL.UNKNOWN.EN)
assert.strictEqual(err.classicStartText('CN', 'LOGIN', 'timeout while logging in', ''), err.FULL.UNKNOWN.CN)

// pop-ups never show r.error directly; they follow the UI language
assert.ok(!app.includes('toast(r.error || r.code'), 'raw miner error still reaches a pop-up')
assert.ok(!app.includes('(r.error || r.code), 8000'))
assert.ok(app.includes('window.SCDOStartError.classicStartText(lang(), r.code, r.error, stText)'))
assert.ok(!/SCDOStartError\.full\('CN', r\.code/.test(app))
const mainJs = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8')
assert.ok(mainJs.includes("'classic ' + backend + ' start failed: '"), 'Classic start failures keep the raw English in the log')

// i18n: no developer words in the miner start lines of either language
const vm = require('vm')
const i18nBox = { window: {} }
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/js/i18n112.js'), 'utf8'), i18nBox)
for (const lang of ['CN', 'EN']) {
  const T = i18nBox.window.I18N112[lang]
  for (const k of ['st_NO_ZMINER', 'st_NO_CLASSIC_NODE', 'st_NO_CUDART', 'st_SHA256_MISSING', 'st_SHA256_MISMATCH', 'st_SELFTEST', 'classicGpuOff', 'classicCpuMissing']) {
    assert.ok(T[k], lang + ' ' + k)
    assert.ok(!JARGON.test(T[k]), lang + ' ' + k + ' jargon: ' + T[k])
    if (lang === 'EN') assert.ok(!CJK.test(T[k]), 'EN ' + k + ' has Chinese')
  }
}

const tray = fs.readFileSync(path.join(__dirname, '../src/main/trayStatus.js'), 'utf8')
assert.ok(tray.includes('enabled: mining'))
assert.ok(tray.includes('tooltipError(lang, st.code, st.message)'))
assert.ok(!tray.includes("L.minerError + ': '"))

assert.ok(tray.includes("st && st.classicNote ? L.mining + st.classicNote : L.notMining"))
// load trayStatus.js without Electron (tooltipText is plain text)
const Module = require('module')
const realLoad = Module._load
Module._load = function (req, ...rest) { return req === 'electron' ? {} : realLoad.call(this, req, ...rest) }
const { tooltipText } = require('../src/main/trayStatus.js')
Module._load = realLoad
assert.strictEqual(tooltipText('3.0.2', { running: false, phase: 'idle', classicNote: 'Classic 處理器礦池 Shard1' }, 'CN'), 'SCDO Wallet 3.0.2\n挖礦中：Classic 處理器礦池 Shard1')
assert.strictEqual(tooltipText('3.0.2', { running: false, classicNote: 'Classic processor pool Shard2' }, 'EN'), 'SCDO Wallet 3.0.2\nMining: Classic processor pool Shard2')
assert.strictEqual(tooltipText('3.0.2', { running: false, phase: 'idle' }, 'CN'), 'SCDO Wallet 3.0.2\n未在挖礦')
assert.ok(tooltipText('3.0.2', { running: true, mode: 'mine', code: 'MINING', hashrate: 5, classicNote: 'Classic 顯示卡 Shard1' }, 'CN').endsWith('\nClassic 顯示卡 Shard1'))
assert.ok(tooltipText('3.0.2', { running: false, phase: 'error', code: 'PORTS', classicNote: 'Classic 顯示卡 Shard1' }, 'CN').includes('挖礦程式出錯：'))
assert.ok(mainJs.includes("'Classic 處理器礦池' : 'Classic processor pool') + shardOf(zpowCpu)"))

console.log('miner-start-error: ok')
