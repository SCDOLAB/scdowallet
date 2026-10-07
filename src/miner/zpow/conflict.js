// Shard0 GPU, Classic GPU, and Classic CPU may all run at the same time.
// This does not refuse a start. A duplicate of the same process is handled
// by that process's own manager, not here.
'use strict'

function decideStart () {
  return { ok: true }
}

module.exports = { decideStart }
