// Build the menu-bar and tray icons from the SCDO logo.
// Mac templates are the light ribbon only (black on transparent), never the dark plate.
// Windows keeps the coloured logo at 16, 24 and 32, with a small corner dot for state.
'use strict'
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const root = path.join(__dirname, '..')
const outDir = path.join(root, 'assets', 'tray')

function crc32 (buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}
function chunk (type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type), data])
  const sum = Buffer.alloc(4)
  sum.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, sum])
}
function encodePng (w, h, rgba) {
  const stride = w * 4
  const raw = Buffer.alloc((stride + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}
function paeth (a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  if (pb <= pc) return b
  return c
}
function decodePng (buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a png')
  let w = 0
  let h = 0
  let ctype = 0
  const parts = []
  let o = 8
  while (o < buf.length) {
    const len = buf.readUInt32BE(o)
    const type = buf.slice(o + 4, o + 8).toString('ascii')
    const data = buf.slice(o + 8, o + 8 + len)
    if (type === 'IHDR') {
      w = data.readUInt32BE(0)
      h = data.readUInt32BE(4)
      ctype = data[9]
      if (data[8] !== 8 || data[12] !== 0) throw new Error('unsupported png')
    } else if (type === 'IDAT') parts.push(data)
    o += 12 + len
  }
  if (ctype !== 6) throw new Error('png colour type ' + ctype)
  const inflated = zlib.inflateSync(Buffer.concat(parts))
  const stride = w * 4
  const rgba = Buffer.alloc(stride * h)
  let i = 0
  for (let y = 0; y < h; y++) {
    const filter = inflated[i++]
    const row = y * stride
    const prev = y ? (y - 1) * stride : -1
    for (let x = 0; x < stride; x++) {
      const raw = inflated[i++]
      const a = x >= 4 ? rgba[row + x - 4] : 0
      const b = prev >= 0 ? rgba[prev + x] : 0
      const c = prev >= 0 && x >= 4 ? rgba[prev + x - 4] : 0
      let v = raw
      if (filter === 1) v = (raw + a) & 255
      else if (filter === 2) v = (raw + b) & 255
      else if (filter === 3) v = (raw + ((a + b) >> 1)) & 255
      else if (filter === 4) v = (raw + paeth(a, b, c)) & 255
      else if (filter !== 0) throw new Error('filter ' + filter)
      rgba[row + x] = v
    }
  }
  return { w, h, rgba }
}
function box (src, sw, sh, dw, dh, pick) {
  const out = Buffer.alloc(dw * dh * 4)
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const x0 = Math.floor(x * sw / dw)
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sw / dw))
      const y0 = Math.floor(y * sh / dh)
      const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sh / dh))
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let n = 0
      let light = 0
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const p = (yy * sw + xx) * 4
          const R = src[p]
          const G = src[p + 1]
          const B = src[p + 2]
          const A = src[p + 3]
          r += R
          g += G
          b += B
          a += A
          n++
          if (A > 40 && R + G + B > 520) light++
        }
      }
      const o = (y * dw + x) * 4
      const px = pick({ r: r / n, g: g / n, b: b / n, a: a / n, light: light / n })
      out[o] = px[0]
      out[o + 1] = px[1]
      out[o + 2] = px[2]
      out[o + 3] = px[3]
    }
  }
  return out
}
function colourLogo (src, sw, sh, size) {
  return box(src, sw, sh, size, size, p => [
    Math.round(p.r), Math.round(p.g), Math.round(p.b), Math.round(p.a)
  ])
}
function ribbonBounds (src, sw, sh) {
  let x0 = sw
  let y0 = sh
  let x1 = 0
  let y1 = 0
  let n = 0
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const p = (y * sw + x) * 4
      if (src[p + 3] > 40 && src[p] + src[p + 1] + src[p + 2] > 520) {
        if (x < x0) x0 = x
        if (y < y0) y0 = y
        if (x > x1) x1 = x
        if (y > y1) y1 = y
        n++
      }
    }
  }
  if (!n) throw new Error('logo ribbon not found')
  const pad = Math.round(Math.max(x1 - x0, y1 - y0) * 0.06)
  return {
    x: Math.max(0, x0 - pad),
    y: Math.max(0, y0 - pad),
    w: Math.min(sw, x1 + pad + 1) - Math.max(0, x0 - pad),
    h: Math.min(sh, y1 + pad + 1) - Math.max(0, y0 - pad),
    n
  }
}
function crop (src, sw, boxr) {
  const out = Buffer.alloc(boxr.w * boxr.h * 4)
  for (let y = 0; y < boxr.h; y++) {
    src.copy(out, y * boxr.w * 4, ((boxr.y + y) * sw + boxr.x) * 4, ((boxr.y + y) * sw + boxr.x + boxr.w) * 4)
  }
  return out
}
function ribbonMask (src, sw, sh, size) {
  return box(src, sw, sh, size, size, p => [0, 0, 0, p.light > 0.22 ? 255 : 0])
}
function outlineOf (mask, size) {
  const out = Buffer.alloc(size * size * 4)
  const on = (x, y) => x >= 0 && y >= 0 && x < size && y < size && mask[(y * size + x) * 4 + 3] > 0
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!on(x, y)) continue
      const edge = !on(x - 1, y) || !on(x + 1, y) || !on(x, y - 1) || !on(x, y + 1)
      if (!edge) continue
      const o = (y * size + x) * 4
      out[o + 3] = 255
    }
  }
  return out
}
function withDot (rgba, size, rgb) {
  const out = Buffer.from(rgba)
  const rad = size <= 16 ? 2 : size <= 24 ? 3 : 4
  const cx = size - rad - 1
  const cy = size - rad - 1
  for (let y = cy - rad; y <= cy + rad; y++) {
    for (let x = cx - rad; x <= cx + rad; x++) {
      if (x < 0 || y < 0 || x >= size || y >= size) continue
      if ((x - cx) * (x - cx) + (y - cy) * (y - cy) > rad * rad) continue
      const o = (y * size + x) * 4
      out[o] = rgb[0]
      out[o + 1] = rgb[1]
      out[o + 2] = rgb[2]
      out[o + 3] = 255
    }
  }
  return out
}
function ico (images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  const entries = Buffer.alloc(16 * images.length)
  let off = 6 + entries.length
  const blobs = []
  images.forEach((img, i) => {
    const e = i * 16
    entries[e] = img.size >= 256 ? 0 : img.size
    entries[e + 1] = img.size >= 256 ? 0 : img.size
    entries.writeUInt16LE(1, e + 4)
    entries.writeUInt16LE(32, e + 6)
    entries.writeUInt32LE(img.png.length, e + 8)
    entries.writeUInt32LE(off, e + 12)
    off += img.png.length
    blobs.push(img.png)
  })
  return Buffer.concat([header, entries].concat(blobs))
}

