// Marketing home copied from https://scdo.com.au/ (site-v3, 2026-10).
// The wallet is already open, so the hero does not offer platform downloads.
// Live heights are passed in. A missing height stays an em dash.
'use strict'
;(function () {
  const CAT = './assets/site/cat-mascot-680.webp'
  const CAT_SM = './assets/site/cat-mascot-240.webp'
  const AVATAR = './assets/site/cat-avatar.png'
  // Official card tags. Same word in both languages, so they are not translation keys.
  const TAG_EVM = 'EVM'
  const TAG_CLS = 'Classic'

  function formatHeight (raw) {
    const s = String(raw == null ? '' : raw).trim()
    if (!s || s === '\u2014' || s === '-' || s === '--') return { text: '\u2014', dash: true }
    const n = Number(s.replace(/,/g, ''))
    if (!Number.isFinite(n) || n <= 0) return { text: '\u2014', dash: true }
    return { text: '#' + Math.trunc(n).toLocaleString('en-US'), dash: false }
  }

  function btn (act, v, cls, text, esc) {
    const extra = v ? ' data-v="' + esc(v) + '"' : ''
    return '<button type="button" class="' + cls + '" data-act="' + esc(act) + '"' + extra + '>' + esc(text) + '</button>'
  }

  function shardCard (cell, T, esc) {
    const n = Number(cell && cell.n)
    const evm = n === 0
    const name = 'Shard' + (evm ? '0' : String(n))
    const tag = evm ? TAG_EVM : TAG_CLS
    const desc = evm ? T('mktShard0Desc') : T('mktShardDesc')
    const latest = evm ? T('mktLatestEvm') : T('mktLatest')
    const fmt = formatHeight(cell && cell.height)
    const live = !!(cell && cell.live) && !fmt.dash
    return '<div class="mkt-shard" data-chain="' + n + '">' +
      '<div class="mkt-shard-top"><span class="mkt-name">' + esc(name) + '</span><span class="mkt-tag ' + (evm ? 'evm' : 'cls') + '">' + esc(tag) + '</span></div>' +
      '<p class="mkt-desc">' + esc(desc) + '</p>' +
      '<div class="mkt-ht"><span class="mkt-dot' + (live ? ' on' : '') + '"></span><span>' + esc(latest) + '</span> <span class="mkt-ch' + (fmt.dash ? ' dash' : '') + '">' + esc(fmt.text) + '</span></div>' +
      '</div>'
  }

  function shardsHtml (cells, T, esc) {
    return [0, 1, 2, 3, 4].map(n => {
      const hit = (cells || []).find(c => Number(c.n) === n) || { n: n, height: '', live: false }
      return shardCard(hit, T, esc)
    }).join('')
  }

  function step (n, title, body, actions, esc) {
    return '<div class="mkt-step"><span class="mkt-n">' + n + '</span><div><p class="mkt-t">' + esc(title) + '</p><p class="mkt-d">' + esc(body) + '</p><div class="mkt-step-go">' + actions + '</div></div></div>'
  }

  function game (title, body, act, v, go, esc) {
    return '<button type="button" class="mkt-game" data-act="' + esc(act) + '" data-v="' + esc(v) + '"><span class="mkt-game-body"><p class="mkt-t">' + esc(title) + '</p><p class="mkt-d">' + esc(body) + '</p></span><span class="mkt-btn mkt-ghost mkt-sm">' + esc(go) + '</span></button>'
  }

  function html (model, T, esc) {
    const cells = model && model.cells
    const steps = step(1, T('mktStep1t'), T('mktStep1d'),
      btn('create', '', 'mkt-btn mkt-ghost mkt-sm', T('mktCreate'), esc) + btn('import', '', 'mkt-btn mkt-ghost mkt-sm', T('mktImport'), esc), esc) +
      step(2, T('mktStep2t'), T('mktStep2d'), btn('backup', '', 'mkt-btn mkt-ghost mkt-sm', T('mktBackup'), esc), esc) +
      step(3, T('mktStep3t'), T('mktStep3d'), btn('nav', 'wallet', 'mkt-btn mkt-green mkt-sm', T('mktRecv'), esc) + btn('nav', 'remit', 'mkt-btn mkt-ghost mkt-sm', T('mktSend'), esc), esc)
    const games = game(T('mktGameH5t'), T('mktGameH5d'), 'site', 'games', T('mktPlay'), esc) +
      game(T('mktGameWheelT'), T('mktGameWheelD'), 'site', 'bounty', T('mktPlay'), esc) +
      game(T('mktGameQuestT'), T('mktGameQuestD'), 'siteUrl', 'https://scdo.com.au/start-quest/?src=home', T('mktPlay'), esc)
    return '<div class="mkt" id="mktHome">' +
      '<div class="mkt-hero">' +
        '<div class="mkt-txt"><span class="mkt-chip">' + esc(T('mktChip')) + '</span>' +
          '<h1>' + esc(T('mktH1a')) + '<br>' + esc(T('mktH1b')) + '</h1>' +
          '<p class="mkt-sub">' + esc(T('mktSub')) + '</p>' +
          '<p class="mkt-sub">' + btn('siteUrl', 'https://scdo.com.au/agent-ledger/', 'mkt-textlink', T('mktLedger'), esc) + '</p></div>' +
        '<div class="mkt-img"><img src="' + CAT + '" alt="' + esc(T('mktChip')) + '" width="340" height="340"></div>' +
        '<div class="mkt-actions">' +
          btn('nav', 'wallet', 'mkt-btn mkt-green', T('mktRecv'), esc) +
          btn('nav', 'remit', 'mkt-btn mkt-ghost', T('mktSend'), esc) +
          btn('site', 'membership', 'mkt-btn mkt-ghost', T('mktMemberBtn'), esc) +
        '</div>' +
        '<div class="mkt-pill"><button type="button" class="mkt-pillbtn" data-act="site" data-v="membership"><img src="' + AVATAR + '" alt="" width="36" height="36"><span>' + esc(T('mktMemberPill')) + '</span><b aria-hidden="true">\u2192</b></button></div>' +
      '</div>' +
      '<section class="mkt-sec">' +
        '<h2>' + esc(T('mktChainsH')) + '</h2>' +
        '<p class="mkt-lede">' + esc(T('mktChainsLede')) + '</p>' +
        '<div class="mkt-shards" id="siteShards">' + shardsHtml(cells, T, esc) + '</div>' +
        '<div class="mkt-exbar"><input id="siteSearchQ" type="search" maxlength="200" autocomplete="off" spellcheck="false" placeholder="' + esc(T('mktSearchPh')) + '">' +
          btn('siteSearch', '', 'mkt-btn mkt-green mkt-sm', T('mktSearch'), esc) +
          btn('site', 'explorer', 'mkt-btn mkt-ghost mkt-sm', T('mktExplorer'), esc) +
        '</div>' +
      '</section>' +
      '<section class="mkt-sec"><h2>' + esc(T('mktStepsH')) + '</h2><div class="mkt-steps">' + steps + '</div></section>' +
      '<section class="mkt-sec"><div class="mkt-band"><img src="' + CAT_SM + '" alt="" width="84" height="84"><p class="mkt-band-t">' + esc(T('mktMemberBand')) + '</p>' +
        btn('site', 'membership', 'mkt-btn mkt-green', T('mktMemberBtn'), esc) + '</div></section>' +
      '<section class="mkt-sec"><h2>' + esc(T('mktGamesH')) + '</h2><p class="mkt-lede">' + esc(T('mktGamesLede')) + '</p><div class="mkt-games">' + games + '</div></section>' +
      '<div class="mkt-foot"><p class="mkt-slogan">' + esc(T('mktSlogan')) + '</p><p class="mkt-slogan">' + esc(T('mktSlogan2')) + '</p>' +
        '<p class="mkt-foot-links">' +
          btn('siteUrl', 'https://scdo.com.au/privacy/', 'mkt-textlink', T('mktPrivacy'), esc) +
          '<span class="mkt-sep">\u00B7</span>' +
          btn('site', 'compliance', 'mkt-textlink', T('mktCompliance'), esc) +
          '<span class="mkt-sep">\u00B7</span>' +
          btn('site', 'transparency', 'mkt-textlink', T('mktTransparency'), esc) +
          '<span class="mkt-sep">\u00B7</span>' +
          btn('openDemo', 'tg', 'mkt-textlink', T('mktTelegram'), esc) +
        '</p></div>' +
      '</div>'
  }

  const api = { formatHeight: formatHeight, shardsHtml: shardsHtml, html: html, CAT: CAT }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (typeof window !== 'undefined') window.SCDOSiteHome = Object.freeze(api)
})()
