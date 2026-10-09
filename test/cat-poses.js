// 3.0.5: AI小貓 animated launcher — frames are data-driven (src/js/catPoses.js) and every listed frame ships in assets/cat/.
'use strict'
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const vm = require('vm')
const root = path.join(__dirname, '..')
const box = { window: {} }; vm.runInNewContext(fs.readFileSync(path.join(root, 'src/js/catPoses.js'), 'utf8'), box)
const c = box.window.SCDOCatPoses
assert.ok(c && Array.isArray(c.frames) && c.frames.length >= 1, 'frame list')
assert.strictEqual(new Set(c.frames).size, c.frames.length, 'duplicate frames')
const want = [].concat(...['pose', 'taichi', 'wingchun'].map(s => [1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => s + '-' + n + '.webp')))
assert.deepStrictEqual([...c.frames], want, 'play order: pose 1-9, taichi 1-9, wingchun 1-9')
assert.strictEqual(c.reducedMotionFrame, 'pose-6.webp')
assert.strictEqual(c.holdMs, 3000); assert.strictEqual(c.fadeMs, 600); assert.ok(c.popScale > 1 && c.popScale <= 1.06)
assert.ok(c.frames.includes(c.reducedMotionFrame), 'reduced-motion frame is listed')
for (const f of c.frames) {
  assert.ok(/^[\w.-]+\.webp$/.test(f), f)
  const b = fs.readFileSync(path.join(root, c.dir, f))
  assert.ok(b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP', f + ' is WebP')
  assert.ok(b.length < 200 * 1024, f + ' size')
}
assert.ok(!fs.existsSync(path.join(root, 'assets/cat/rejected')), 'no rejected frames shipped')
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
assert.ok(html.indexOf('src/js/catPoses.js') > 0 && html.indexOf('src/js/catPoses.js') < html.indexOf('src/js/app112.js'))
const app = fs.readFileSync(path.join(root, 'src/js/app112.js'), 'utf8')
assert.ok(app.includes('window.SCDOCatPoses') && app.includes("prefers-reduced-motion: reduce"))
assert.ok(app.includes('class="cat-launch cat-capsule" id="aiCatBtn"') && app.includes('id="aiCatPanel"'), 'launcher + round3 popup kept')
assert.ok(/case 'catOpen': if \(!st\.catOpen && \$\('aiCatAnim'\) && !CAT_ANIM\.reduce\) catAnimNext\(\); st\.catOpen = !st\.catOpen; renderCat\(\)/.test(app), 'click advances then opens')
const css = fs.readFileSync(path.join(root, 'src/css/app112.css'), 'utf8')
assert.ok(/\.cap-av\.cat-anim img\.cat-f \{[^}]*top: 6px; width: var\(--cat-px, 64px\); height: var\(--cat-px, 64px\)/.test(css), 'cat size from --cat-px')
// 3.0.6: the cat stays inside the button box (76px tall, image top 6px + 68px = 74px) and the layout reserves the strip
assert.ok(/\.cat-launch\.cat-capsule:has\(\.cat-anim\) \{[^}]*height: calc\(var\(--cat-px, 64px\) \+ 8px\);[^}]*bottom: 10px;/.test(css))
assert.ok(/\.cap-av\.cat-anim \{[^}]*height: calc\(var\(--cat-px, 64px\) \+ 8px\)/.test(css))
assert.ok(!/\.cap-av\.cat-anim \{[^}]*(bottom|top): -/.test(css), 'nothing positioned outside the button')
// 3.0.7: four corners, three sizes, reserved strip at the cat's corner, popup opens from that corner
for (const c of ['tl', 'tr', 'bl', 'br']) {
  assert.ok(new RegExp('body\\.cat-at-' + c + ' \\.cat-launch\\.cat-capsule:has\\(\\.cat-anim\\) \\{').test(css), 'corner ' + c)
  if (c !== 'br') assert.ok(css.includes('body.cat-at-' + c + ' .cat-pop.bubble {'), 'popup corner ' + c)
}
for (const r of ['body.cat-reserve.cat-top header.top { min-height: var(--cat-res', 'body.cat-reserve.cat-at-tr header.top { padding-right: var(--cat-side', 'body.cat-reserve.cat-at-tl header.top { padding-left: var(--cat-side',
  'body.cat-reserve.cat-bottom .foot-bar { min-height: var(--cat-res', 'body.cat-reserve.cat-at-br .foot-bar { padding-right: var(--cat-side', 'body.cat-reserve.cat-at-bl .foot-bar { padding-left: var(--cat-side',
  'body.cat-reserve.cat-bottom #app:has(> .foot-bar[hidden]) > main { margin-bottom: var(--cat-res']) assert.ok(css.includes(r), r)
assert.ok(app.includes("const CAT_SIZES = { s: 64, m: 112, l: 160 }") && app.includes("localStorage.setItem('aiCatCorner'") && app.includes("localStorage.setItem('aiCatSize'"))
assert.ok(/Math\.hypot\(e\.clientX - d\.x, e\.clientY - d\.y\) < 5/.test(app), 'a press that moves < 5px is a click')
assert.ok(app.includes("case 'catSize': catSetPlace(null, v); break") && app.includes("case 'catCorner': catSetPlace(v, null); break") && app.includes('data-act="catCorner" data-v="br"'))
const i18n = fs.readFileSync(path.join(root, 'src/js/i18n112.js'), 'utf8')
assert.ok(i18n.includes('catSizeLbl: "小貓大小：", catSize_s: "小", catSize_m: "中", catSize_l: "大"') && i18n.includes('catCornerReset: "放回右下角"'))
assert.ok(/@media \(prefers-reduced-motion: reduce\) \{\s*\.cat-capsule \.cap-av\.cat-anim img\.cat-f \{[^}]*animation: none/.test(css))
const pkg = require(path.join(root, 'package.json'))
assert.ok(!pkg.build.files.some(f => /assets/.test(f) && f.startsWith('!')), 'assets are packaged')
console.log('cat-poses ok (' + c.frames.length + ' frames)')
