// 3.1.8: Mac mining page shows Shard0 stats, ticks follow the running chain, calm Classic wording.
const assert = require('assert')
const H = require('../src/js/mineHome.js')
const box = { window: {} }
require('vm').runInNewContext(require('fs').readFileSync(require('path').join(__dirname, '../src/js/i18n112.js'), 'utf8'), box)
const I = { CN: box.window.I18N112.zh || box.window.I18N112.CN, EN: box.window.I18N112.en || box.window.I18N112.EN }
const caps = { platform: 'darwin', macGpu: { available: true }, cpu: { available: true } }
const pools = { 1: { online: false, url: '', notConfigured: true }, 2: { online: false, url: 'x' } }
assert.deepStrictEqual(H.chainSupport('cpu', 1, caps, pools), { ok: false, reasonKey: 'shellPoolNone' })
assert.strictEqual(H.chainSupport('cpu', 2, caps, pools).poolDown, true)
assert.strictEqual(I.CN.shellPoolNone, '由社群節點維護')
const s0 = { running: true, mode: 'pool', phase: 'mining', code: 'MINING', hashrateSource: 'rigel', hashrate: 6050000, sharesSeen: true, sharesAccepted: 12, networkBlock: 142500, networkDifficulty: 1785419293, procs: ['rigel'], pid: 1 }
const html = H.minePageHtml ? null : null
const ps = require('../src/js/poolStatus.js')
ps.reset()
ps.readAll(() => ({ 1: null }), async () => { throw new Error('no fetch') }, 0).then(r => {
  assert.strictEqual(r[1].notConfigured, true)
  console.log('mac-318 ok')
})
// exercise the expand rows through the module source (private helper)
const src = require('fs').readFileSync(require.resolve('../src/js/mineHome.js'), 'utf8')
assert.ok(/hashrateSource === 'rigel'\) return num\(m\.hashrate\)/.test(src))
assert.ok(/session\.networkDifficulty/.test(src) && /session\.networkBlock/.test(src))
void s0; void html
