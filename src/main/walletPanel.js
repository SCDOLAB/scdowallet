// Sandboxed in-app panel. No preload and no wallet APIs in the guest.
// scdowallet:// stays inside the app. Other https links open in the system browser.
'use strict'
const crypto = require('crypto')
const walletUi = require('../js/walletUi')

const GUEST_PREFS = Object.freeze({
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  nodeIntegrationInSubFrames: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
  webviewTag: false,
  navigateOnDragDrop: false,
  spellcheck: false,
  partition: 'persist:wallet-panel'
})

// The live pages put scdowallet:// on data-s and, on a desktop browser, navigate to an https fallback.
// Capture the click and follow data-s so the guest navigation is the wallet link.
const PANEL_BRIDGE = `(function(){
  if (window.__scdoPanelBridge) return;
  window.__scdoPanelBridge = 1;
  document.addEventListener('click', function (e) {
    var n = e.target;
    while (n && n !== document) {
      if (n.getAttribute && n.getAttribute('data-s')) {
        var s = String(n.getAttribute('data-s') || '');
        if (s.indexOf('scdowallet:') === 0) {
          e.preventDefault();
          if (e.stopImmediatePropagation) e.stopImmediatePropagation();
          window.location.href = s;
        }
        return;
      }
      n = n.parentNode;
    }
  }, true);
})()`

function applyDecision (decision, effects) {
  const d = decision || { action: 'drop' }
  if (d.action === 'allow') return 'allow'
  if (d.action === 'protocol') {
    if (effects && effects.protocol) effects.protocol(d.href)
    return 'protocol'
  }
  if (d.action === 'external') {
    if (effects && effects.external) effects.external(d.href)
    return 'external'
  }
  return 'drop'
}

function bindGuest (wc, effects) {
  let lastId = ''
  let lastAt = 0
  function langOf () {
    try { return effects && effects.getLang ? effects.getLang() : 'CN' } catch (e) { return 'CN' }
  }
  function panelHref (url) {
    return walletUi.withPanelLang(url, langOf())
  }
  function once (url) {
    const id = crypto.createHash('sha256').update(String(url || '')).digest('hex')
    const now = Date.now()
    const dup = id === lastId && now - lastAt < 800
    lastId = id
    lastAt = now
    return dup
  }
  function guard (event, url) {
    const decision = walletUi.classifyNavigation(url)
    if (decision.action === 'allow' && decision.href !== 'about:blank') {
      const href = panelHref(decision.href)
      if (href !== decision.href) {
        if (event && event.preventDefault) event.preventDefault()
        if (!once(href) && effects && effects.navigate) effects.navigate(href)
        return
      }
    }
    if (decision.action !== 'allow' && once(decision.href || url)) {
      if (event && event.preventDefault) event.preventDefault()
      return
    }
    const applied = applyDecision(decision, effects)
    if (applied !== 'allow' && event && event.preventDefault) event.preventDefault()
  }
  wc.on('will-navigate', guard)
  wc.on('will-redirect', guard)
  wc.on('will-frame-navigate', function (event, url) {
    const target = url || (event && event.url)
    if (event && event.isMainFrame === false) {
      if (walletUi.classifyNavigation(target).action !== 'allow' && event.preventDefault) event.preventDefault()
      return
    }
    guard(event, target)
  })
  wc.setWindowOpenHandler(function (details) {
    const decision = walletUi.classifyNavigation(details && details.url)
    if (decision.action === 'protocol') {
      if (!once(decision.href)) applyDecision(decision, effects)
    } else if (decision.action === 'allow') {
      const href = panelHref(decision.href)
      if (effects && effects.navigate) effects.navigate(href)
    } else if (decision.action === 'external') {
      applyDecision(decision, effects)
    }
    return { action: 'deny' }
  })
  const arm = function () {
    try {
      const p = wc.executeJavaScript(PANEL_BRIDGE, true)
      if (p && typeof p.catch === 'function') p.catch(function () {})
    } catch (e) {}
  }
  wc.on('dom-ready', arm)
  return { guard: guard }
}

