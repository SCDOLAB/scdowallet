// One list for the window menu, the in-app function bar, and AI小貓.
// Names and destinations follow https://scdo.com.au/config/site-functions.json (2026-10).
// A wallet screen opens inside the app. Official pages on scdo.com.au open in the in-app panel.
// Anything on another host opens in the browser. Labels that say GPU or 算力 live here, not in the translation table.
'use strict'
;(function () {
  const ORIGIN = 'https://scdo.com.au'
  // Temporary pages. Each address lives only here.
  const MEMBERSHIP_URL = 'https://scdo.com.au/membership/'
  const OTC_URL = 'https://scdo.com.au/membership/'
  // Home invite QR. /wallet/ is the SCDO Wallet product (use it, or download the desktop app).
  // g.js on that page stores ?ref= and ?src=, the same params /join accepts.
  // /wallet/connect/ is a list of other products and is not this link.
  const REFERRAL_URL = 'https://scdo.com.au/wallet/'

  const GROUPS = [
    { id: 'home', cn: '首頁', en: 'Home', action: 'home' },
    { id: 'gpu', cn: 'GPU 共享', en: 'GPU Share', href: '/gpu-share/', barSingle: true },
    {
      id: 'wallets', cn: '錢包', en: 'Wallets', href: '/wallets/', action: 'wallet', barSingle: true, children: [
        { id: 'wallet', cn: '收款與匯款', en: 'Receive & Send', action: 'wallet', ask: ['收款', '匯款', 'Receive', 'Send'] },
        { id: 'walletSite', cn: '錢包產品頁', en: 'Wallet product page', href: '/wallets/' },
        { id: 'payInvoice', cn: '支付發票', en: 'Pay invoice', action: 'payInvoice' },
        { id: 'connect', cn: '連接錢包與 Agent', en: 'Connected wallets & agents', action: 'connect', ask: ['連接錢包', 'Connect'] },
        { id: 'settings', cn: '設定', en: 'Settings', action: 'settings' },
        { id: 'create', cn: '建立新地址', en: 'Create address', action: 'create' },
        { id: 'import', cn: '匯入錢包', en: 'Import wallet', action: 'import' }
      ]
    },
    { id: 'games', cn: '遊戲', en: 'Games', href: '/games/', barSingle: true },
    { id: 'treasury', cn: '金庫', en: 'Treasury', href: '/treasury/', barSingle: true },
    {
      id: 'chain', cn: '區塊鏈', en: 'Blockchain', children: [
        { id: 'explorer', cn: '區塊瀏覽器', en: 'Explorer', href: '/scan/' },
        { id: 'blocks', cn: '區塊', en: 'Blocks', href: '/scan/#/blocks' },
        { id: 'txs', cn: '交易', en: 'Transactions', href: '/scan/#/txs' },
        { id: 'tokens', cn: '代幣', en: 'Tokens', href: '/scan/#/tokens' },
        { id: 'gas', cn: 'Gas 追蹤', en: 'Gas Tracker', href: '/gastracker' }
      ]
    },
    {
      id: 'mining', cn: '運算服務', en: 'Compute', children: [
        { id: 'mine', cn: '運算服務', en: 'Compute', href: '/mine/', action: 'mineHome', ask: ['記帳', 'Bookkeeping'] },
        { id: 'pool', cn: '算力中心', en: 'Pool', href: '/pool/' },
        { id: 'nodes', cn: '算力服務分支', en: 'Nodes', href: '/nodes/' },
        { id: 'localNode', cn: '本機記帳節點', en: 'Bookkeeping node on this computer', action: 'mineSettings' }
      ]
    },
    {
      id: 'prod', cn: '產品', en: 'Products', children: [
        { id: 'launch', cn: '代幣發行', en: 'Launch', href: '/launch' },
        { id: 'enterprise', cn: '企業服務', en: 'Enterprise', href: '/enterprise/' },
        { id: 'membership', cn: '會員', en: 'Membership', href: MEMBERSHIP_URL, withAddress: true, ask: ['開會員', '開通會員'] },
        { id: 'otc', cn: '向 SCDO OTC 購買 SCDO', en: 'Buy SCDO from SCDO OTC', href: OTC_URL, withAddress: true, ask: ['我想買 SCDO'] }
      ]
    },
    {
      id: 'dev', cn: '開發者', en: 'Developers', children: [
        { id: 'api', cn: 'API', en: 'API', href: '/api-docs.html' },
        { id: 'verify', cn: '驗證並發布', en: 'Verify & Publish', href: '/verify-contract.html' }
      ]
    },
    {
      id: 'res', cn: '資源', en: 'Resources', children: [
        { id: 'start', cn: '新手入門', en: 'Get Started', href: '/start.html' },
        { id: 'blog', cn: '部落格', en: 'Blog', href: '/blog/' },
        { id: 'papers', cn: '論文', en: 'Papers', href: '/papers/' },
        { id: 'docs', cn: '文檔', en: 'Docs', href: 'https://scdo-laboratory.gitbook.io/scdolab' },
        { id: 'ip', cn: '我的 IP', en: 'My IP', href: '/ip/' },
        { id: 'bounty', cn: '漏洞賞金', en: 'Bug Bounty', href: '/games/stakewheel/' },
        { id: 'agents', cn: '智慧體帳本', en: 'Agents', href: '/agents/' }
      ]
    },
    {
      id: 'about', cn: '關於', en: 'About', children: [
        { id: 'team', cn: '團隊', en: 'Team', href: '/team/' },
        { id: 'roadmap', cn: '路線圖', en: 'Roadmap', href: '/roadmap/' },
        { id: 'partners', cn: '合作夥伴', en: 'Partners', href: '/partners' },
        { id: 'transparency', cn: '透明中心', en: 'Transparency', href: '/transparency/' },
        { id: 'compliance', cn: '合規', en: 'Compliance', href: '/compliance.html' },
        { id: 'investors', cn: '投資者關係', en: 'Investor Relations', href: '/investors/' }
      ]
    }
  ]

  // Old receive / remit ids still resolve so a deep link lands on the combined page.
  const LEGACY = [
    { id: 'receive', cn: '收款', en: 'Receive', action: 'recv' },
    { id: 'remit', cn: '匯款', en: 'Send', action: 'remit' }
  ]

  // Known to the cat, not shown in the window menu or the top function bar.
  const EXTRAS = [
    { id: 'referral', cn: '邀請好友', en: 'Invite a friend', href: REFERRAL_URL, referral: true, ask: ['邀請好友'] }
  ]

  function url (href) {
    const h = String(href || '')
    if (/^https?:\/\//i.test(h)) return h
    return ORIGIN + (h.charAt(0) === '/' ? h : '/' + h)
  }

  function flat () {
    const out = []
    for (const g of GROUPS) {
      out.push(g)
      for (const c of g.children || []) out.push(c)
    }
    return out
  }

  function listed () {
    return flat().concat(EXTRAS)
  }

  function byId (id) {
    return listed().find(it => it.id === id) || LEGACY.find(it => it.id === id) || null
  }

  function match (text) {
    const q = String(text == null ? '' : text).replace(/\s+/g, ' ').trim()
    if (!q) return null
    const lower = q.toLowerCase()
    return listed().find(it => {
      if (it.cn === q || String(it.en).toLowerCase() === lower) return true
      return (it.ask || []).some(a => a === q || String(a).toLowerCase() === lower)
    }) || null
  }

  function referral (address) {
    const u = new URL(REFERRAL_URL)
    const addr = String(address || '').trim()
    if (addr && !/^https?:/i.test(addr)) u.searchParams.set('ref', addr)
    u.searchParams.set('src', 'wallet')
    return u.toString()
  }

  // A ledger shareUrl is often https://scdo.com.au/join?ref=CODE. Keep that ref
  // and open the wallet product page instead of the bare join page.
  function referralFrom (raw) {
    const text = String(raw || '').trim()
    if (!text) return referral('')
    try {
      const u = new URL(text)
      const host = String(u.hostname || '').toLowerCase()
      if (u.protocol === 'https:' && (host === 'scdo.com.au' || host === 'apeccapital.org') && !u.username && !u.password && (!u.port || u.port === '443')) {
        const ref = u.searchParams.get('ref') || ''
        if (host === 'scdo.com.au' && (u.pathname === '/wallet' || u.pathname === '/wallet/')) {
          if (!u.searchParams.get('src')) u.searchParams.set('src', 'wallet')
          return u.toString()
        }
        return referral(ref)
      }
    } catch (e) {}
    return referral(text)
  }

  // Membership and buying SCDO add the wallet language and the selected Shard1 Classic address.
  function visit (id, opts) {
    const it = byId(id)
    if (!it || !it.href) return ''
    const base = url(it.href)
    if (!it.withAddress) return base
    opts = opts || {}
    const u = new URL(base)
    const raw = String(opts.lang || '')
    u.searchParams.set('lang', raw === 'en' || raw === 'EN' ? 'en' : 'zh-TW')
    const address = String(opts.address || '').trim()
    if (address) u.searchParams.set('address', address)
    return u.toString()
  }

  // Desktop extras stay inside the app. Every other entry with a URL is the official page.
  const NATIVE_IDS = { wallet: 1, recv: 1, remit: 1, settings: 1, create: 1, import: 1, connect: 1, payInvoice: 1, localNode: 1 }
  function opensOfficial (it) {
    if (!it || !it.href) return false
    if (NATIVE_IDS[it.id]) return false
    return true
  }

  const api = { ORIGIN: ORIGIN, MEMBERSHIP_URL: MEMBERSHIP_URL, OTC_URL: OTC_URL, REFERRAL_URL: REFERRAL_URL, GROUPS: GROUPS, url: url, visit: visit, referral: referral, referralFrom: referralFrom, flat: flat, byId: byId, match: match, opensOfficial: opensOfficial }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (typeof window !== 'undefined') window.SCDOSiteNav = Object.freeze(api)
})()
