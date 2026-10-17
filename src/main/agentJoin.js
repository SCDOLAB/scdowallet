// Local join state: attribution lock, payout, install id, cached referral code.
// The install id never leaves this process. Register sends only sha256(installId).
'use strict'
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const https = require('https')
const http = require('http')
const { URL } = require('url')
const Join = require('../js/agentJoin')

function empty () {
  return {
    installId: '',
    device: '',
    pendingRef: '',
    pendingSrc: '',
    ref: '',
    src: '',
    locked: false,
    payout: '',
    payoutFile: '',
    payoutSource: '',
    code: '',
    shareUrl: '',
    usdcWallet: ''
  }
}

function createStore (file) {
  function load () {
    let raw = null
    try { raw = JSON.parse(fs.readFileSync(file, 'utf8')) } catch (e) { raw = null }
    const s = Object.assign(empty(), raw || {})
    if (!s.installId) s.installId = crypto.randomBytes(16).toString('hex')
    const hash = Join.deviceHash(s.installId)
    if (hash && s.device !== hash) s.device = hash
    if (!raw || !raw.installId || raw.device !== s.device) save(s)
    return s
  }
  function save (s) {
    const dir = path.dirname(file)
    fs.mkdirSync(dir, { recursive: true })
    const tmp = file + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(s), { mode: 0o600 })
    fs.renameSync(tmp, file)
  }
  function remember (parsed) {
    const s = load()
    const next = Join.rememberJoin(s, parsed)
    s.pendingRef = next.pendingRef
    s.pendingSrc = next.pendingSrc
    save(s)
    return publicView(s)
  }
  function lock (typedRef) {
    const s = load()
    const next = Join.lockAttribution(s, typedRef)
    s.locked = next.locked
    s.pendingRef = next.pendingRef
    s.pendingSrc = next.pendingSrc
    s.ref = next.ref
    s.src = next.src
    save(s)
    return publicView(s)
  }
  function currentPayout (minerWallet, accounts, intent) {
    const s = load()
    if (Join.validPayout(s.payout)) return { payout: s.payout, intentPatch: Join.bookkeepingPatch(intent, s.payout) }
    const miner = Join.validPayout(minerWallet)
    const choice = miner
      ? { payout: miner, changed: true, file: s.payoutFile || '' }
      : Join.choosePayout(accounts, s.payoutFile, '')
    if (!choice.payout) return { payout: '', intentPatch: {} }
    s.payout = choice.payout
    if (choice.file) s.payoutFile = choice.file
    if (!s.payoutSource) s.payoutSource = 'auto'
    save(s)
    return { payout: s.payout, intentPatch: Join.bookkeepingPatch(intent, s.payout) }
  }
  function setPayout (address, fileName, source) {
    const s = load()
    const addr = Join.validPayout(address)
    if (!addr) return publicView(s)
    s.payout = addr
    if (fileName) s.payoutFile = fileName
    s.payoutSource = source === 'settings' ? 'settings' : 'auto'
    save(s)
    return publicView(s)
  }
  function useSelection (accounts, fileName, intent) {
    const s = load()
    if (s.payoutSource === 'settings' && Join.validPayout(s.payout)) {
      return { view: publicView(s), changed: false, intentPatch: Join.bookkeepingPatch(intent, s.payout) }
    }
    const choice = Join.choosePayout(accounts, fileName, '')
    if (!choice.payout) return { view: publicView(s), changed: false, intentPatch: {} }
    const changed = choice.payout !== s.payout
    s.payout = choice.payout
    s.payoutFile = choice.file || fileName || ''
    if (!s.payoutSource) s.payoutSource = 'auto'
    save(s)
    return { view: publicView(s), changed: changed, intentPatch: Join.bookkeepingPatch(intent, s.payout) }
  }
  function setRefcode (row) {
    const s = load()
    if (row && row.code) s.code = String(row.code)
    if (row && row.shareUrl) s.shareUrl = String(row.shareUrl)
    save(s)
    return publicView(s)
  }
  function setUsdc (address) {
    const s = load()
    if (Join.JOIN.addressRe.test(String(address || ''))) {
      s.usdcWallet = String(address)
      save(s)
    }
    return publicView(s)
  }
  function joinExtra () {
    const s = load()
    return { ref: s.ref, src: s.src, device: s.device, usdcWallet: s.usdcWallet }
  }
  function publicView (s) {
    s = s || load()
    return {
      ref: s.ref || '',
      src: s.src || '',
      pendingRef: s.locked ? '' : (s.pendingRef || ''),
      pendingSrc: s.locked ? '' : (s.pendingSrc || ''),
      locked: !!s.locked,
      payout: s.payout || '',
      payoutFile: s.payoutFile || '',
      payoutSource: s.payoutSource || '',
      device: s.device || '',
      code: s.code || '',
      shareUrl: s.shareUrl || '',
      usdcWallet: s.usdcWallet || ''
    }
  }
  return { load, save, remember, lock, currentPayout, setPayout, useSelection, setRefcode, setUsdc, joinExtra, publicView }
}

