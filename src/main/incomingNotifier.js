// Incoming SCDO notifications (ALL builds, including App Store / Play / store).
// Polls Shard0 activity for each watched address. Classifies the sender:
//   Wheel win        — Games Ledger payout hot wallet 0x6db3…1983
//   Bookkeeping reward — pool / block-reward style senders (batched ≤1 / 10 min, amounts summed)
//   Interest         — subsidy / lend interest payer
//   Transfer         — everything else
// Shows a native Notification "Received +X SCDO" / 「到賬 +X SCDO」 with the source label.
// Sound is on by default; Settings can mute it. Tray badge counts unseen incoming.
'use strict'
const fs = require('fs')
const path = require('path')

const WHEEL_PAYOUT = '0x6db30022dad35ffb545df67836b34087e8e81983'
// Pool / mining-reserve senders that mean "bookkeeping reward" (not a person-to-person transfer).
const BOOKKEEPING_SENDERS = new Set([
  '0x675e8639a73ecfe13561dbabc25e56cb82088d24', // mining reserve / Shard0 PPLNS pool
  '0x9cf45fed81cb4f874341d328a75e24546627e570', // 5060Ti ledger / official mine
  '0x8e243d893177a6e2e546c5f0032d10dc715a842f' // SCDO-4060 official mine
])
// Interest paid from the subsidy wallet (lend B). Never the treasury.
const INTEREST_SENDERS = new Set([
  '0x48dc8ec5a153641e4a6e5f1fc4452f82452f6357' // gas subsidy / Subsidy Office
])
const TREASURY = '0x0889453fe946c75163b3bbdf2266f2566b2f4c03'
const TX_URL = 'https://scdo.com.au/tx/'
const POLL_MS = 30_000
const BOOKKEEP_WINDOW_MS = 10 * 60 * 1000
const STORE_KEY = 'incomingNotifications'

const TEXT = {
  EN: {
    title: 'Received +{a} SCDO',
    body: '{src}',
    src_wheel: 'Wheel win',
    src_bookkeeping: 'Bookkeeping reward',
    src_interest: 'Interest',
    src_transfer: 'Transfer',
    soundLabel: 'Play a sound on incoming SCDO',
    enabledLabel: 'Incoming SCDO notifications'
  },
  CN: {
    title: '到賬 +{a} SCDO',
    body: '{src}',
    src_wheel: '輪盤獎金',
    src_bookkeeping: '記帳獎勵',
    src_interest: '利息',
    src_transfer: '轉帳',
    soundLabel: '到賬時播放音效',
    enabledLabel: '到賬通知'
  }
}
const fill = (s, p) => String(s).replace(/\{(\w+)\}/g, (m, k) => (p && p[k] != null ? String(p[k]) : m))

function classify (from) {
  const a = String(from || '').toLowerCase()
  if (!a) return 'transfer'
  if (a === WHEEL_PAYOUT) return 'wheel'
  if (a === TREASURY) return 'transfer' // never call treasury "interest"
  if (INTEREST_SENDERS.has(a)) return 'interest'
  if (BOOKKEEPING_SENDERS.has(a)) return 'bookkeeping'
  // Classic / Shard0 block-reward marker used by the indexer
  if (/^0s0{40}$/i.test(from)) return 'bookkeeping'
  return 'transfer'
}

function defaults () { return { enabled: true, sound: true } }

class IncomingNotifier {
  // opts: {
  //   store: { get, set }, lang: () => 'CN'|'EN',
  //   notify: ({ title, body, url, source, amount }) => void,
  //   playSound: () => void,
  //   setBadge: (n) => void,
  //   listAccounts: () => [{ evm }],
  //   activity: (addr) => Promise<[{ dir, from, amount, hash, t, asset }]>,
  //   now, pollMs
  // }
  constructor (opts) {
    this.o = opts || {}
    this.now = this.o.now || (() => Date.now())
    this.seen = new Set()
    this.bookBatch = { total: 0, hashes: [], firstAt: 0 }
    this.timer = null
    this.badge = 0
    this.started = false
    this.stateFile = this.o.stateFile || null
    this._loadSeen()
  }

  config () {
    let saved = {}
    try { saved = this.o.store.get(STORE_KEY, {}) || {} } catch (e) {}
    return Object.assign(defaults(), {
      enabled: saved.enabled !== false,
      sound: saved.sound !== false
    })
  }
  set (patch) {
    const c = Object.assign(this.config(), patch || {})
    this.o.store.set(STORE_KEY, { enabled: !!c.enabled, sound: !!c.sound })
    return { ok: true, config: this.config(), labels: this.labels() }
  }
  labels () {
    const t = TEXT[this.lang()]
    return { enabled: t.enabledLabel, sound: t.soundLabel }
  }
  lang () { try { return this.o.lang && this.o.lang() === 'EN' ? 'EN' : 'CN' } catch (e) { return 'CN' } }

