// Chooses the renderer document: a verified bundle index, or the copy shipped in the app.
// Trust is one file URL, not the whole userData tree. Preload stays the app preload.js.
'use strict'
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const uiBundle = require('./uiBundle')

let userData = ''
let appIndex = ''
let state = uiBundle.emptyState()

function stateFile () {
  return userData ? path.join(userData, 'ui-bundle-state.json') : ''
}

function init (opts) {
  opts = opts || {}
  userData = opts.userData || ''
  appIndex = opts.appIndex || ''
  state = stateFile() ? uiBundle.readState(stateFile()) : uiBundle.emptyState()
  return state
}

function bundleIndexPath () {
  return uiBundle.bundleReady(state)
}

function activeFile () {
  return bundleIndexPath() || appIndex
}

function activeUrl () {
  const file = activeFile()
  if (!file) return ''
  try { if (!fs.existsSync(file)) return appIndex ? pathToFileURL(appIndex).href : '' } catch (e) {}
  return pathToFileURL(file).href
}

function load (win) {
  if (!win || win.isDestroyed()) return
  const file = activeFile()
  if (file) win.loadFile(file)
}

function reload (win) {
  if (!win || win.isDestroyed()) return
  if (!appIndex) { win.reload(); return }
  load(win)
}

function persist (next) {
  state = next || uiBundle.emptyState()
  if (stateFile()) uiBundle.writeState(stateFile(), state)
  return state
}

function adopt (next) {
  return persist(next)
}

function noteCrash (reason) {
  if (!bundleIndexPath()) return false
  const next = uiBundle.noteCrash(state, reason)
  persist(next.state)
  return next.rollback
}

function noteLoadFail (url) {
  const bundle = bundleIndexPath()
  if (!bundle) return false
  const bare = String(url || '').split('#')[0]
  if (bare !== pathToFileURL(bundle).href) return false
  const next = uiBundle.noteLoadFail(state)
  persist(next.state)
  return next.rollback
}

module.exports = {
  init: init,
  activeFile: activeFile,
  activeUrl: activeUrl,
  load: load,
  reload: reload,
  adopt: adopt,
  noteCrash: noteCrash,
  noteLoadFail: noteLoadFail,
  bundleIndexPath: bundleIndexPath
}