function getJson (url, timeoutMs) {
  return new Promise(resolve => {
    let u
    try { u = new URL(url) } catch (e) { return resolve(null) }
    const lib = u.protocol === 'http:' ? http : https
    const req = lib.request(u, { method: 'GET', timeout: timeoutMs || 8000 }, res => {
      let body = ''
      res.on('data', c => { if (body.length < 200000) body += c })
      res.on('end', () => {
        if (res.statusCode !== 200) return resolve(null)
        try { resolve(JSON.parse(body)) } catch (e) { resolve(null) }
      })
    })
    req.on('timeout', () => req.destroy())
    req.on('error', () => resolve(null))
    req.end()
  })
}

function ledgerView (record, registration) {
  const summary = record && record.summary ? record.summary : {}
  const reserve = Join.x402Reserve(registration) || Join.x402Reserve(record) || Join.x402Reserve(summary)
  return {
    online: summary.online === true ? true : (summary.online === false ? false : null),
    entries: Join.ledgerEntries(record),
    x402Reserve: reserve || '',
    payout: summary.payout || ''
  }
}

function createController (opts) {
  opts = opts || {}
  const store = opts.store
  const env = opts.env || process.env
  function agent () { return opts.agent ? opts.agent() : null }
  async function ledger (agentId) {
    if (Join.useFake(env)) {
      const reg = Join.fakeRegistration()
      return ledgerView(Join.fakeAgent(), reg)
    }
    const svc = agent()
    const id = String(agentId || (svc && svc.id && svc.id.agentId) || '')
    if (!/^0x[0-9a-fA-F]{40}$/.test(id)) return { online: null, entries: [], x402Reserve: '', payout: '' }
    const base = (svc && svc.ledger ? svc.ledger : (Join.JOIN.base + Join.JOIN.ledgerPrefix)).replace(/\/$/, '')
    const record = await getJson(base + '/agents/' + id)
    const registration = await getJson(base + '/agents/' + id + '/registration.json')
    const view = ledgerView(record, registration)
    if (!record) view.reachable = false
    if (view.x402Reserve) store.setUsdc(view.x402Reserve)
    return view
  }
  async function refcode () {
    if (Join.useFake(env)) {
      const fake = Join.fakeRefcode()
      store.setRefcode(fake)
      return fake
    }
    const cached = store.publicView()
    if (cached.code && cached.shareUrl) return { ok: true, code: cached.code, shareUrl: cached.shareUrl }
    const svc = agent()
    if (!svc || !svc.refcode) return { ok: false, error: 'no agent' }
    let row = null
    try { row = await svc.refcode() } catch (e) { row = { ok: false, error: 'refcode' } }
    const body = row && row.body
    if (row && row.ok && body && body.code && body.shareUrl) {
      store.setRefcode({ code: body.code, shareUrl: body.shareUrl })
      return { ok: true, code: String(body.code), shareUrl: String(body.shareUrl) }
    }
    return { ok: false, error: (row && (row.error || row.status)) || 'refcode' }
  }
  async function snapshot (status) {
    const view = store.publicView()
    const svc = agent()
    const st = status || (svc && svc.status ? svc.status() : null) || {}
    let led = { online: null, entries: [], x402Reserve: view.usdcWallet || '', payout: '' }
    if (st.agentId) {
      try { led = await ledger(st.agentId) } catch (e) { led = { online: null, entries: [], x402Reserve: '', reachable: false } }
    }
    const registered = !!(st && st.registered)
    const card = Join.cardStatus({
      registered: registered,
      online: led.online,
      reachable: led.reachable === false ? false : true
    })
    return {
      ref: view.ref,
      src: view.src,
      pendingRef: view.pendingRef,
      locked: view.locked,
      payout: view.payout || (st && st.payout) || '',
      payoutSource: view.payoutSource,
      shareUrl: view.shareUrl,
      code: view.code,
      x402Reserve: led.x402Reserve || view.usdcWallet || '',
      entries: led.entries || [],
      status: card,
      registered: registered,
      agentId: (st && st.agentId) || '',
      online: led.online
    }
  }
  return { store, ledger, refcode, snapshot }
}

module.exports = { createStore, createController, getJson, ledgerView }
