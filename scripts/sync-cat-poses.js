// 3.0.5: copy AI小貓 pose frames into assets/cat/ and rewrite the frame list in src/js/catPoses.js.
//   node scripts/sync-cat-poses.js /path/to/frames      (takes pose-<N>.webp, sorted by N; sub-folders such as rejected/ are ignored)
// Old pose-*.webp files in assets/cat/ that are not in the new set are removed so the list and the folder always match.
'use strict'
const fs = require('fs'); const path = require('path')
const src = process.argv[2]
if (!src || !fs.existsSync(src)) { console.error('usage: node scripts/sync-cat-poses.js <frames dir>'); process.exit(1) }
const root = path.join(__dirname, '..'); const dst = path.join(root, 'assets', 'cat'); const list = path.join(root, 'src', 'js', 'catPoses.js')
const frames = fs.readdirSync(src).filter(f => /^pose-\d+\.webp$/.test(f) && fs.statSync(path.join(src, f)).isFile())
  .sort((a, b) => parseInt(a.slice(5), 10) - parseInt(b.slice(5), 10))
if (!frames.length) { console.error('no pose-<N>.webp in ' + src); process.exit(1) }
fs.mkdirSync(dst, { recursive: true })
for (const f of fs.readdirSync(dst)) if (/^pose-\d+\.webp$/.test(f) && !frames.includes(f)) fs.unlinkSync(path.join(dst, f))
for (const f of frames) fs.copyFileSync(path.join(src, f), path.join(dst, f))
const js = fs.readFileSync(list, 'utf8')
const body = frames.map(f => "    '" + f + "'").join(',\n')
const out = js.replace(/(\/\/ BEGIN FRAMES[^\n]*\n)[\s\S]*?(\n\s*\/\/ END FRAMES)/, (m, a, b) => a + body + b)
if (out === js && !js.includes(body)) { console.error('frame markers not found in ' + list); process.exit(1) }
fs.writeFileSync(list, out)
console.log(frames.length + ' frames: ' + frames.join(', '))
