// One list for the window menu, the in-app function bar, and AI小貓.
// Names follow the scdoscan.io home navigation. A wallet screen opens inside the app.
// Anything the wallet does not do opens that page in the browser.
// Labels that say GPU or 算力 live here, not in the translation table.
'use strict'
;(function () {
  const ORIGIN = 'https://scdoscan.io'

  const GROUPS = [
    { id: 'home', cn: '首頁', en: 'Home', action: 'home' },
    { id: 'gpu', cn: 'GPU 共享', en: 'GPU share', href: '/gpu-share/?ref=nav' },
    {
      id: 'wallets', cn: '錢包', en: 'Wallet', children: [
        { id: 'receive', cn: '收款', en: 'Receive', action: 'recv' },
        { id: 'remit', cn: '匯款', en: 'Send', action: 'remit' },
        { id: 'settings', cn: '設定', en: 'Settings', action: 'settings' },
        { id: 'create', cn: '建立新地址', en: 'Create address', action: 'create' },
        { id: 'import', cn: '匯入錢包', en: 'Import wallet', action: 'import' }
      ]
    },
    { id: 'games', cn: '遊戲', en: 'Games', href: '/games/' },
    {
      id: 'chain', cn: '區塊鏈', en: 'Blockchain', children: [
        { id: 'blocks', cn: '區塊', en: 'Blocks', href: '/#/blocks' },
        { id: 'txs', cn: '交易', en: 'Transactions', href: '/#/txs' },
        { id: 'tokens', cn: '代幣', en: 'Tokens', href: '/#/tokens' },
        { id: 'gas', cn: 'Gas 追蹤', en: 'Gas tracker', href: '/gastracker' }
      ]
    },
    {
      id: 'mining', cn: '運算服務', en: 'Mining', children: [
        { id: 'mine', cn: '運算服務', en: 'Mining', action: 'mineHome' },
        { id: 'pool', cn: '算力中心', en: 'Hashrate centre', href: '/pool/' },
        { id: 'nodes', cn: '算力服務分支', en: 'Node service', action: 'mineSettings' }
      ]
    },
    {
      id: 'prod', cn: '產品', en: 'Products', children: [
        { id: 'launch', cn: '代幣發行', en: 'Token launch', href: '/launch' },
        { id: 'enterprise', cn: '企業服務', en: 'Enterprise', href: '/enterprise/' },
        { id: 'membership', cn: '會員', en: 'Membership', href: '/membership/' }
      ]
    },
    {
      id: 'dev', cn: '開發者', en: 'Developers', children: [
        { id: 'api', cn: 'API', en: 'API', href: '/#/about' },
        { id: 'verify', cn: '驗證並發布', en: 'Verify and publish', href: '/verify-contract.html' }
      ]
    },
    {
      id: 'res', cn: '資源', en: 'Resources', children: [
        { id: 'start', cn: '新手入門', en: 'Getting started', href: '/start.html' },
        { id: 'blog', cn: '部落格', en: 'Blog', href: '/blog/' },
        { id: 'papers', cn: '論文', en: 'Papers', href: '/papers/' },
        { id: 'ip', cn: '我的 IP', en: 'My IP', href: '/ip/' },
        { id: 'bounty', cn: '漏洞賞金', en: 'Bug bounty', href: '/bounty/' },
        { id: 'agents', cn: '智慧體賬本', en: 'Agent ledger', href: '/agents/' }
      ]
    },
    {
      id: 'about', cn: '關於', en: 'About', children: [
        { id: 'team', cn: '團隊', en: 'Team', href: '/team/' },
        { id: 'roadmap', cn: '路線圖', en: 'Roadmap', href: '/roadmap/' },
        { id: 'partners', cn: '合作夥伴', en: 'Partners', href: '/partners' },
        { id: 'transparency', cn: '透明中心', en: 'Transparency', href: '/transparency/' },
        { id: 'compliance', cn: '合規', en: 'Compliance', href: '/compliance.html' },
        { id: 'investors', cn: '投資者關係', en: 'Investors', href: '/investors/' }
      ]
    }
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

  function byId (id) {
    return flat().find(it => it.id === id) || null
  }

  function match (text) {
    const q = String(text == null ? '' : text).replace(/\s+/g, ' ').trim()
    if (!q) return null
    const lower = q.toLowerCase()
    return flat().find(it => it.cn === q || String(it.en).toLowerCase() === lower) || null
  }

  const api = { ORIGIN: ORIGIN, GROUPS: GROUPS, url: url, flat: flat, byId: byId, match: match }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (typeof window !== 'undefined') window.SCDOSiteNav = Object.freeze(api)
})()
