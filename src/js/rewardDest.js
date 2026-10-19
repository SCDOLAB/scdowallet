// Reward destination (記帳獎勵去向) section of 記帳設定 / Bookkeeping settings.
// Two independent toggles, both OFF by default: A) auto-join wheel, B) lend to treasury for interest.
// 3.1.13: both toggles are disabled and greyed with "Coming soon" / 「即將推出」 until the main process reports
// active.wheel / active.lend (server capability live + production backend in this build). While a feature is not
// active, its sub-screen cannot be opened and every action is refused here and again in the main process.
// Store builds (App Store / Play / store): flags come back false and nothing is drawn.
'use strict'
;(function () {
  const SD = window.SafeDom
  const esc = SD.esc
  const STR = {
    EN: {
      title: 'Reward destination',
      lead: 'Choose where your bookkeeping rewards go. Both are off unless you turn them on, and you can change them at any time.',
      comingSoon: 'Coming soon',
      comingSoonHint: 'Not available yet. This option can be turned on once the service is live.',
      wheelName: 'Auto-join wheel',
      wheelSub: 'Use SCDO rewards to join the Games Ledger wheel automatically, 1 round per minute (paid through x402 in SCDO).',
      lendName: 'Lend to treasury for interest',
      lendSub: 'Lend SCDO rewards through x402 and earn interest, booked to your agent. Withdraw your principal at any time.',
      open: 'Open',
      back: '\u2190 Reward destination',
      on: 'On', off: 'Off',
      wheelRisk: 'Each round can lose its stake. Results are random. Only use rewards you can afford to lose.',
      stake: 'Stake per round (SCDO)',
      lossLimit: 'Loss limit (SCDO) \u2014 stops when net loss would pass this',
      sessionLimit: 'Session limit (minutes) \u2014 stops after this long',
      save: 'Save limits',
      saved: 'Saved',
      start: 'Start',
      stop: 'STOP',
      stopHint: 'Stop ends the session at once. No new rounds start.',
      running: 'Running', stopped: 'Stopped',
      rounds: 'Rounds', staked: 'Staked', won: 'Paid out', net: 'Net',
      last: 'Last round', stoppedBy: 'Stopped by',
      by_user: 'you', by_lossLimit: 'loss limit', by_session: 'session limit',
      results: 'Results are posted to the on-chain chat and the Games Ledger.',
      rateLabel: 'Current rate, not guaranteed',
      rateNone: 'Rate not available right now.',
      rateNote: 'The rate is variable and read from the server. It can change at any time. No return is promised.',
      payer: 'Interest is paid from the subsidy wallet, never the treasury.',
      ledgerTitle: 'Lending record',
      lent: 'Lent', interest: 'Interest booked', withdrawn: 'Withdrawn', balance: 'Balance',
      amount: 'Amount (SCDO)',
      lendNow: 'Lend now',
      withdraw: 'Withdraw',
      withdrawAll: 'Withdraw all',
      withdrawHint: 'You can withdraw your principal at any time.',
      empty: 'No records yet.',
      k_lent: 'Lent', k_interest: 'Interest booked', k_withdrawn: 'Withdrawn',
      err_stake: 'Enter a stake above 0.', err_lossLimit: 'Enter a loss limit above 0.', err_lossBelowStake: 'The loss limit must be at least one stake.',
      err_session: 'Session limit is 1 to 240 minutes.', err_amount: 'Enter an amount above 0.', err_off: 'Turn this on first.',
      err_insufficient: 'That is more than your balance.', err_unavailable: 'Not available right now.', err_payer_is_treasury: 'Blocked: the server named the treasury as the interest payer.',
      err_coming_soon: 'Coming soon',
      err_region_blocked: 'Not available in your region',
      err_pool_paused: 'Wheel paused, pool refilling',
      poolPausedHint: 'Auto-bet is paused. It will retry when the pool is above 501 SCDO.',
      err: 'Something went wrong: {e}'
    },
    CN: {
      title: '\u734e\u52f5\u53bb\u5411',
      lead: '\u9078\u64c7\u8a18\u5e33\u734e\u52f5\u8981\u53bb\u54ea\u88e1\u3002\u5169\u9805\u90fd\u8981\u4f60\u81ea\u5df1\u6253\u958b\u624d\u6703\u751f\u6548\uff0c\u96a8\u6642\u53ef\u4ee5\u66f4\u6539\u3002',
      comingSoon: '\u5373\u5c07\u63a8\u51fa',
      comingSoonHint: '\u5c1a\u672a\u958b\u653e\uff0c\u670d\u52d9\u4e0a\u7dda\u5f8c\u5c31\u53ef\u4ee5\u958b\u555f\u3002',
      wheelName: '\u81ea\u52d5\u53c3\u52a0\u8f49\u76e4',
      wheelSub: '\u7528 SCDO \u734e\u52f5\u81ea\u52d5\u53c3\u52a0 Games Ledger \u8f49\u76e4\uff08\u6bcf\u5206\u9418 1 \u5c40\uff0c\u7d93 x402 \u4ee5 SCDO \u652f\u4ed8\uff09\u3002',
      lendName: '\u501f\u7d66\u570b\u5eab\u751f\u606f',
      lendSub: '\u7d93 x402 \u628a SCDO \u734e\u52f5\u501f\u51fa\uff0c\u5229\u606f\u8a18\u5165\u4f60\u7684\u4ee3\u7406\u3002\u672c\u91d1\u96a8\u6642\u53ef\u64a4\u56de\u3002',
      open: '\u958b\u555f',
      back: '\u2190 \u734e\u52f5\u53bb\u5411',
      on: '\u958b', off: '\u95dc',
      wheelRisk: '\u6bcf\u5c40\u90fd\u53ef\u80fd\u8f38\u6389\u8a3b\u8a3c\u91d1\u3002\u7d50\u679c\u662f\u96a8\u6a5f\u7684\u3002\u53ea\u7528\u4f60\u4e1f\u5f97\u8d77\u7684\u734e\u52f5\u3002',
      stake: '\u6bcf\u5c40\u8a3b\u8a3c\uff08SCDO\uff09',
      lossLimit: '\u8667\u640d\u4e0a\u9650\uff08SCDO\uff09\u2014\u6de8\u8667\u640d\u5c07\u8d85\u904e\u6642\u505c\u6b62',
      sessionLimit: '\u6703\u8a71\u4e0a\u9650\uff08\u5206\u9418\uff09\u2014\u6642\u9593\u5230\u5c31\u505c',
      save: '\u5132\u5b58\u4e0a\u9650',
      saved: '\u5df2\u5132\u5b58',
      start: '\u958b\u59cb',
      stop: '\u505c\u6b62',
      stopHint: '\u6309\u505c\u6b62\u6703\u7acb\u5373\u7d50\u675f\u6703\u8a71\uff0c\u4e0d\u518d\u958b\u65b0\u5c40\u3002',
      running: '\u9032\u884c\u4e2d', stopped: '\u5df2\u505c',
      rounds: '\u5c40\u6578', staked: '\u5df2\u8a3b\u8a3c', won: '\u5df2\u6d3e\u5f69', net: '\u6de8\u984d',
      last: '\u4e0a\u4e00\u5c40', stoppedBy: '\u505c\u6b62\u539f\u56e0',
      by_user: '\u4f60', by_lossLimit: '\u8667\u640d\u4e0a\u9650', by_session: '\u6703\u8a71\u4e0a\u9650',
      results: '\u7d50\u679c\u6703\u767c\u5230\u93c8\u4e0a\u804a\u5929\u8207 Games Ledger\u3002',
      rateLabel: '\u7576\u524d\u5229\u7387\uff0c\u4e0d\u4fdd\u8b49',
      rateNone: '\u76ee\u524d\u6c92\u6709\u5229\u7387\u3002',
      rateNote: '\u5229\u7387\u70ba\u6d6e\u52d5\uff0c\u7531\u4f3a\u670d\u5668\u8b80\u53d6\uff0c\u96a8\u6642\u53ef\u8b8a\u3002\u4e0d\u4fdd\u8b49\u56fa\u5b9a\u6216\u627f\u8afe\u7684\u56de\u5831\u3002',
      payer: '\u5229\u606f\u7531\u88dc\u8cbc\u9322\u5305\u652f\u4ed8\uff0c\u7d55\u4e0d\u5f9e\u570b\u5eab\u652f\u4ed8\u3002',
      ledgerTitle: '\u501f\u8cb8\u7d00\u9304',
      lent: '\u5df2\u501f\u51fa', interest: '\u5df2\u8a08\u5229', withdrawn: '\u5df2\u64a4\u56de', balance: '\u9918\u984d',
      amount: '\u91d1\u984d\uff08SCDO\uff09',
      lendNow: '\u73fe\u5728\u501f\u51fa',
      withdraw: '\u64a4\u56de',
      withdrawAll: '\u5168\u90e8\u64a4\u56de',
      withdrawHint: '\u672c\u91d1\u96a8\u6642\u53ef\u64a4\u56de\u3002',
      empty: '\u9084\u6c92\u6709\u7d00\u9304\u3002',
      k_lent: '\u501f\u51fa', k_interest: '\u8a08\u5229', k_withdrawn: '\u64a4\u56de',
      err_stake: '\u8acb\u8f38\u5165\u5927\u65bc 0 \u7684\u8a3b\u8a3c\u91d1\u3002', err_lossLimit: '\u8acb\u8f38\u5165\u5927\u65bc 0 \u7684\u8667\u640d\u4e0a\u9650\u3002', err_lossBelowStake: '\u8667\u640d\u4e0a\u9650\u81f3\u5c11\u8981\u7b49\u65bc\u4e00\u5c40\u8a3b\u8a3c\u3002',
      err_session: '\u6703\u8a71\u4e0a\u9650\u70ba 1 \u5230 240 \u5206\u9418\u3002', err_amount: '\u8acb\u8f38\u5165\u5927\u65bc 0 \u7684\u91d1\u984d\u3002', err_off: '\u8acb\u5148\u958b\u555f\u3002',
      err_insufficient: '\u8d85\u51fa\u9918\u984d\u3002', err_unavailable: '\u76ee\u524d\u4e0d\u53ef\u7528\u3002', err_payer_is_treasury: '\u5df2\u62d2\u7d55\uff1a\u4f3a\u670d\u5668\u628a\u570b\u5eab\u8a2d\u70ba\u4ed8\u606f\u65b9\u3002',
      err_coming_soon: '\u5373\u5c07\u63a8\u51fa',
      err_region_blocked: '\u6240\u5728\u5730\u5340\u66ab\u4e0d\u63d0\u4f9b',
      err_pool_paused: '\u8f2a\u76e4\u66ab\u505c\uff0c\u734e\u6c60\u88dc\u5145\u4e2d',
      poolPausedHint: '\u81ea\u52d5\u628a\u6ce8\u5df2\u66ab\u505c\u3002\u734e\u6c60\u8d85\u904e 501 SCDO \u5f8c\u6703\u91cd\u8a66\u3002',
      err: '\u51fa\u932f\u4e86\uff1a{e}'
    }
  }

  let cache = null
  let view = 'list' // list | wheel | lend
  let poll = null
  let live = { wheel: null, rate: null, ledger: null }

  function api () { return window.scdo }
  function pack (lang) { return STR[lang === 'CN' ? 'CN' : 'EN'] }
  function t (lang, k, p) {
    let s = (pack(lang)[k] != null ? pack(lang)[k] : STR.EN[k]) || k
    if (p) s = s.replace(/\{(\w+)\}/g, (m, n) => p[n] != null ? p[n] : m)
    return s
  }
  function toast (msg) { try { if (window.SCDORewardDest && window.SCDORewardDest._toast) window.SCDORewardDest._toast(msg) } catch (e) {} }

  async function load () {
    try { cache = await api().invoke('rewardDest:get') } catch (e) { cache = null }
    return cache
  }
  function enabled () {
    const f = cache && cache.flags
    return !!(f && (f.REWARD_LEND || f.REWARD_AUTOWHEEL) && !f.storeBuild)
  }

  function stopPoll () { if (poll) { clearInterval(poll); poll = null } }
  function startPoll (fn) {
    stopPoll()
    poll = setInterval(() => { fn().catch(() => {}) }, 2000)
  }

  function toggle (id, on, act, name, soon) {
    if (soon) {
      // Disabled + greyed: no click handler fires (no data-act), screen readers hear "dimmed".
      return `<button type="button" class="toggle rd-soon" id="${esc(id)}" disabled aria-disabled="true" style="opacity:.5;filter:grayscale(1);cursor:not-allowed;pointer-events:none"><span class="sw"></span>${esc(name)}</button>`
    }
    return `<button type="button" class="toggle" data-act="${esc(act)}" id="${esc(id)}"><span class="sw ${on ? 'on' : ''}"></span>${esc(name)}</button>`
  }
  function isActive (which) { return !!(cache && cache.active && cache.active[which] === true) }
  function soonTag (lang) { return `<span class="tag" style="background:#eceef5;color:#5f6482;font-weight:700">${esc(t(lang, 'comingSoon'))}</span>` }
  function field (id, label, value, type) {
    return `<div class="field" style="margin-top:12px"><div class="lbl" style="font-weight:600">${esc(label)}</div><input class="inp" id="${esc(id)}" type="${type || 'text'}" inputmode="decimal" value="${esc(value == null ? '' : value)}"></div>`
  }
  function listHtml (lang) {
    if (!enabled()) return ''
    const p = (cache && cache.prefs) || { lend: { on: false }, wheel: { on: false } }
    const f = cache.flags
    let body = `<div class="card mine-card" id="rewardDest" style="margin-top:18px"><div style="font-size:24px;font-weight:700">${esc(t(lang, 'title'))}</div><div class="lbl" style="margin-top:6px">${esc(t(lang, 'lead'))}</div>`
    const item = (key, idT, act, nameK, subK, openAct, top) => {
      const soon = !isActive(key)
      const head = `<div class="row" style="justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">${toggle(idT, !soon && !!p[key].on, act, t(lang, nameK), soon)}${soon ? soonTag(lang) : ''}</div>`
      const tail = soon
        ? `<div class="lbl" style="margin-top:6px;color:#8a8fa8">${esc(t(lang, 'comingSoonHint'))}</div>`
        : `<div class="row" style="margin-top:10px"><button type="button" class="btn ghost small" data-act="${esc(openAct)}">${esc(t(lang, 'open'))}</button></div>`
      return `<div class="rd-item${soon ? ' rd-item-soon' : ''}" data-rd="${esc(key)}" style="margin-top:${top}px;padding:14px;border:1px solid #dfe3f0;border-radius:14px;${soon ? 'background:#f6f7fb;color:#8a8fa8' : ''}">${head}<div class="lbl" style="margin-top:6px">${esc(t(lang, subK))}</div>${tail}</div>`
    }
    if (f.REWARD_AUTOWHEEL) body += item('wheel', 'rdWheelOn', 'rdWheelToggle', 'wheelName', 'wheelSub', 'rdOpenWheel', 16)
    if (f.REWARD_LEND) body += item('lend', 'rdLendOn', 'rdLendToggle', 'lendName', 'lendSub', 'rdOpenLend', 12)
    return body + '</div>'
  }

  function wheelHtml (lang) {
    const p = (cache && cache.prefs && cache.prefs.wheel) || { on: false, stake: '1', lossLimit: '10', sessionMinutes: 30 }
    const st = live.wheel || { running: false, rounds: 0, staked: '0', won: '0', net: '0' }
    const by = st.stoppedBy ? t(lang, 'by_' + st.stoppedBy) || st.stoppedBy : ''
    let h = `<div class="page" id="rewardDestWheel"><div class="card mine-card"><button type="button" class="btn ghost small" data-act="rdBack">${esc(t(lang, 'back'))}</button>`
    h += `<div style="font-size:28px;font-weight:700;margin-top:10px">${esc(t(lang, 'wheelName'))}</div>`
    h += `<div class="infobox" style="margin-top:10px">${esc(t(lang, 'wheelRisk'))}</div>`
    h += `<div style="margin-top:14px">${toggle('rdWheelOn2', !!p.on, 'rdWheelToggle', t(lang, p.on ? 'on' : 'off'))}</div>`
    h += field('rdStake', t(lang, 'stake'), p.stake)
    h += field('rdLoss', t(lang, 'lossLimit'), p.lossLimit)
    h += field('rdSession', t(lang, 'sessionLimit'), p.sessionMinutes, 'number')
    h += `<div class="row" style="margin-top:12px;flex-wrap:wrap"><button type="button" class="btn ghost" data-act="rdWheelSave">${esc(t(lang, 'save'))}</button></div>`
    h += `<div class="stats" style="margin-top:16px"><div class="stat"><div class="lbl">${esc(t(lang, 'rounds'))}</div><div class="v" id="rdRounds">${esc(st.rounds || 0)}</div></div><div class="stat"><div class="lbl">${esc(t(lang, 'staked'))}</div><div class="v" id="rdStaked">${esc(st.staked || '0')}</div></div><div class="stat"><div class="lbl">${esc(t(lang, 'won'))}</div><div class="v" id="rdWon">${esc(st.won || '0')}</div></div><div class="stat"><div class="lbl">${esc(t(lang, 'net'))}</div><div class="v" id="rdNet">${esc(st.net || '0')}</div></div></div>`
    if (st.lastResult) h += `<div class="lbl" style="margin-top:10px">${esc(t(lang, 'last'))}${PU(lang)} #${esc(st.lastResult.round)} \u00b7 ${esc(st.lastResult.stake)} \u2192 ${esc(st.lastResult.payout)}</div>`
    if (by) h += `<div class="lbl">${esc(t(lang, 'stoppedBy'))}${PU(lang)}${esc(by)}</div>`
    h += `<div class="lbl" style="margin-top:8px">${esc(t(lang, 'results'))}</div>`
    h += `<div class="row" style="margin-top:18px;flex-wrap:wrap;gap:14px"><button type="button" class="btn pri" data-act="rdWheelStart" ${st.running || !p.on ? 'disabled' : ''}>${esc(t(lang, 'start'))}</button><button type="button" class="btn dan big" data-act="rdWheelStop" style="min-width:160px;font-size:22px;font-weight:800">${esc(t(lang, 'stop'))}</button></div>`
    h += `<div class="lbl" style="margin-top:8px">${esc(t(lang, 'stopHint'))}</div>`
    if (st.paused || st.pauseReason === 'pool_paused') {
      h += `<div class="infobox" style="margin-top:12px;background:#fff6e5;border:1px solid #f0c36d"><div style="font-weight:700">${esc(t(lang, 'err_pool_paused'))}</div><div class="lbl" style="margin-top:4px">${esc(t(lang, 'poolPausedHint'))}</div></div>`
    }
    h += `<div class="tag" style="margin-top:12px;background:${st.running && !st.paused ? '#e8f7ee' : '#eceef5'};color:${st.running && !st.paused ? '#146c2e' : '#5f6482'}">${esc(t(lang, st.running && !st.paused ? 'running' : 'stopped'))}</div>`
    return h + '</div></div>'
  }

  function PU (lang) { return lang === 'CN' ? '\uff1a' : ': ' }

  function lendHtml (lang) {
    const p = (cache && cache.prefs && cache.prefs.lend) || { on: false }
    const rate = live.rate || {}
    const led = live.ledger || { records: [], summary: { lent: '0', interestBooked: '0', withdrawn: '0', balance: '0' } }
    const sum = led.summary || {}
    let h = `<div class="page" id="rewardDestLend"><div class="card mine-card"><button type="button" class="btn ghost small" data-act="rdBack">${esc(t(lang, 'back'))}</button>`
    h += `<div style="font-size:28px;font-weight:700;margin-top:10px">${esc(t(lang, 'lendName'))}</div>`
    h += `<div style="margin-top:14px">${toggle('rdLendOn2', !!p.on, 'rdLendToggle', t(lang, p.on ? 'on' : 'off'))}</div>`
    const rateLine = rate.rateBps != null ? ((rate.rateBps / 100).toFixed(2) + '%') : t(lang, 'rateNone')
    h += `<div class="infobox" style="margin-top:12px"><div style="font-weight:700">${esc(t(lang, 'rateLabel'))}</div><div style="font-size:28px;font-weight:800;margin-top:6px">${esc(rateLine)}</div><div class="lbl" style="margin-top:6px">${esc(t(lang, 'rateNote'))}</div><div class="lbl" style="margin-top:4px">${esc(t(lang, 'payer'))}</div></div>`
    h += field('rdLendAmt', t(lang, 'amount'), '')
    h += `<div class="row" style="margin-top:12px;flex-wrap:wrap;gap:10px"><button type="button" class="btn pri" data-act="rdLendDeposit" ${p.on ? '' : 'disabled'}>${esc(t(lang, 'lendNow'))}</button><button type="button" class="btn ghost" data-act="rdLendWithdraw">${esc(t(lang, 'withdraw'))}</button><button type="button" class="btn ghost" data-act="rdLendWithdrawAll">${esc(t(lang, 'withdrawAll'))}</button></div>`
    h += `<div class="lbl" style="margin-top:8px">${esc(t(lang, 'withdrawHint'))}</div>`
    h += `<div style="font-size:22px;font-weight:700;margin-top:18px">${esc(t(lang, 'ledgerTitle'))}</div>`
    h += `<div class="stats"><div class="stat"><div class="lbl">${esc(t(lang, 'lent'))}</div><div class="v">${esc(sum.lent || '0')}</div></div><div class="stat"><div class="lbl">${esc(t(lang, 'interest'))}</div><div class="v">${esc(sum.interestBooked || '0')}</div></div><div class="stat"><div class="lbl">${esc(t(lang, 'withdrawn'))}</div><div class="v">${esc(sum.withdrawn || '0')}</div></div><div class="stat"><div class="lbl">${esc(t(lang, 'balance'))}</div><div class="v">${esc(sum.balance || '0')}</div></div></div>`
    const rows = (led.records || []).slice().reverse().slice(0, 40)
    if (!rows.length) h += `<div class="muted" style="margin-top:10px">${esc(t(lang, 'empty'))}</div>`
    else h += rows.map(r => `<div class="txrow" style="cursor:default"><div style="flex:1"><div style="font-weight:700">${esc(t(lang, 'k_' + r.kind) || r.kind)}</div><div class="lbl">${esc(r.ts ? new Date(r.ts).toLocaleString() : '')}</div></div><div style="font-weight:700">${esc(r.amountDisplay || '')}</div></div>`).join('')
    return h + '</div></div>'
  }

  // Attach amountDisplay for the rows (atomic -> SCDO string) without importing BigInt helpers.
  function decorate (led) {
    if (!led || !Array.isArray(led.records)) return led
    led.records = led.records.map(r => {
      let d = r.amountDisplay
      if (!d && r.amountAtomic != null) {
        try {
          const v = BigInt(r.amountAtomic); const i = v / (10n ** 18n); const f = (v % (10n ** 18n)).toString().padStart(18, '0').replace(/0+$/, '')
          d = i.toString() + (f ? '.' + f : '')
        } catch (e) { d = String(r.amountAtomic) }
      }
      return Object.assign({}, r, { amountDisplay: d || '0' })
    })
    return led
  }

  let lastPauseToast = 0
  async function refreshLive () {
    if (view === 'wheel') {
      try {
        live.wheel = await api().invoke('rewardDest:wheelStatus')
        if (live.wheel && live.wheel.paused && Date.now() - lastPauseToast > 30_000) {
          lastPauseToast = Date.now()
          toast(t((window.SCDORewardDest && window.SCDORewardDest._lang) || 'EN', 'err_pool_paused'))
        }
      } catch (e) {}
    } else if (view === 'lend') {
      try { live.rate = await api().invoke('rewardDest:lendRate') } catch (e) {}
      try { live.ledger = decorate(await api().invoke('rewardDest:lendLedger')) } catch (e) {}
    }
  }

  function paint (lang, host) {
    if (!host) return
    let html = ''
    if (view === 'wheel') html = wheelHtml(lang)
    else if (view === 'lend') html = lendHtml(lang)
    else html = listHtml(lang)
    SD.html(host, html || '')
  }

  async function openSub (which, lang, host) {
    view = which
    await refreshLive()
    paint(lang, host)
    if (which === 'wheel' || which === 'lend') {
      startPoll(async () => { await refreshLive(); paint(lang, host) })
    } else stopPoll()
  }

  function errText (lang, code) {
    if (!code) return t(lang, 'err', { e: 'unknown' })
    return t(lang, 'err_' + code) || t(lang, 'err', { e: code })
  }

  async function handle (act, lang, host, toastFn) {
    if (toastFn) window.SCDORewardDest._toast = toastFn
    window.SCDORewardDest._lang = lang
    const read = (id) => { const el = document.getElementById(id); return el ? el.value : '' }
    // Coming soon: nothing below may run for a feature that is not active (main refuses too).
    const needs = { rdOpenWheel: 'wheel', rdWheelToggle: 'wheel', rdWheelSave: 'wheel', rdWheelStart: 'wheel', rdOpenLend: 'lend', rdLendToggle: 'lend', rdLendDeposit: 'lend', rdLendWithdraw: 'lend', rdLendWithdrawAll: 'lend' }
    if (needs[act]) {
      await load()
      if (!isActive(needs[act])) { stopPoll(); view = 'list'; toast(t(lang, 'comingSoon')); paint(lang, host); return true }
    }
    if (act === 'rdOpenWheel') { await openSub('wheel', lang, host); return true }
    if (act === 'rdOpenLend') { await openSub('lend', lang, host); return true }
    if (act === 'rdBack') { stopPoll(); view = 'list'; await load(); paint(lang, host); return true }
    if (act === 'rdWheelToggle') {
      const on = !(cache && cache.prefs && cache.prefs.wheel && cache.prefs.wheel.on)
      const r = await api().invoke('rewardDest:setWheel', { on })
      if (r && r.ok) cache.prefs = r.prefs
      else toast(errText(lang, r && r.error))
      paint(lang, host); return true
    }
    if (act === 'rdLendToggle') {
      const on = !(cache && cache.prefs && cache.prefs.lend && cache.prefs.lend.on)
      const r = await api().invoke('rewardDest:setLend', on)
      if (r && r.ok) cache.prefs = r.prefs
      else toast(errText(lang, r && r.error))
      paint(lang, host); return true
    }
    if (act === 'rdWheelSave') {
      const r = await api().invoke('rewardDest:setWheel', { stake: read('rdStake'), lossLimit: read('rdLoss'), sessionMinutes: Number(read('rdSession')) })
      if (r && r.ok) { cache.prefs = r.prefs; toast(t(lang, 'saved')) }
      else toast(errText(lang, r && r.error))
      paint(lang, host); return true
    }
    if (act === 'rdWheelStart') {
      const r = await api().invoke('rewardDest:wheelStart')
      if (r && r.prefs) cache.prefs = r.prefs
      if (!(r && r.ok)) {
        toast(errText(lang, r && r.error))
        // region_blocked already flipped the toggle off in main; refresh the list/sub-screen
      }
      await refreshLive(); paint(lang, host); return true
    }
    if (act === 'rdWheelStop') {
      await api().invoke('rewardDest:wheelStop')
      await refreshLive(); paint(lang, host); return true
    }
    if (act === 'rdLendDeposit') {
      const r = await api().invoke('rewardDest:lendDeposit', read('rdLendAmt'))
      if (!(r && r.ok)) toast(errText(lang, r && r.error))
      await refreshLive(); paint(lang, host); return true
    }
    if (act === 'rdLendWithdraw' || act === 'rdLendWithdrawAll') {
      const amt = act === 'rdLendWithdrawAll' ? ((live.ledger && live.ledger.summary && live.ledger.summary.balance) || '0') : read('rdLendAmt')
      const r = await api().invoke('rewardDest:lendWithdraw', amt)
      if (!(r && r.ok)) toast(errText(lang, r && r.error))
      await refreshLive(); paint(lang, host); return true
    }
    return false
  }

  async function mountSection (lang, afterEl, toastFn) {
    if (toastFn) window.SCDORewardDest._toast = toastFn
    await load()
    if (!enabled()) return null
    let host = document.getElementById('rewardDestHost')
    if (!host) {
      host = document.createElement('div')
      host.id = 'rewardDestHost'
      if (afterEl && afterEl.parentNode) afterEl.parentNode.insertBefore(host, afterEl.nextSibling)
      else if (afterEl) afterEl.appendChild(host)
    }
    view = 'list'
    stopPoll()
    paint(lang, host)
    return host
  }

  function unmount () {
    stopPoll()
    view = 'list'
    const host = document.getElementById('rewardDestHost')
    if (host) SD.clear(host)
  }

  window.SCDORewardDest = { mountSection, unmount, handle, load, enabled: () => enabled() }
})()