function boundsOf (req, win) {
  const size = win && win.getContentSize ? win.getContentSize() : [1280, 900]
  const ww = size[0]
  const hh = size[1]
  const x = Math.max(0, Math.round(Number(req && req.x) || 0))
  const y = Math.max(0, Math.round(Number(req && req.y) || 0))
  const width = Math.max(0, Math.min(Math.max(0, ww - x), Math.round(Number(req && req.width) || 0)))
  const height = Math.max(0, Math.min(Math.max(0, hh - y), Math.round(Number(req && req.height) || 0)))
  return { x: x, y: y, width: width, height: height }
}

function create (opts) {
  opts = opts || {}
  const electron = require('electron')
  const shell = opts.shell || electron.shell
  let view = null
  let wc = null
  let shown = false
  let attached = false
  let loaded = ''
  const useContents = typeof electron.WebContentsView === 'function'

  function onProtocol (url) {
    hide()
    if (opts.onProtocol) opts.onProtocol(url)
  }
  function langNow () {
    try { return opts.getLang ? opts.getLang() : 'CN' } catch (e) { return 'CN' }
  }
  function onExternal (url) {
    const decision = walletUi.classifyNavigation(url)
    if (decision.action !== 'external') return
    try { shell.openExternal(decision.href) } catch (e) {}
  }
  const effects = {
    protocol: onProtocol,
    external: onExternal,
    navigate: function (url) { if (wc) wc.loadURL(walletUi.withPanelLang(url, langNow())) },
    getLang: langNow
  }

  function ensure (win) {
    if (view) return
    const View = useContents ? electron.WebContentsView : electron.BrowserView
    view = new View({ webPreferences: Object.assign({}, GUEST_PREFS) })
    wc = view.webContents
    bindGuest(wc, effects)
    wc.on('will-attach-webview', function (e) { e.preventDefault() })
    try {
      wc.session.setPermissionRequestHandler(function (w, perm, cb) { cb(false) })
    } catch (e) {}
    wc.on('will-download', function (e) { e.preventDefault() })
    attach(win)
  }

  function attach (win) {
    if (!view || attached) return
    if (useContents) win.contentView.addChildView(view)
    else win.setBrowserView(view)
    attached = true
  }

  function hide () {
    shown = false
    const win = opts.getWindow ? opts.getWindow() : null
    if (!view || !win || win.isDestroyed()) return
    try {
      if (useContents) win.contentView.removeChildView(view)
      else if (win.getBrowserView && win.getBrowserView() === view) win.setBrowserView(null)
    } catch (e) {}
    attached = false
  }

  function show (req) {
    const win = opts.getWindow ? opts.getWindow() : null
    if (!win || win.isDestroyed()) return { ok: false }
    const doc = walletUi.current()
    const id = String(req && req.id || 'hub')
    const direct = req && req.url ? walletUi.classifyNavigation(req.url) : null
    const url = direct && direct.action === 'allow' ? direct.href : ((doc.links && (doc.links[id] || doc.links.hub)) || '')
    const decision = walletUi.classifyNavigation(url)
    if (decision.action !== 'allow') return { ok: false }
    const href = walletUi.withPanelLang(decision.href, langNow())
    ensure(win)
    const b = boundsOf(req, win)
    if (b.width < 20 || b.height < 20) return { ok: false }
    attach(win)
    try { view.setVisible(true) } catch (e) {}
    view.setBounds(b)
    shown = true
    if (loaded !== href) {
      loaded = href
      wc.loadURL(href)
    }
    return { ok: true, url: href }
  }

  function destroy () {
    hide()
    try { if (wc && !wc.isDestroyed()) wc.destroy() } catch (e) {}
    view = null
    wc = null
    loaded = ''
  }

  function hookResize (win) {
    if (!win || win.__panelResize) return
    win.__panelResize = true
    win.on('resize', function () {
      if (!shown || !win.webContents || win.isDestroyed()) return
      try { win.webContents.send('panel:layout') } catch (e) {}
    })
  }

  return { show: show, hide: hide, destroy: destroy, hookResize: hookResize, usingContentsView: useContents }
}

module.exports = {
  GUEST_PREFS: GUEST_PREFS,
  PANEL_BRIDGE: PANEL_BRIDGE,
  applyDecision: applyDecision,
  bindGuest: bindGuest,
  boundsOf: boundsOf,
  create: create
}
