// Running flags in miner-intent.json are not the chain selection.
// Stop and quit clear them. Launch reads a resume snapshot only when auto-resume is on.
'use strict'

function blankResume () {
  return { cpu: false, classicGpu: false, shard0: false }
}

function armed (intent) {
  const it = intent || {}
  return !!((it.autoResume && it.keepMining) || it.resumeOnce)
}

function clearedRunning (intent) {
  const next = Object.assign({}, intent || {}, {
    runningCpu: false,
    runningClassicGpu: false,
    runningShard0: false
  })
  if (!armed(next)) next.resume = blankResume()
  return next
}

// User Stop: forget that anything was running, and do not resume it on the next launch.
// The chain/device selection lives elsewhere and is not touched here.
function afterStop (intent, which) {
  const next = clearedRunning(intent)
  next.autoResume = false
  next.resumeOnce = false
  next.resume = blankResume()
  if (which === 'cpu') {
    // already cleared every running flag: a Stop is a full "not running" mark for that device,
    // and the other devices keep their flags only when this stop was not "all".
  }
  if (which === 'cpu' || which === 'classicGpu' || which === 'shard0') {
    const prev = intent || {}
    next.runningCpu = which === 'cpu' ? false : !!prev.runningCpu
    next.runningClassicGpu = which === 'classicGpu' ? false : !!prev.runningClassicGpu
    next.runningShard0 = which === 'shard0' ? false : !!prev.runningShard0
    // any user Stop turns auto-resume off so a leftover flag cannot start mining
    next.autoResume = false
    next.resume = blankResume()
  }
  return next
}

// Clean quit: clear running flags. If auto-resume is on, remember what was actually running.
function afterQuit (intent) {
  const it = intent || {}
  const resume = armed(it) ? {
    cpu: !!it.runningCpu,
    classicGpu: !!it.runningClassicGpu,
    shard0: !!it.runningShard0
  } : blankResume()
  return Object.assign({}, it, {
    runningCpu: false,
    runningClassicGpu: false,
    runningShard0: false,
    resume: resume
  })
}

function launchTargets (intent) {
  const it = intent || {}
  if (!armed(it)) return []
  const r = it.resume || blankResume()
  const out = []
  if (r.cpu) out.push('cpu')
  if (r.classicGpu) out.push('classicGpu')
  if (r.shard0) out.push('shard0')
  return out
}

module.exports = { blankResume, armed, clearedRunning, afterStop, afterQuit, launchTargets }
