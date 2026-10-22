// 3.1.15 RC6: Copy buttons write through the main-process clipboard, then read it back.
'use strict'
async function clipWrite (clipboard, text) {
  const t = String(text == null ? '' : text)
  if (!t || t.length > 4096) return { ok: false, code: 'BAD_TEXT' }
  try {
    clipboard.writeText(t)
    let back = clipboard.readText()
    if (back && typeof back.then === 'function') back = await back
    return back === t ? { ok: true, code: 'OK' } : { ok: false, code: 'MISMATCH' }
  } catch (err) { return { ok: false, code: 'ERROR' } }
}
module.exports = { clipWrite }
