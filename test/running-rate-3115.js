// 3.1.15: the graphics card card shows 「運算中」/"Running" only when the miner reports a speed above zero.
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const mine = require('../src/js/mineHome.js')

const box = { window: {} }
vm.createContext(box)
vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/js/i18n112.js'), 'utf8'), box)
const I = box.window.I18N112
const makeT = d => (k, p) => {
  let s = d[k]
  if (s == null) return k
  if (p) s = s.replace(/\{(\w+)\}/g, (m, n) => p[n] != null ? p[n] : m)
  return s
}
const CN = makeT(I.CN)
const EN = makeT(I.EN)
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const HAN = /[\u4e00-\u9fff]/

function shard0 (rate) {
  return { running: true, mode: 'pool', chain: 'shard0', phase: 'mining', code: 'SHARD0_MINING', procs: ['scdo-clminer'], hashrateSource: 'rigel', hashrate: rate, shares: 3 }
}
function page (rate, T) {
  return mine.minePageHtml({ miners: { shard0: shard0(rate) }, chains: { cpu: [], gpu: [0] }, caps: { gpu: { available: true }, cpu: true } }, T, esc)
}
function gpuPart (html) {
  const i = html.indexOf('data-dev="gpu"')
  return i >= 0 ? html.slice(i) : html
}

for (const rate of [null, 0, '0', -5]) {
  const zh = gpuPart(page(rate, CN))
  const en = gpuPart(page(rate, EN))
  assert.ok(!zh.includes(I.CN.shellMineOn), 'zh shows 運算中 at rate ' + rate)
  assert.ok(!en.includes('>' + I.EN.shellMineOn + '<'), 'en shows Running at rate ' + rate)
  assert.ok(zh.includes(I.CN.shellBoot), 'zh starting text at rate ' + rate)
  assert.ok(en.includes(I.EN.shellBoot), 'en starting text at rate ' + rate)
  assert.ok(!HAN.test(mine.stripHtml ? mine.stripHtml(en) : en.replace(/<[^>]+>/g, '')), 'Chinese in en card at rate ' + rate)
}

const zhOn = gpuPart(page(9157000, CN))
const enOn = gpuPart(page(9157000, EN))
assert.ok(zhOn.includes(I.CN.shellMineOn))
assert.ok(enOn.includes(I.EN.shellMineOn))
assert.ok(!HAN.test(mine.stripHtml ? mine.stripHtml(enOn) : enOn.replace(/<[^>]+>/g, '')))

assert.strictEqual(I.CN.shellBoot, '啟動中')
assert.strictEqual(I.EN.shellBoot, 'Starting')
console.log('running-rate-3115 ok')
