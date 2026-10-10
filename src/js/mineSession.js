// 3.0.11: launch starts miners only when auto-resume is explicitly on.
// Running flags are not a reason to start. The saved device choice is separate.
'use strict'
;(function () {
  function launchPlan (opts) {
    opts = opts || {}
    if (opts.autoResume !== true) return { start: [] }
    const snap = opts.resume
    const hasSnap = !!(snap && typeof snap === 'object')
    const src = hasSnap ? snap : (opts.running || {})
    const start = []
    if (src.cpu) start.push('cpu')
    if (src.classicGpu) start.push('classicGpu')
    if (src.shard0) start.push('shard0')
    return { start: start }
  }

  function clearedFlags (store) {
    const next = Object.assign({}, store || {})
    next.minerRunClassicCpu = ''
    next.minerRunClassicGpu = ''
    next.minerRunShard0 = ''
    return next
  }

  const api = { launchPlan, clearedFlags }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (typeof window !== 'undefined') window.SCDOMineSession = Object.freeze(api)
})()
