// In-app panel pages. links.hub is the panel home.
// The built-in home is https://scdo.com.au/wallet/hub/ until a signed wallet-ui.json says otherwise.
// A remote document is used only when its EIP-191 signature recovers to the pinned signer.
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
    help: '/wallet/help/'
  }
  const UI_URLS = [
    ORIGIN + '/wallet/wallet-ui.json',
    'https://apeccapital.org/wallet/wallet-ui.json'
  ]
  // Empty until the lab publishes the signer. Every remote document is ignored until then.
  const UI_SIGNER = ''
  const SIGN_PREFIX = 'SCDO Wallet UI v1\n'

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
    return { v: 1, links: links, cards: cards }
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
    if (proto !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) {
      return { action: 'drop', reason: 'scheme' }
    }
    const host = String(u.hostname || '').toLowerCase()
    if (HOSTS.indexOf(host) >= 0) return { action: 'allow', href: u.href }
    return { action: 'external', href: u.href }
  }

  function cleanLabel (value) {
    const s = String(value == null ? '' : value).replace(/[\u0000-\u001f]/g, '').trim()
    if (!s || s.length > 40 || /[<>]/.test(s)) return ''
    return s
  }

  function canonical (doc) {
    const links = {}
    Object.keys(doc && doc.links || {}).sort().forEach(function (k) { links[k] = String(doc.links[k]) })
    const cards = (doc && doc.cards || []).map(function (c) {
      return { id: String(c && c.id || ''), en: String(c && c.en || ''), cn: String(c && c.cn || '') }
    })
    return JSON.stringify({ v: 1, links: links, cards: cards })
  }

  function signMessage (doc) { return SIGN_PREFIX + canonical(doc) }

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
    return { v: 1, links: links, cards: cards }
  }

  function acceptSigned (raw, opts) {
    opts = opts || {}
    const signer = String(opts.signer || '').trim()
    if (!signer || typeof opts.verifyMessage !== 'function') return null
    let doc = raw
    if (typeof raw === 'string') {
      const text = raw.trim()
      if (!text || text.charAt(0) === '<') return null
      try { doc = JSON.parse(text) } catch (e) { return null }
    }
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null
    const sig = String(doc.sig || '')
    if (!/^0x[0-9a-fA-F]{130}$/.test(sig) && !/^0x[0-9a-fA-F]+$/.test(sig)) return null
    let recovered = ''
    try { recovered = opts.verifyMessage(signMessage(doc), sig) } catch (e) { return null }
    if (String(recovered || '').toLowerCase() !== signer.toLowerCase()) return null
    return materialize(doc)
  }

  let active = defaults()
  function current () { return active }
  function setCurrent (doc) {
    if (doc && doc.links && doc.links.hub && doc.cards) active = doc
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

  async function refresh (opts) {
    opts = opts || {}
    const urls = opts.urls || UI_URLS
    const fetchImpl = opts.fetchImpl
    const errors = []
    const signer = opts.signer != null ? opts.signer : UI_SIGNER
    let doc = null
    let from = 'default'
    let rawAccepted = ''
    if (typeof fetchImpl === 'function' && signer) {
      for (let i = 0; i < urls.length; i++) {
        try {
          const body = await fetchImpl(urls[i])
          const accepted = acceptSigned(body, { signer: signer, verifyMessage: opts.verifyMessage })
          if (accepted) {
            doc = accepted
            from = urls[i]
            rawAccepted = typeof body === 'string' ? body : JSON.stringify(body)
            break
          }
          errors.push(urls[i] + ': rejected')
        } catch (e) { errors.push(urls[i] + ': ' + ((e && e.message) || e)) }
      }
    } else if (!signer) errors.push('signer: empty')
    if (!doc && opts.cacheFile && signer) {
      try {
        const fs = opts.fs || require('fs')
        const cached = acceptSigned(JSON.parse(fs.readFileSync(opts.cacheFile, 'utf8')), { signer: signer, verifyMessage: opts.verifyMessage })
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
    UI_SIGNER: UI_SIGNER,
    defaults: defaults,
    samePaths: samePaths,
    panelQueryLang: panelQueryLang,
    withPanelLang: withPanelLang,
    classifyNavigation: classifyNavigation,
    canonical: canonical,
    signMessage: signMessage,
    acceptSigned: acceptSigned,
    materialize: materialize,
    current: current,
    setCurrent: setCurrent,
    cardsHtml: cardsHtml,
    refresh: refresh
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (typeof window !== 'undefined') window.SCDOWalletUi = api
})()
