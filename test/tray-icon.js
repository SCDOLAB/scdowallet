// Menu-bar icon: template glyph on macOS, coloured logo on Windows, humane speed.
'use strict'
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')
const Module = require('module')

const root = path.join(__dirname, '..')
const trayDir = path.join(root, 'assets', 'tray')
const names = [
  'trayTemplate.png', 'trayTemplate@2x.png',
  'trayTemplate-on.png', 'trayTemplate-on@2x.png',
  'trayTemplate-dot.png', 'trayTemplate-dot@2x.png',
  'tray.ico', 'tray-on.ico', 'tray-pause.ico', 'tray-error.ico'
]
for (const name of names) assert.ok(fs.existsSync(path.join(trayDir, name)), name)

function decodePng (buf) {
  assert.strictEqual(buf.readUInt32BE(0), 0x89504e47)
  let w = 0
  let h = 0
  const parts = []
  let o = 8
  while (o + 8 <= buf.length) {
    const len = buf.readUInt32BE(o)
    const type = buf.slice(o + 4, o + 8).toString('ascii')
    const data = buf.slice(o + 8, o + 8 + len)
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4) }
    else if (type === 'IDAT') parts.push(data)
    else if (type === 'IEND') break
    o += 12 + len
  }
  const inflated = zlib.inflateSync(Buffer.concat(parts))
  return { w, h, rgba: inflated }
}
function pixels (file) {
  const { w, h, rgba } = decodePng(fs.readFileSync(path.join(trayDir, file)))
  let transparent = 0
  let opaque = 0
  let redSquare = 0
  const stride = w * 4 + 1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * stride + 1 + x * 4
      const a = rgba[p + 3]
      if (a === 0) transparent++
      else {
        opaque++
        if (rgba[p] > 150 && rgba[p + 1] < 80 && rgba[p + 2] < 80) redSquare++
      }
    }
  }
  return { w, h, transparent, opaque, redSquare }
}
const t16 = pixels('trayTemplate.png')
const t32 = pixels('trayTemplate@2x.png')
assert.deepStrictEqual([t16.w, t16.h], [16, 16])
assert.deepStrictEqual([t32.w, t32.h], [32, 32])
assert.ok(t16.transparent > 0 && t16.opaque > 0, 'template is a glyph, not a filled square')
assert.strictEqual(t16.redSquare, 0)
assert.ok(pixels('trayTemplate-on.png').opaque > t16.opaque)
const ico = fs.readFileSync(path.join(trayDir, 'tray.ico'))
assert.strictEqual(ico.readUInt16LE(0), 0)
assert.strictEqual(ico.readUInt16LE(2), 1)
assert.ok(ico.readUInt16LE(4) >= 3)

const src = fs.readFileSync(path.join(root, 'src/main/trayStatus.js'), 'utf8')
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8')
assert.ok(src.includes('tray/trayTemplate.png'))
assert.ok(src.includes('setTemplateImage(true)'))
assert.ok(src.includes('tray/tray.ico'))
assert.ok(src.includes('tray/tray-on.ico') && src.includes('tray/tray-pause.ico') && src.includes('tray/tray-error.ico'))
assert.ok(!src.includes('this.tray.setImage(icon)'))
assert.ok(main.includes("const ASSETS = path.join(__dirname, 'assets')"))
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
assert.strictEqual(pkg.build.asar, true)
assert.ok(!(pkg.build.files || []).some(g => String(g).includes('assets/tray') && String(g).startsWith('!')))

const realLoad = Module._load
Module._load = function (req, parent, ...rest) {
  if (req === 'electron') return {}
  return realLoad.call(this, req, parent, ...rest)
}
const { fmtHash, trayIconFile, menuLines } = require('../src/main/trayStatus.js')
Module._load = realLoad
assert.strictEqual(fmtHash(4150068, 'CN'), '記帳速度 4.15 MH/s')
assert.strictEqual(fmtHash(4150068, 'EN'), 'Bookkeeping speed 4.15 MH/s')
assert.strictEqual(fmtHash(85, 'EN'), 'Bookkeeping speed 85 H/s')
assert.strictEqual(trayIconFile('darwin', null), 'tray/trayTemplate.png')
assert.strictEqual(trayIconFile('darwin', { running: true, guard: { colour: 'green' } }), 'tray/trayTemplate-on.png')
assert.strictEqual(trayIconFile('darwin', { guard: { colour: 'red' } }), 'tray/trayTemplate-dot.png')
assert.strictEqual(trayIconFile('darwin', { guard: { colour: 'blue' } }), 'tray/trayTemplate-dot.png')
assert.strictEqual(trayIconFile('win32', { guard: { colour: 'red' } }), 'tray/tray-error.ico')
assert.strictEqual(trayIconFile('win32', null), 'tray/tray.ico')
for (const file of [trayIconFile('darwin', null), trayIconFile('win32', null)]) {
  assert.ok(fs.existsSync(path.join(root, 'assets', file)), file)
}
const menu = menuLines('CN', { running: true, code: 'MINING', hashrate: 4150068 }, { agentOnline: true, light: true, loginLaunch: true })
assert.ok(menu.lines.includes('在線 · 請保持程式執行'))
assert.ok(menu.lines.includes('記帳中：記帳速度 4.15 MH/s'))
assert.ok(menu.lines.includes('恢復記帳'))
assert.strictEqual(menu.icon, 'tray/trayTemplate-on.png')
assert.ok(!menu.lines.some(line => /中文|简体|繁體/.test(line)))
console.log('tray-icon: ok')