const full = decodePng(fs.readFileSync(path.join(root, 'assets', 'scdo-logo-1024.png')))
const logo = { w: full.w, h: full.h, rgba: full.rgba }
const bounds = ribbonBounds(logo.rgba, logo.w, logo.h)
const glyph = crop(logo.rgba, logo.w, bounds)
fs.mkdirSync(outDir, { recursive: true })
console.log('ribbon', bounds)

function writeTemplate (name, rgba, size) {
  fs.writeFileSync(path.join(outDir, name), encodePng(size, size, rgba))
}

const mask16 = ribbonMask(glyph, bounds.w, bounds.h, 16)
const mask32 = ribbonMask(glyph, bounds.w, bounds.h, 32)
writeTemplate('trayTemplate.png', outlineOf(mask16, 16), 16)
writeTemplate('trayTemplate@2x.png', outlineOf(mask32, 32), 32)
writeTemplate('trayTemplate-on.png', mask16, 16)
writeTemplate('trayTemplate-on@2x.png', mask32, 32)
writeTemplate('trayTemplate-dot.png', withDot(outlineOf(mask16, 16), 16, [0, 0, 0]), 16)
writeTemplate('trayTemplate-dot@2x.png', withDot(outlineOf(mask32, 32), 32, [0, 0, 0]), 32)

const sizes = [16, 24, 32]
const coloured = {}
for (const size of sizes) coloured[size] = colourLogo(logo.rgba, logo.w, logo.h, size)
const GREEN = [29, 122, 52]
const BLUE = [20, 110, 210]
const RED = [180, 40, 40]
function pack (name, tint) {
  const images = sizes.map(size => {
    const base = tint ? withDot(coloured[size], size, tint) : coloured[size]
    return { size, png: encodePng(size, size, base) }
  })
  fs.writeFileSync(path.join(outDir, name), ico(images))
}
pack('tray.ico', null)
pack('tray-on.ico', GREEN)
pack('tray-pause.ico', BLUE)
pack('tray-error.ico', RED)

for (const size of sizes) {
  fs.writeFileSync(path.join(outDir, 'win-' + size + '.png'), encodePng(size, size, coloured[size]))
}

console.log('tray icons written to', outDir)