  start () {
    if (this.started) return
    this.started = true
    this.tick().catch(() => {})
    this.timer = setInterval(() => { this.tick().catch(() => {}) }, this.o.pollMs || POLL_MS)
    if (this.timer.unref) this.timer.unref()
  }
  stop () {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.started = false
    this._flushBook(true)
  }
  clearBadge () {
    this.badge = 0
    try { this.o.setBadge && this.o.setBadge(0) } catch (e) {}
  }

  async tick () {
    if (!this.config().enabled) return
    const accounts = (this.o.listAccounts && this.o.listAccounts()) || []
    const addrs = accounts.map(a => a && a.evm).filter(a => /^0x[0-9a-fA-F]{40}$/.test(String(a || '')))
    for (const addr of addrs) {
      let rows = []
      try { rows = await this.o.activity(addr) } catch (e) { continue }
      if (!Array.isArray(rows)) continue
      // Newest last so we process in order
      const incoming = rows
        .filter(r => r && (r.dir === 'in' || r.dir === 'reward') && String(r.asset || 'SCDO').toUpperCase() === 'SCDO')
        .filter(r => r.hash && !this.seen.has(String(r.hash).toLowerCase()))
        .filter(r => Number(r.t) > 0 && this.now() - Number(r.t) < 24 * 3600 * 1000) // ignore >24h old on first run
        .sort((a, b) => Number(a.t) - Number(b.t))
      for (const r of incoming) this._handle(r)
    }
    this._flushBook(false)
  }

  _source (r) {
    if (r.dir === 'reward') return 'bookkeeping'
    return classify(r.from)
  }

  _handle (r) {
    const amt = Number(r.amount)
    if (!Number.isFinite(amt) || amt <= 0) return
    const hash = String(r.hash).toLowerCase()
    this.seen.add(hash)
    this._saveSeen()
    const src = this._source(r)
    if (src === 'bookkeeping') {
      if (!this.bookBatch.firstAt) this.bookBatch.firstAt = this.now()
      this.bookBatch.total += amt
      this.bookBatch.hashes.push(hash)
      return
    }
    this._fire(src, amt, hash)
  }

  _flushBook (force) {
    if (!this.bookBatch.hashes.length) return
    const age = this.now() - this.bookBatch.firstAt
    if (!force && age < BOOKKEEP_WINDOW_MS) return
    const total = this.bookBatch.total
    const hash = this.bookBatch.hashes[this.bookBatch.hashes.length - 1]
    this.bookBatch = { total: 0, hashes: [], firstAt: 0 }
    if (total > 0) this._fire('bookkeeping', total, hash)
  }

  _fire (src, amount, hash) {
    const lang = this.lang()
    const t = TEXT[lang]
    const a = trimAmt(amount)
    const title = fill(t.title, { a })
    const body = fill(t.body, { src: t['src_' + src] || t.src_transfer })
    try {
      this.o.notify({ title, body, url: hash ? TX_URL + hash : '', source: src, amount: a })
    } catch (e) {}
    if (this.config().sound) {
      try { this.o.playSound && this.o.playSound() } catch (e) {}
    }
    this.badge += 1
    try { this.o.setBadge && this.o.setBadge(this.badge) } catch (e) {}
  }

  _loadSeen () {
    if (!this.stateFile) return
    try {
      const j = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'))
      if (Array.isArray(j.seen)) for (const h of j.seen.slice(-500)) this.seen.add(String(h).toLowerCase())
    } catch (e) {}
  }
  _saveSeen () {
    if (!this.stateFile) return
    try {
      fs.mkdirSync(path.dirname(this.stateFile), { recursive: true })
      const arr = Array.from(this.seen).slice(-500)
      const tmp = this.stateFile + '.tmp'
      fs.writeFileSync(tmp, JSON.stringify({ seen: arr }))
      fs.renameSync(tmp, this.stateFile)
    } catch (e) {}
  }
}

// Decimal text of a number, cut (never rounded) to `dp` places, trailing zeros dropped. No float maths on the digits.
function cutDecimal (v, dp) {
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  let s = String(n)
  const m = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/i.exec(s)
  if (!m) return null
  let int = m[2]; let frac = m[3] || ''; const e = m[4] ? parseInt(m[4], 10) : 0
  if (e > 0) { frac = frac.padEnd(e, '0'); int += frac.slice(0, e); frac = frac.slice(e) } else if (e < 0) { int = int.padStart(-e + 1, '0'); frac = int.slice(int.length + e) + frac; int = int.slice(0, int.length + e) }
  int = int.replace(/^0+(?=\d)/, '')
  frac = frac.slice(0, dp).replace(/0+$/, '')
  const neg = m[1] === '-' && (/[1-9]/.test(int) || frac !== '')
  return { neg, int, frac }
}

// SCDO amounts are never rounded: cut to 8 decimals (toFixed would round 0.123456789 up to 0.12345679).
function trimAmt (n) {
  const c = cutDecimal(n, 8)
  if (!c) return '0'
  return (c.neg ? '-' : '') + c.int + (c.frac ? '.' + c.frac : '')
}

module.exports = { trimAmt, IncomingNotifier, classify, WHEEL_PAYOUT, BOOKKEEPING_SENDERS, INTEREST_SENDERS, TREASURY, TEXT, STORE_KEY }
