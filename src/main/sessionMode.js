// Launch at login turns on when the user starts an agent or bookkeeping.
// The Settings toggle can turn it off, and that choice stays off.
// A login start is Light until the user has chosen a mode, unless keep-bookkeeping should resume.
'use strict'

function normalizePrefs (raw) {
  const o = raw && typeof raw === 'object' ? raw : {}
  return {
    loginLaunch: o.loginLaunch === true,
    loginAsked: o.loginAsked === true,
    loginOff: o.loginOff === true,
    lightMode: o.lightMode === true,
    lightChosen: o.lightChosen === true,
    gpuIntensity: o.gpuIntensity === 'low' ? 'low' : 'normal',
    idleOnly: o.idleOnly === true
  }
}

// Keep-bookkeeping was on and there is a session to bring back.
function keepBookkeeping (intent) {
  const it = intent || {}
  if (it.keepMining !== true) return false
  if (it.autoResume === true || it.resumeOnce === true) return true
  if (it.runningCpu || it.runningClassicGpu || it.runningShard0) return true
  const r = it.resume || {}
  return !!(r.cpu || r.classicGpu || r.shard0)
}

function resolveLight (input) {
  const openedAtLogin = !!(input && input.openedAtLogin)
  const intent = input && input.intent
  const p = normalizePrefs(intent)
  if (p.lightMode === true) return true
  if (p.lightChosen === true) return false
  if (openedAtLogin && keepBookkeeping(intent)) return false
  return openedAtLogin
}

function offerLogin (intent) {
  const p = normalizePrefs(intent)
  return p.loginAsked !== true && p.loginLaunch !== true
}

// Already on, or the user turned the toggle off: do not flip it back on.
function shouldArmLogin (intent) {
  const p = normalizePrefs(intent)
  if (p.loginLaunch === true) return false
  if (p.loginOff === true) return false
  return true
}

function armLoginPatch () {
  return { loginLaunch: true, loginAsked: true, loginOff: false }
}

// An agent has been started, or bookkeeping is on / was left running.
function rigWantsLogin (intent, agentStarted) {
  if (agentStarted === true) return true
  const it = intent || {}
  if (it.keepMining === true || it.autoResume === true) return true
  return !!(it.runningCpu || it.runningClassicGpu || it.runningShard0)
}

function loginItemSettings (on) {
  const open = on === true
  return {
    openAtLogin: open,
    openAsHidden: open,
    args: open ? ['--hidden'] : []
  }
}

function openedAtLogin (input) {
  if (input && input.wasOpenedAtLogin === true) return true
  const argv = input && input.argv
  if (!Array.isArray(argv)) return false
  return argv.indexOf('--hidden') >= 0 || argv.indexOf('--scdo-hidden') >= 0 || argv.indexOf('--scdo-login') >= 0
}

function hiddenLaunch (argv) {
  return Array.isArray(argv) && (argv.indexOf('--hidden') >= 0 || argv.indexOf('--scdo-hidden') >= 0)
}

module.exports = {
  normalizePrefs, resolveLight, offerLogin, shouldArmLogin, armLoginPatch,
  rigWantsLogin, keepBookkeeping, loginItemSettings, openedAtLogin, hiddenLaunch
}
