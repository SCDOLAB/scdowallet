// SCDO Wallet 2.0.7 (P1, mining department): mining notifications (main process).
// Based on 豆包's miningNotifier.js; adapted to this codebase:
//  - settings live in the wallet's existing main-process settings file (miner-intent.json, see main.js settingsStore)
//    under the key "miningNotifications"; every type defaults to on and the toggles survive a restart
//  - one language per notification, following the wallet language: 繁體中文 (CN) or English (EN); never mixed
//  - at most 1 notification per type per 10 minutes
//  - the events are derived here from the miner status stream (main.js feeds onStatus / onBlock / onPayout)
// Types:
//   firstShare   first accepted share this session, or a block found
//   payout       pool payout received (amount + scdoscan.io tx link; clicking the notification opens it)
//   hashZero     mining is on but the hashrate stayed at 0 for 2 minutes
//   stopNonUser  mining stopped by something other than the user (update install, miner exit/error)
//   nodeBehind   the local node fell more than 8 blocks behind the network (after it had been in sync)
'use strict'

const TYPES = Object.freeze(['firstShare', 'payout', 'hashZero', 'stopNonUser', 'nodeBehind'])
const STORE_KEY = 'miningNotifications'
const DEBOUNCE_MS = 10 * 60 * 1000
const HASH_ZERO_MS = 2 * 60 * 1000
const BEHIND_BLOCKS = 8
const USER_STOP_GRACE_MS = 90 * 1000
const TX_URL = 'https://scdoscan.io/tx/'

const TEXT = {
  CN: {
    firstShare: { title: '挖礦已開始產生結果', body: '本次挖礦已收到第一個有效份額。' },
    block: { title: '挖到區塊', body: '這台電腦挖到了區塊 #{h}。' },
    payout: { title: '礦池出款已到帳', body: '收到 {a} SCDO。點這則通知可在 scdoscan.io 查看交易。' },
    hashZero: { title: '挖礦速度一直是 0', body: '挖礦已開啟，但挖礦速度已經 2 分鐘都是 0。請查看「挖礦」頁的狀態和日誌。' },
    stopUpdate: { title: '挖礦已暫停', body: '為了安裝更新，錢包暫停了挖礦。更新完成後會自動恢復。' },
    stopError: { title: '挖礦已停止', body: '挖礦程式意外停止，不是由你停止的。請查看「挖礦」頁的狀態和日誌。' },
    stopOther: { title: '挖礦已停止', body: '挖礦不是由你停止的。請查看「挖礦」頁。' },
    nodeBehind: { title: '本機節點落後', body: '本機節點落後網路 {n} 個區塊（本機 #{l}，網路 #{t}），正在追趕。' },
    labels: { firstShare: '第一個有效份額或挖到區塊', payout: '礦池出款到帳', hashZero: '挖礦速度 2 分鐘都是 0', stopNonUser: '挖礦被非本人操作停止（例如更新）', nodeBehind: '本機節點落後超過 8 個區塊' }
  },
  EN: {
    firstShare: { title: 'Mining is producing results', body: 'The first accepted share of this mining session came in.' },
    block: { title: 'Block found', body: 'This PC found block #{h}.' },
    payout: { title: 'Pool payout received', body: 'You received {a} SCDO. Click to see the transaction on scdoscan.io.' },
    hashZero: { title: 'Mining speed is stuck at 0', body: 'Mining is on, but the mining speed has been 0 for 2 minutes. Check the status and log on the Mining tab.' },
    stopUpdate: { title: 'Mining paused', body: 'The wallet paused mining to install an update. It resumes when the update is done.' },
    stopError: { title: 'Mining stopped', body: 'The miner stopped unexpectedly; you did not stop it. Check the status and log on the Mining tab.' },
    stopOther: { title: 'Mining stopped', body: 'Mining was not stopped by you. See the Mining tab.' },
    nodeBehind: { title: 'Local node is behind', body: 'The local node is {n} blocks behind the network (local #{l}, network #{t}) and is catching up.' },
    labels: { firstShare: 'First accepted share or block found', payout: 'Pool payout received', hashZero: 'Mining speed at 0 for 2 minutes', stopNonUser: 'Mining stopped by something other than you (e.g. an update)', nodeBehind: 'Local node more than 8 blocks behind' }
  }
}
const fill = (s, p) => String(s).replace(/\{(\w+)\}/g, (m, k) => (p && p[k] != null ? String(p[k]) : m))

function defaults () { const o = {}; for (const t of TYPES) o[t] = true; return o }
function isMiningStatus (st) { return !!(st && st.running && (st.mode === 'mine' || st.mode === 'pool')) }

