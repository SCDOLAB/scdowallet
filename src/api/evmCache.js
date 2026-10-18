// Public address cache at ~/.ScdoWallet/evm.json.
// Deleting an account removes only that file's entry. The original file is
// copied to evm.json.bak-<timestamp> before the rewrite. Key files are never touched.
'use strict'
const fs = require('fs')
const path = require('path')

function safeName (fileName) {
  if (typeof fileName !== 'string' || !fileName || fileName === '.' || fileName === '..') return ''
  if (fileName !== path.basename(fileName) || /[\\/]/.test(fileName)) return ''
  return fileName
}

function safeStamp (now) {
  const stamp = String(now == null ? Date.now() : now)
  return /^[0-9A-Za-z._-]+$/.test(stamp) ? stamp : ''
}

function backupPath (cachePath, stamp, fsImpl) {
  let bak = cachePath + '.bak-' + stamp
  let n = 1
  while (fsImpl.existsSync(bak)) bak = cachePath + '.bak-' + stamp + '-' + (n++)
  return bak
}

// Removes one filename key. Does not delete key files, and does not rewrite
// the cache when that key is already absent.
function forgetAccount (cachePath, fileName, opts) {
  opts = opts || {}
  const fsImpl = opts.fs || fs
  const name = safeName(fileName)
  if (!name) return { ok: false, removed: false, backup: '', error: 'bad name' }
  if (!cachePath || typeof cachePath !== 'string') return { ok: false, removed: false, backup: '', error: 'bad path' }
  if (!fsImpl.existsSync(cachePath)) return { ok: true, removed: false, backup: '' }
  const raw = fsImpl.readFileSync(cachePath)
  let doc
  try { doc = JSON.parse(String(raw)) } catch (e) { return { ok: false, removed: false, backup: '', error: 'parse' } }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { ok: false, removed: false, backup: '', error: 'parse' }
  if (!Object.prototype.hasOwnProperty.call(doc, name)) return { ok: true, removed: false, backup: '' }
  const stamp = safeStamp(opts.now)
  if (!stamp) return { ok: false, removed: false, backup: '', error: 'bad stamp' }
  const bak = backupPath(cachePath, stamp, fsImpl)
  fsImpl.writeFileSync(bak, raw)
  const next = {}
  for (const k of Object.keys(doc)) if (k !== name) next[k] = doc[k]
  fsImpl.writeFileSync(cachePath, JSON.stringify(next, null, 2))
  return { ok: true, removed: true, backup: bak }
}

module.exports = { forgetAccount }
