// In-app panel pages and the signed live UI document.
// links.hub is the panel home. The built-in home is https://scdo.com.au/wallet/hub/
// until a signed wallet-ui.json says otherwise.
// A remote document is used only when its Ed25519 sig matches the update-feed public key.
'use strict'
;(function () {
  const HOSTS = ['scdo.com.au', 'apeccapital.org']
  const ORIGIN = 'https://scdo.com.au'
  const DEFAULT_HUB = ORIGIN + '/wallet/hub/'
  const PAGE_PATHS = {
    news: '/wallet/news/',
    events: '/wallet/events/',
    invite: '/wallet/invite/',
    agents: '/wallet/agents/',
    pool: '/wallet/pool/',
    help: '/wallet/help/',
    connect: '/wallet/connect/'
  }
  const UI_URLS = [
    'https://apeccapital.org/wallet/wallet-ui.json',
    ORIGIN + '/wallet/wallet-ui.json'
  ]
  const REFRESH_MS = 30 * 60 * 1000
  const VER_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?$/
  const ACTIONS = { 'open-url': 1, 'open-page': 1, 'start-agent': 1, invite: 1, claim: 1 }

  function defaults () {
    const links = { hub: DEFAULT_HUB }
    const cards = [
      { id: 'hub', en: 'Wallet hub', cn: '錢包總覽' },
      { id: 'news', en: 'News', cn: '消息' },
      { id: 'events', en: 'Events', cn: '活動' },
      { id: 'invite', en: 'Invite', cn: '邀請' },
      { id: 'agents', en: 'Agent ledger', cn: '智慧體賬本' },
      { id: 'pool', en: 'Bookkeeping pool', cn: '記帳池' },
      { id: 'help', en: 'Help', cn: '說明' }
    ]
    Object.keys(PAGE_PATHS).forEach(function (id) { links[id] = ORIGIN + PAGE_PATHS[id] })
    return {
      v: 1,
      links: links,
      cards: cards,
      strings: { en: {}, 'zh-Hant': {} },
      homeCards: [],
      banner: null,
      flags: {},
      minVersion: '',
      recommendedVersion: ''
    }
  }

  function samePaths (origin) {
    const root = String(origin || '').replace(/\/+$/, '')
    const links = { hub: root + '/wallet/hub/' }
    Object.keys(PAGE_PATHS).forEach(function (id) { links[id] = root + PAGE_PATHS[id] })
    return links
  }

  function panelQueryLang (lang) {
    const s = String(lang == null ? '' : lang).trim().toLowerCase()
    if (s === 'en' || s.indexOf('en-') === 0 || s.indexOf('en_') === 0) return 'en'
    return 'zh'
  }

  function withPanelLang (input, lang) {
    const raw = String(input || '')
    let u
    try { u = new URL(raw) } catch (e) { return raw }
    if (u.protocol !== 'https:') return u.href
    const want = panelQueryLang(lang)
    if (u.searchParams.get('lang') === want) return u.href
    u.searchParams.set('lang', want)
    return u.href
  }

  function classifyNavigation (input) {
    const raw = String(input || '').trim()
    if (!raw) return { action: 'drop', reason: 'empty' }
    let u
    try { u = new URL(raw) } catch (e) { return { action: 'drop', reason: 'url' } }
    const proto = String(u.protocol || '').toLowerCase()
    if (proto === 'scdowallet:') return { action: 'protocol', href: raw }
    if (proto === 'about:' && u.href === 'about:blank') return { action: 'allow', href: 'about:blank' }
    if (proto === 'tg:') {
      const href = u.href
      if (u.username || u.password || u.port || !u.hostname || !/^tg:\/\//i.test(href) || href.length > 2048) {
        return { action: 'drop', reason: 'scheme' }
      }
      return { action: 'external', href: href }
    }
    if (proto !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) {
      return { action: 'drop', reason: 'scheme' }
    }
    const host = String(u.hostname || '').toLowerCase()
    if (HOSTS.indexOf(host) >= 0) return { action: 'allow', href: u.href }
    return { action: 'external', href: u.href }
  }

  // Installer files stay out of the system browser and out of the panel.
  // The downloads directory page itself is still an official page.
  const INSTALLER_EXT = /\.(exe|dmg|appimage|msi|zip|deb|pkg|apk|sha256)$/i
  function isInstallerAsset (input) {
    const raw = String(input || '').trim()
    if (!raw) return false
    let u
    try { u = new URL(raw, ORIGIN) } catch (e) { return false }
    if (String(u.protocol || '').toLowerCase() !== 'https:') return false
    const host = String(u.hostname || '').toLowerCase()
    if (HOSTS.indexOf(host) < 0) return false
    let path = u.pathname || ''
    try { path = decodeURIComponent(path) } catch (e) {}
    path = path.toLowerCase()
    if (INSTALLER_EXT.test(path)) return true
    if (path === '/gpu-share/download' || path.indexOf('/gpu-share/download/') === 0) return true
    return false
  }

  function browseDecision (input) {
    const d = classifyNavigation(input)
    if (d.action === 'allow' && isInstallerAsset(d.href || input)) {
      return { action: 'suppress', href: d.href, reason: 'installer' }
    }
    return d
  }

  function cleanLabel (value) {
    const s = String(value == null ? '' : value).replace(/[\u0000-\u001f]/g, '').trim()
    if (!s || s.length > 40 || /[<>]/.test(s)) return ''
    return s
  }

  function cleanText (value, max) {
    if (typeof value !== 'string') return ''
    const s = value.replace(/[\u0000-\u001f]/g, '').trim()
    if (!s || s.length > max || /[<>]/.test(s)) return ''
    return s
  }

  function parseVer (s) {
    const m = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.]+))?$/.exec(String(s || '').trim())
    if (!m) return null
    return { major: +m[1], minor: m[2] ? +m[2] : 0, patch: m[3] ? +m[3] : 0, pre: m[4] || '' }
  }
  function compareVer (a, b) {
    const pa = parseVer(a)
    const pb = parseVer(b)
    if (!pa || !pb) return 0
    if (pa.major !== pb.major) return pa.major > pb.major ? 1 : -1
    if (pa.minor !== pb.minor) return pa.minor > pb.minor ? 1 : -1
    if (pa.patch !== pb.patch) return pa.patch > pb.patch ? 1 : -1
    if (pa.pre === pb.pre) return 0
    if (!pa.pre) return 1
    if (!pb.pre) return -1
    return pa.pre < pb.pre ? -1 : 1
  }

  function takeStrings (raw) {
    const out = { en: {}, 'zh-Hant': {} }
    if (raw == null) return out
    if (typeof raw !== 'object' || Array.isArray(raw)) return null
    const locs = ['en', 'zh-Hant']
    for (let i = 0; i < locs.length; i++) {
      const loc = locs[i]
      const pack = raw[loc]
      if (pack == null) continue
      if (typeof pack !== 'object' || Array.isArray(pack)) return null
      const keys = Object.keys(pack)
      for (let k = 0; k < keys.length; k++) {
        const key = keys[k]
        if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key)) continue
        const value = pack[key]
        if (typeof value !== 'string') continue
        const text = cleanText(value, 400)
        if (!text) continue
        out[loc][key] = text
      }
    }
    return out
  }

  function takeAction (action, links) {
    if (!action || typeof action !== 'object' || Array.isArray(action)) return null
    const type = action.type
    if (!ACTIONS[type]) return null
    if (type === 'open-url') {
      const decision = classifyNavigation(action.url)
      if (decision.action !== 'allow') return null
      return { type: 'open-url', url: decision.href }
    }
    if (type === 'open-page') {
      const page = String(action.page || '')
      if (!/^[a-z][a-z0-9-]{0,31}$/.test(page) || !links[page]) return null
      return { type: 'open-page', page: page }
    }
    if (action.url || action.page) return null
    return { type: type }
  }

  function takeHomeCards (list, links) {
    if (list == null) return []
    if (!Array.isArray(list)) return null
    if (list.length > 12) return null
    const out = []
    for (let i = 0; i < list.length; i++) {
      const c = list[i]
      if (!c || typeof c !== 'object') return null
      const id = String(c.id || '')
      if (!/^[a-z][a-z0-9-]{0,31}$/.test(id)) return null
      const title = {
        en: cleanText(c.title && c.title.en, 80),
        'zh-Hant': cleanText(c.title && c.title['zh-Hant'], 80)
      }
      if (!title.en || !title['zh-Hant']) return null
      const body = {
        en: cleanText(c.body && c.body.en, 280),
        'zh-Hant': cleanText(c.body && c.body['zh-Hant'], 280)
      }
      const cta = {
        en: cleanText(c.cta && c.cta.en, 40) || title.en,
        'zh-Hant': cleanText(c.cta && c.cta['zh-Hant'], 40) || title['zh-Hant']
      }
      const icon = c.icon == null || c.icon === '' ? '' : String(c.icon)
      if (icon && !/^[a-z0-9-]{1,24}$/.test(icon)) return null
      const action = takeAction(c.action, links)
      if (!action) return null
      out.push({ id: id, title: title, body: body, icon: icon, cta: cta, action: action })
    }
    return out
  }

  function takeBanner (banner) {
    if (banner == null) return null
    if (typeof banner !== 'object' || Array.isArray(banner)) return false
    const id = String(banner.id || '')
    if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,40}$/.test(id)) return false
    const en = cleanText(banner.en, 280)
    const zh = cleanText(banner['zh-Hant'], 280)
    if (!en || !zh) return false
    return { id: id, en: en, 'zh-Hant': zh }
  }

  function takeFlags (flags) {
    if (flags == null) return {}
    if (typeof flags !== 'object' || Array.isArray(flags)) return null
    const out = {}
    const keys = Object.keys(flags)
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]
      if (!/^[a-z][A-Za-z0-9]{0,31}$/.test(key)) return null
      if (typeof flags[key] !== 'boolean') return null
      out[key] = flags[key]
    }
    return out
  }

  function takeVer (value) {
    if (value == null || value === '') return ''
    if (typeof value !== 'string' || !VER_RE.test(value)) return null
    return value
  }

  function materialize (signed) {
    const base = defaults()
    const links = {}
    Object.keys(base.links).forEach(function (k) { links[k] = base.links[k] })
    const incoming = signed && signed.links || {}
    const keys = Object.keys(incoming)
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]
      if (!/^[a-z][a-z0-9-]{0,31}$/.test(key)) return null
      const decision = classifyNavigation(incoming[key])
      if (decision.action !== 'allow') return null
      links[key] = decision.href
    }
    let cards = base.cards
    if (Array.isArray(signed.cards) && signed.cards.length) {
      cards = []
      for (let i = 0; i < signed.cards.length; i++) {
        const c = signed.cards[i] || {}
        const id = String(c.id || '')
        if (!links[id]) return null
        const en = cleanLabel(c.en)
        const cn = cleanLabel(c.cn)
        if (!en || !cn) return null
        cards.push({ id: id, en: en, cn: cn })
      }
    }
    if (classifyNavigation(links.hub).action !== 'allow') return null
    const strings = takeStrings(signed.strings)
    const homeCards = takeHomeCards(signed.homeCards, links)
    const banner = takeBanner(signed.banner)
    const flags = takeFlags(signed.flags)
    const minVersion = takeVer(signed.minVersion)
    const recommendedVersion = takeVer(signed.recommendedVersion)
    if (!strings || !homeCards || banner === false || !flags || minVersion == null || recommendedVersion == null) return null
    return {
      v: 1,
      links: links,
      cards: cards,
      strings: strings,
      homeCards: homeCards,
      banner: banner,
      flags: flags,
      minVersion: minVersion,
      recommendedVersion: recommendedVersion
    }
  }

  function verifyDoc (doc, opts) {
    opts = opts || {}
    let uiSign = null
    try { uiSign = require('../config/uiSign') } catch (e) { uiSign = null }
    if (!uiSign || typeof uiSign.verifySigned !== 'function') return false
    return uiSign.verifySigned(doc, { publicKey: opts.publicKey }).ok === true
  }

  function acceptSigned (raw, opts) {
    opts = opts || {}
    let doc = raw
    if (typeof raw === 'string') {
      const text = raw.trim()
      if (!text || text.charAt(0) === '<') return null
      try { doc = JSON.parse(text) } catch (e) { return null }
    }
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null
    if (!verifyDoc(doc, opts)) return null
    return materialize(doc)
  }

  let active = defaults()
  function current () { return active }
  function setCurrent (doc) {
    if (doc && doc.links && doc.links.hub && doc.cards) active = doc
  }

  function flagOn (doc, name) {
    const flags = doc && doc.flags
    if (!flags || !Object.prototype.hasOwnProperty.call(flags, name)) return true
    return flags[name] !== false
  }

  // Every named flag must be on. A missing name stays on.
  function flagsAllow (doc, names) {
    const list = names || []
    for (let i = 0; i < list.length; i++) if (!flagOn(doc, list[i])) return false
    return true
  }

  function versionNote (doc, shell) {
    if (!doc) return ''
    if (doc.minVersion && compareVer(shell, doc.minVersion) < 0) return 'min'
    if (doc.recommendedVersion && compareVer(shell, doc.recommendedVersion) < 0) return 'rec'
    return ''
  }

  function cardsHtml (doc, opts) {
    opts = opts || {}
    const esc = opts.esc || function (s) { return String(s == null ? '' : s) }
    const lang = opts.lang === 'en' ? 'en' : 'cn'
    const title = opts.title || (lang === 'en' ? 'Wallet hub' : '錢包總覽')
    const list = (doc && doc.cards || []).filter(function (c) { return c && c.id && c.id !== 'hub' })
    const buttons = list.map(function (c) {
      const label = lang === 'en' ? c.en : c.cn
      return '<button type="button" class="panel-card" data-act="panelOpen" data-v="' + esc(c.id) + '">' + esc(label) + '</button>'
    }).join('')
    return '<section class="panel-section" id="panelCards"><button type="button" class="panel-head" data-act="panelOpen" data-v="hub">' + esc(title) + '</button><div class="panel-cards">' + buttons + '</div></section>'
  }

  function homeCardsHtml (doc, opts) {
    opts = opts || {}
    const esc = opts.esc || function (s) { return String(s == null ? '' : s) }
    const loc = opts.lang === 'en' ? 'en' : 'zh-Hant'
    const list = (doc && doc.homeCards) || []
    if (!list.length) return ''
    const cards = list.map(function (c) {
      const title = (c.title && c.title[loc]) || ''
      const body = (c.body && c.body[loc]) || ''
      const cta = (c.cta && c.cta[loc]) || title
      const icon = c.icon ? ' live-ico-' + c.icon : ''
      return '<article class="live-card' + icon + '"><h2>' + esc(title) + '</h2><p>' + esc(body) + '</p><button type="button" class="shell-act" data-act="liveCard" data-v="' + esc(c.id) + '">' + esc(cta) + '</button></article>'
    }).join('')
    return '<section class="live-cards" id="liveCards">' + cards + '</section>'
  }

  function bannerHtml (doc, opts) {
    opts = opts || {}
    const esc = opts.esc || function (s) { return String(s == null ? '' : s) }
    const banner = doc && doc.banner
    if (!banner) return ''
    const loc = opts.lang === 'en' ? 'en' : 'zh-Hant'
    const text = banner[loc] || ''
    if (!text) return ''
    return '<div class="live-banner" id="liveBanner" role="status">' + esc(text) + '</div>'
  }

  async function refresh (opts) {
    opts = opts || {}
    const urls = opts.urls || UI_URLS
    const fetchImpl = opts.fetchImpl
    const errors = []
    let doc = null
    let from = 'default'
    let rawAccepted = ''
    if (typeof fetchImpl === 'function') {
      for (let i = 0; i < urls.length; i++) {
        try {
          const body = await fetchImpl(urls[i])
          const accepted = acceptSigned(body, { publicKey: opts.publicKey })
          if (accepted) {
            doc = accepted
            from = urls[i]
            rawAccepted = typeof body === 'string' ? body : JSON.stringify(body)
            break
          }
          errors.push(urls[i] + ': rejected')
        } catch (e) { errors.push(urls[i] + ': ' + ((e && e.message) || e)) }
      }
    }
    if (!doc && opts.cacheFile) {
      try {
        const fs = opts.fs || require('fs')
        const cached = acceptSigned(JSON.parse(fs.readFileSync(opts.cacheFile, 'utf8')), { publicKey: opts.publicKey })
        if (cached) { doc = cached; from = 'cache' }
      } catch (e) { errors.push('cache: ' + ((e && e.message) || e)) }
    }
    if (!doc) doc = defaults()
    if (doc && opts.cacheFile && from !== 'default' && from !== 'cache') {
      try {
        const fs = opts.fs || require('fs')
        const path = opts.path || require('path')
        fs.mkdirSync(path.dirname(opts.cacheFile), { recursive: true })
        fs.writeFileSync(opts.cacheFile, rawAccepted || JSON.stringify(doc))
      } catch (e) { errors.push('write: ' + ((e && e.message) || e)) }
    }
    setCurrent(doc)
    return { doc: doc, from: from, errors: errors }
  }

  const api = {
    HOSTS: HOSTS,
    DEFAULT_HUB: DEFAULT_HUB,
    PAGE_PATHS: PAGE_PATHS,
    UI_URLS: UI_URLS,
    REFRESH_MS: REFRESH_MS,
    defaults: defaults,
    samePaths: samePaths,
    panelQueryLang: panelQueryLang,
    withPanelLang: withPanelLang,
    classifyNavigation: classifyNavigation,
    isInstallerAsset: isInstallerAsset,
    browseDecision: browseDecision,
    acceptSigned: acceptSigned,
    materialize: materialize,
    current: current,
    setCurrent: setCurrent,
    flagOn: flagOn,
    flagsAllow: flagsAllow,
    versionNote: versionNote,
    cardsHtml: cardsHtml,
    homeCardsHtml: homeCardsHtml,
    bannerHtml: bannerHtml,
    refresh: refresh
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (typeof window !== 'undefined') window.SCDOWalletUi = api
})()
