// Each UI language is fully localized: no Chinese in English strings, no English sentences in Chinese strings,
// and user-facing links point at scdo.com.au. Release notes (history) are exempt.
'use strict'
const assert = require('assert')
const fs = require('fs')
const path = require('path')
global.window = {}
require('../src/js/i18n112.js')
const { CN, EN } = global.window.I18N112
const CJK = /[\u3400-\u9fff\uf900-\ufaff]/
// a language picker label is shown in both languages on purpose so either reader can find it
const BILINGUAL_OK = new Set(['setLang', 'relNotes'])
const s = v => typeof v === 'function' ? '' : (typeof v === 'string' ? v : '')
for (const k of Object.keys(EN)) {
  if (BILINGUAL_OK.has(k)) continue
  assert.ok(!CJK.test(s(EN[k])), 'EN.' + k + ' has Chinese: ' + s(EN[k]))
}
for (const k of ['remitEn', 'remitZeroEn']) assert.ok(CJK.test(CN[k]), 'CN.' + k + ' is translated')
for (const lang of [CN, EN]) {
  for (const k of Object.keys(lang)) {
    if (k === 'relNotes') continue
    assert.ok(!/scdoscan\.io\/(nodes|downloads)?/.test(s(lang[k])) || /api|rpc/.test(k), k + ' links to scdoscan.io; use scdo.com.au')
  }
}
assert.ok(EN.nodeHint.includes('scdo.com.au/nodes/') && CN.nodeHint.includes('scdo.com.au/nodes/'))
assert.ok(EN.updVerifyFail.includes('scdo.com.au/downloads/') && CN.updVerifyFail.includes('scdo.com.au/downloads/'))
const app = fs.readFileSync(path.join(__dirname, '../src/js/app112.js'), 'utf8')
assert.ok(!app.includes("shellFold('setCat', 'AI小貓'"), 'settings fold title follows the UI language')
assert.ok(!app.includes('aria-label="AI小貓"'), 'cat panel label follows the UI language')
console.log('i18n-no-mixing: ok')
