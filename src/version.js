// One reported version for the menu, the updater, and About. It is package.json.
'use strict'
const pkg = require('../package.json')
const VERSION = String(pkg.version || '')

function checkRuntime (reported) {
  const got = String(reported == null ? '' : reported)
  if (got !== VERSION) {
    return { ok: false, version: VERSION, reported: got, error: 'version self-check failed: reported ' + got + ' != package ' + VERSION }
  }
  return { ok: true, version: VERSION, reported: got }
}

module.exports = { VERSION, checkRuntime }
