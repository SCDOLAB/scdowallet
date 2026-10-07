// SCDO Wallet 2.0.7 (P2, mining department): pool payout progress card on the Mining tab (pool mode only).
// Based on 豆包's payoutProgressCard.js; adapted to this codebase:
//  - no ./httpClient.js: the page has no network access (CSP connect-src 'self'); the main process reads the pool API
//    over the allowlisted IPC channel 'pool:account' (src/main/miningService.js poolAccount, https://scdoscan.io/pool/api/accounts/<addr>)
//  - DOM-built with SafeDom.h (no innerHTML, Trusted Types), existing card / stat / statusbar / button styles
//  - "pool unreachable", "no record yet" and "not the official pool" are plain states; nothing here can throw into the page
// Facts only: unpaid balance vs the payout minimum, last payout time + transaction. No projections, no prices.
;(function (M) {
  const h = (...a) => window.SafeDom.h(...a)
  const CN = {
    'Pool payouts': '礦池出款',
    'Unpaid balance': '未付餘額',
    'Payout minimum': '出款門檻',
    'Waiting for confirmations': '等待確認中',
    'Last payout': '上次出款',
    'No payout yet': '還沒有出款',
    'View transaction': '查看交易',
    'Payouts run every 10 minutes once you are over {t} SCDO.': '餘額超過 {t} SCDO 後，礦池每 10 分鐘出款一次。',
    'Small amounts are paid in bigger, less frequent chunks so less is lost to fees.': '小額會累積成較大的金額，較少次地支付，被手續費吃掉的就比較少。',
    'Pool unreachable right now. Retrying every 60 s.': '暫時無法連線到礦池，每 60 秒重試一次。',
    'The pool has no record of this address yet. It shows up a few minutes after mining starts.': '礦池還沒有這個地址的紀錄。開始挖礦幾分鐘後就會出現。',
    'Choose a reward address to see pool payouts.': '請先選擇收款地址，才能查看礦池出款。',
    'Payout details are only available for the official SCDO pool.': '只有 SCDO 官方礦池提供出款資料。',
    ' Loading pool data…': ' 正在載入礦池資料…',
    'Refresh': '重新整理',
    'As of ': '資料時間：',
    'Address: ': '地址：'
  }
  const L = (en, p) => { let s = M.lang === 'CN' && CN[en] ? CN[en] : en; if (p) s = s.replace(/\{(\w+)\}/g, (m, k) => (p[k] != null ? String(p[k]) : m)); return s }
  const cache = {} // addr -> { r, at }
  let inflight = null; let timer = null
  const REFRESH_MS = 60000

  async function load (addr) {
    if (inflight && inflight.addr === addr) return inflight.p
    const p = (async () => {
      let r
      try { r = await window.scdo.invoke('pool:account', addr) } catch (e) { r = { ok: false, unreachable: true, error: e && e.message } }
      cache[addr] = { r: r || { ok: false, unreachable: true }, at: Date.now() }
      return cache[addr].r
    })()
    inflight = { addr, p }
    try { return await p } finally { if (inflight && inflight.p === p) inflight = null }
  }
  const PUN = () => (M.lang === 'CN' ? '：' : ': ')
  function shortAddr (a) { return a.slice(0, 6) + '…' + a.slice(-4) }
  function fmtTime (ts) { try { return new Date(ts * 1000).toLocaleString(M.locale()) } catch (e) { return String(ts) } }
  function stat (label, value, id) { return h('div', { class: 'stat' }, h('div', { class: 'lbl', text: label }), h('div', { class: 'v', id, text: value })) }
  function notes (threshold) {
    return [h('div', { class: 'lbl', style: 'margin-top:12px', text: L('Payouts run every 10 minutes once you are over {t} SCDO.', { t: threshold || '1' }) }),
      h('div', { class: 'm1-disc', style: 'margin-top:4px', text: L('Small amounts are paid in bigger, less frequent chunks so less is lost to fees.') })]
  }
  function body (addr, official, r, onRefresh) {
    const head = h('div', { class: 'm1-row' }, h('div', { class: 'm1-h', text: L('Pool payouts') }),
      addr && official ? h('button', { class: 'btn ghost small', id: 'payoutRefresh', text: L('Refresh'), onclick: onRefresh }) : null)
    const card = h('div', { class: 'card m1-card', id: 'payoutCard' }, head)
    if (!official) { card.appendChild(h('div', { class: 'lbl', id: 'payoutState', text: L('Payout details are only available for the official SCDO pool.') })); return card }
    if (!addr) { card.appendChild(h('div', { class: 'lbl', id: 'payoutState', text: L('Choose a reward address to see pool payouts.') })); card.append(...notes()); return card }
    card.appendChild(h('div', { class: 'lbl', text: L('Address: ') + shortAddr(addr) }))
    if (!r) { card.appendChild(h('div', { class: 'statusbar', id: 'payoutState' }, h('span', { class: 'spin' }), L(' Loading pool data…'))); return card }
    if (!r.ok) { card.appendChild(h('div', { class: 'statusbar bad', id: 'payoutState', text: L('Pool unreachable right now. Retrying every 60 s.') })); card.append(...notes()); return card }
    if (!r.known) { card.appendChild(h('div', { class: 'statusbar', id: 'payoutState', text: L('The pool has no record of this address yet. It shows up a few minutes after mining starts.') })); card.append(...notes()); return card }
    const pct = Math.max(0, Math.min(100, Number(r.progressPercent) || 0))
    card.appendChild(h('div', { class: 'stats', style: 'margin-top:12px' },
      stat(L('Unpaid balance'), r.balance + ' / ' + r.threshold + ' SCDO', 'payoutBal'),
      stat(L('Waiting for confirmations'), r.immature + ' SCDO', 'payoutImm'),
      stat(L('Last payout'), r.lastPayout ? r.lastPayout.amount + ' SCDO' : L('No payout yet'), 'payoutLast')))
    card.appendChild(h('div', { class: 'm1-prog', id: 'payoutProg', title: L('Payout minimum') + ' ' + r.threshold + ' SCDO' }, h('div', { style: 'width:' + pct + '%' })))
    card.appendChild(h('div', { class: 'lbl', text: L('Payout minimum') + ' ' + r.threshold + ' SCDO · ' + Math.floor(pct) + ' %' }))
    if (r.lastPayout) card.appendChild(h('div', { class: 'm1-row', style: 'margin-top:8px;flex-wrap:wrap' }, h('span', { class: 'lbl', id: 'payoutLastTime', text: L('Last payout') + PUN() + (r.lastPayout.timestamp ? fmtTime(r.lastPayout.timestamp) : '–') }), h('span', { class: 'mono lbl', text: r.lastPayout.tx.slice(0, 10) + '…' + r.lastPayout.tx.slice(-8) }), h('button', { class: 'btn ghost small', id: 'payoutTx', 'data-act': 'openTx', 'data-v': r.lastPayout.tx, text: L('View transaction') })))
    card.append(...notes(r.threshold))
    if (r.asOf) card.appendChild(h('div', { class: 'm1-disc', text: L('As of ') + new Date(r.asOf).toLocaleString(M.locale()) }))
    return card
  }
  // ctx: { address, poolUrl, official }
  function render (ctx) {
    const box = h('div', { id: 'payoutBox' })
    const addr = ctx && /^0x[0-9a-fA-F]{40}$/.test(String(ctx.address || '')) ? ctx.address : ''
    const official = !!(ctx && ctx.official)
    const draw = () => { try { const c = cache[addr]; box.replaceChildren(body(addr, official, c ? c.r : null, () => refresh(true))) } catch (e) { box.replaceChildren() } }
    const refresh = (force) => {
      if (!addr || !official) return
      const c = cache[addr]
      if (!force && c && Date.now() - c.at < REFRESH_MS) return
      load(addr).then(() => { if (document.body.contains(box)) draw() }).catch(() => {})
    }
    draw(); refresh(false)
    if (timer) clearInterval(timer)
    timer = setInterval(() => { if (!document.body.contains(box)) { clearInterval(timer); timer = null; return } refresh(true) }, REFRESH_MS)
    return box
  }
  M.PayoutProgressCard = { render, _body: body, _L: L }
})(window.SCDOMining)
