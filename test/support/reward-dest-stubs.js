// Test-only simulated backends for src/main/rewardDest.js. Not packaged (electron-builder excludes test/**).
'use strict'
const fs = require('fs')
const path = require('path')
const { toAtomic, fromAtomic, summaryOf } = require('../../src/main/rewardDest')
// ---- x402 payer (interface + STUB) ----
// Real implementation (later): sign an EIP-3009 WSCDO transferWithAuthorization for `to`/`amount`, hand the
// X-PAYMENT header to the resource, return the facilitator settlement tx hash.
class StubX402Payer {
  constructor () { this.stub = true; this.n = 0 }
  async pay ({ to, amountAtomic, purpose }) {
    this.n += 1
    return { stub: true, ref: 'stub-x402-' + Date.now().toString(36) + '-' + this.n, to, amount: fromAtomic(amountAtomic), purpose }
  }
}


class StubLendBackend {
  constructor (file) { this.file = file; this.stub = true }
  read () { try { return JSON.parse(fs.readFileSync(this.file, 'utf8')) } catch (e) { return { records: [] } } }
  write (doc) { fs.mkdirSync(path.dirname(this.file), { recursive: true }); const t = this.file + '.tmp'; fs.writeFileSync(t, JSON.stringify(doc, null, 1)); fs.renameSync(t, this.file) }
  async rate () {
    // Stub rate is a sample value so the label and the variable-rate wording can be checked; it is not an offer.
    return { ok: true, stub: true, enabled: true, rateBps: 350, guaranteed: false, interestPayer: '0x0000000000000000000000000000000000000000', interestPayerLabel: 'subsidy wallet (stub)', asOf: Date.now() }
  }
  async ledger () {
    const d = this.read()
    const records = (d.records || []).map(r => Object.assign({}, r, { amountDisplay: fromAtomic(r.amountAtomic) }))
    return { ok: true, stub: true, records, summary: summaryOf(d.records) }
  }
  async deposit (agent, amountAtomic, x402) {
    const d = this.read()
    d.records.push({ kind: 'lent', amountAtomic: amountAtomic.toString(), ts: Date.now(), ref: x402 && x402.ref, stub: true })
    // stub only: book one day of interest at the stub rate so the "interest booked" row is visible
    const day = (amountAtomic * 350n) / 10000n / 365n
    if (day > 0n) d.records.push({ kind: 'interest', amountAtomic: day.toString(), ts: Date.now(), payer: 'subsidy wallet (stub)', stub: true })
    this.write(d); return { ok: true, stub: true, summary: summaryOf(d.records) }
  }
  async withdraw (agent, amountAtomic) {
    const d = this.read(); const bal = BigInt(summaryOf(d.records).balanceAtomic)
    if (amountAtomic > bal) return { ok: false, error: 'insufficient' }
    d.records.push({ kind: 'withdrawn', amountAtomic: amountAtomic.toString(), ts: Date.now(), stub: true })
    this.write(d); return { ok: true, stub: true, summary: summaryOf(d.records) }
  }
}

class StubWheelBackend {
  constructor (opts) {
    this.stub = true
    this.now = (opts && opts.now) || Date.now
    this.rand = (opts && opts.rand) || Math.random
    this.s = null
    this.timer = null
    this.retryTimer = null
    this.roundMs = (opts && opts.roundMs) || 60000
    // Test hooks: forceRegion forces 403; forcePoolPaused forces 503 on start/round.
    this.forceRegion = !!(opts && opts.forceRegion) || false
    this.forcePoolPaused = !!(opts && opts.forcePoolPaused) || false
    this.poolRetryMs = (opts && opts.poolRetryMs) || 60_000
  }
  async start (cfg) {
    if (this.forceRegion) return { ok: false, error: 'region_blocked', stub: true }
    if (this.forcePoolPaused) return { ok: false, error: 'pool_paused', pause: true, retryAfterMs: this.poolRetryMs, stub: true }
    if (this.s && this.s.running) return { ok: false, error: 'already_running' }
    this.s = { id: 'stub-wheel-' + this.now().toString(36), running: true, paused: false, startedAt: this.now(), stake: toAtomic(cfg.stake), lossLimit: toAtomic(cfg.lossLimit), sessionMs: Number(cfg.sessionMinutes) * 60000, rounds: 0, staked: 0n, won: 0n, lastResult: null, stoppedBy: '', pauseReason: '' }
    this.timer = setInterval(() => this.round(), this.roundMs)
    if (this.timer.unref) this.timer.unref()
    return { ok: true, stub: true, sessionId: this.s.id }
  }
  round () {
    const s = this.s; if (!s || !s.running || s.paused) return
    if (this.forcePoolPaused) return this.pausePool()
    if (this.now() - s.startedAt >= s.sessionMs) return this.halt('session')
    if (s.staked - s.won + s.stake > s.lossLimit) return this.halt('lossLimit')
    s.rounds += 1; s.staked += s.stake
    // stub outcome only (no SCDO moves): 0x, 0.5x, 2x
    const r = this.rand(); const mult = r < 0.5 ? 0n : r < 0.8 ? 5n : 20n
    const win = (s.stake * mult) / 10n
    s.won += win; s.lastResult = { round: s.rounds, stake: fromAtomic(s.stake), payout: fromAtomic(win), ts: this.now() }
    if (s.staked - s.won + s.stake > s.lossLimit) this.halt('lossLimit')
  }
  pausePool () {
    const s = this.s; if (!s) return
    s.paused = true; s.pauseReason = 'pool_paused'
    if (this.timer) { clearInterval(this.timer); this.timer = null }
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      // Stub only: clear the forced pause and resume the round timer if the session is still live.
      this.forcePoolPaused = false
      if (this.s && this.s.running) {
        this.s.paused = false; this.s.pauseReason = ''
        this.timer = setInterval(() => this.round(), this.roundMs)
        if (this.timer.unref) this.timer.unref()
      }
    }, this.poolRetryMs)
    if (this.retryTimer.unref) this.retryTimer.unref()
  }
  halt (why) {
    if (!this.s) return
    this.s.running = false; this.s.paused = false; this.s.stoppedBy = why; this.s.pauseReason = ''
    if (this.timer) clearInterval(this.timer); this.timer = null
    if (this.retryTimer) clearTimeout(this.retryTimer); this.retryTimer = null
  }
  async stop () { this.halt('user'); return { ok: true, stub: true } }
  async status () {
    const s = this.s
    if (!s) return { ok: true, stub: true, running: false, paused: false, rounds: 0, staked: '0', won: '0', net: '0', lastResult: null, stoppedBy: '' }
    return { ok: true, stub: true, running: s.running, paused: !!s.paused, pauseReason: s.pauseReason || '', sessionId: s.id, rounds: s.rounds, staked: fromAtomic(s.staked), won: fromAtomic(s.won), net: fromAtomic(s.won - s.staked), lastResult: s.lastResult, stoppedBy: s.stoppedBy, endsAt: s.startedAt + s.sessionMs }
  }
}


module.exports = { StubX402Payer, StubLendBackend, StubWheelBackend }