class MiningNotifier {
  // opts: { store: { get(key, def), set(key, value) }, notify({ type, title, body, url }), lang: () => 'CN'|'EN', now: () => ms }
  constructor (opts) {
    this.o = opts || {}
    this.now = this.o.now || (() => Date.now())
    this.last = {}
    this.resetSession()
    this.prevMining = false
    this.userStopAt = 0
    this.stopReason = null
  }

  // ---- toggles (persisted in the settings store) ----
  config () {
    let saved = {}
    try { saved = this.o.store.get(STORE_KEY, {}) || {} } catch (e) {}
    const c = defaults()
    for (const t of TYPES) if (typeof saved[t] === 'boolean') c[t] = saved[t]
    return c
  }
  setToggle (type, on) {
    if (!TYPES.includes(type)) return { ok: false, error: 'unknown type' }
    const c = this.config(); c[type] = !!on
    this.o.store.set(STORE_KEY, c)
    return { ok: true, config: c }
  }
  labels () { return TEXT[this.lang()].labels }
  lang () { try { return this.o.lang && this.o.lang() === 'CN' ? 'CN' : 'EN' } catch (e) { return 'EN' } }

  // ---- delivery: toggle + 1 per type per 10 minutes ----
  fire (type, textKey, params, url) {
    if (!this.config()[type]) return false
    const t = this.now()
    if (this.last[type] != null && t - this.last[type] < DEBOUNCE_MS) return false
    this.last[type] = t
    const x = TEXT[this.lang()][textKey]
    const n = { type, title: x.title, body: fill(x.body, params), url: url || null }
    try { if (this.o.notify) this.o.notify(n) } catch (e) {}
    return true
  }

  resetSession () { this.session = { sharesSeen: false, zeroSince: null, wasInSync: false } }
  markUserStop () { this.userStopAt = this.now() }
  markStopReason (reason) { this.stopReason = reason || null }

  // ---- event sources (main.js) ----
  onBlock (height) { return this.fire('firstShare', 'block', { h: height }) }
  onPayout (p) {
    if (!p || !p.tx) return false
    return this.fire('payout', 'payout', { a: p.amount }, TX_URL + p.tx)
  }
  onStatus (st) {
    st = st || {}
    const mining = isMiningStatus(st)
    const t = this.now()
    // start of a mining session
    if (mining && !this.prevMining) { this.resetSession(); this.stopReason = null }
    // first accepted share of the session
    if (mining && !this.session.sharesSeen && Number(st.sharesAccepted) > 0) { this.session.sharesSeen = true; this.fire('firstShare', 'firstShare') }
    // hashrate 0 for 2 minutes while mining is on (not while the node is still syncing / downloading / the pool paused it)
    const counting = mining && !st.paused && st.phase !== 'error' && !['SYNCING', 'DOWNLOADING', 'EXTRACTING', 'INIT', 'STOPPING'].includes(st.code)
    if (counting && !(Number(st.hashrate) > 0)) {
      if (this.session.zeroSince == null) this.session.zeroSince = t
      else if (t - this.session.zeroSince >= HASH_ZERO_MS) { this.fire('hashZero', 'hashZero'); this.session.zeroSince = t }
    } else this.session.zeroSince = null
    // local node behind the network (only after it had caught up once, so the first sync is not reported)
    const nodeOn = !!st.running && st.phase !== 'external' && st.localBlock != null && st.networkBlock != null
    if (nodeOn) {
      const gap = Number(st.networkBlock) - Number(st.localBlock)
      if (gap <= 3) this.session.wasInSync = true
      else if (gap > BEHIND_BLOCKS && this.session.wasInSync) this.fire('nodeBehind', 'nodeBehind', { n: gap, l: st.localBlock, t: st.networkBlock })
    }
    // mining stopped, and not by the user
    if (this.prevMining && !mining) {
      const byUser = this.userStopAt && t - this.userStopAt < USER_STOP_GRACE_MS
      if (!byUser) {
        if (this.stopReason === 'update') this.fire('stopNonUser', 'stopUpdate')
        else if (st.phase === 'error' || st.lastError) this.fire('stopNonUser', 'stopError')
        else this.fire('stopNonUser', 'stopOther')
      }
      this.stopReason = null
    }
    this.prevMining = mining
  }
}

module.exports = { MiningNotifier, TYPES, STORE_KEY, DEBOUNCE_MS, HASH_ZERO_MS, BEHIND_BLOCKS, TEXT, TX_URL }
