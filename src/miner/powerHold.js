// Sleep and wake for the miner guard.
// A wake waits 30 seconds, then the guard decides whether to continue.
'use strict'

const WAKE_HOLD_MS = 30 * 1000

let mode = 'up'
let wakeUntil = 0
let aliveAtSuspend = false

function reset () {
  mode = 'up'
  wakeUntil = 0
  aliveAtSuspend = false
}

function onSuspend (now, childAlive) {
  mode = 'suspend'
  wakeUntil = 0
  aliveAtSuspend = !!childAlive
  return flags(now, childAlive)
}

function onResume (now) {
  mode = 'wake'
  wakeUntil = (Number(now) || 0) + WAKE_HOLD_MS
  return flags(now, aliveAtSuspend)
}

function flags (now, childAlive) {
  now = Number(now) || 0
  if (mode === 'suspend') return { suspended: true, wakeHold: false, childDiedInSleep: false }
  if (mode === 'wake' && now < wakeUntil) return { suspended: false, wakeHold: true, childDiedInSleep: false }
  if (mode === 'wake') {
    const died = aliveAtSuspend && !childAlive
    mode = 'up'
    aliveAtSuspend = false
    wakeUntil = 0
    return { suspended: false, wakeHold: false, childDiedInSleep: died }
  }
  return { suspended: false, wakeHold: false, childDiedInSleep: false }
}

module.exports = { WAKE_HOLD_MS, reset, onSuspend, onResume, flags }
