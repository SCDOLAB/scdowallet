// Miner process priority. Low is the default. The user can raise it in Advanced.
'use strict'
const os = require('os')

function priorityLevel (low) {
  const below = low !== false
  if (process.platform === 'win32') {
    const p = os.constants.priority
    return below ? p.PRIORITY_BELOW_NORMAL : p.PRIORITY_NORMAL
  }
  return below ? 10 : 0
}

function applyPriority (pid, low) {
  const id = Math.floor(Number(pid))
  if (!id) return false
  try {
    os.setPriority(id, priorityLevel(low))
    return true
  } catch (e) {
    return false
  }
}

module.exports = { priorityLevel, applyPriority }
