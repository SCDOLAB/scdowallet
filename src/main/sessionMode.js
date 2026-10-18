// Launch at login is opt-in. Light mode is the low-resource session.
// A login start is Light until the user has chosen a mode themselves.
'use strict'

function normalizePrefs (raw) {
  const o = raw && typeof raw === 'object' ? raw : {}
  return {
    loginLaunch: o.loginLaunch === true,
    loginAsked: o.loginAsked === true,
    lightMode: o.lightMode === true,
    lightChosen: o.lightChosen === true,
    gpuIntensity: o.gpuIntensity === 'low' ? 'low' : 'normal',
    idleOnly: o.idleOnly === true
  }
}

function resolveLight (input) {
  const openedAtLogin = !!(input && input.openedAtLogin)
  const p = normalizePrefs(input && input.intent)
  if (p.lightMode === true) return true
  if (p.lightChosen === true) return false
  return openedAtLogin
}

function offerLogin (intent) {
  const p = normalizePrefs(intent)
  return p.loginAsked !== true && p.loginLaunch !== true
}

function loginItemSettings (on) {
  const open = on === true
  return {
    openAtLogin: open,
    openAsHidden: open,
    args: open ? ['--scdo-login'] : []
  }
}

function openedAtLogin (input) {
  if (input && input.wasOpenedAtLogin === true) return true
  const argv = input && input.argv
  return Array.isArray(argv) && argv.indexOf('--scdo-login') >= 0
}

module.exports = { normalizePrefs, resolveLight, offerLogin, loginItemSettings, openedAtLogin }
