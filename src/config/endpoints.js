// Public endpoints for the desktop wallet. Third-party RPC hosts are retired.
// Defaults are https://apeccapital.org/rpc/N, then https://scdo.com.au/rpc/N.
// A remote config document can override pools, RPC lists and the agent ledger.
'use strict'
const https = require('https')
const http = require('http')

const RETIRED_RPC_HOSTS = ['74.208.207.184', '117.50.97.136', '107.150.102.94']
const APEC_ORIGIN = 'https://apeccapital.org'
const SCAN_ORIGIN = 'https://scdo.com.au'
const REMOTE_CONFIG_URLS = [APEC_ORIGIN + '/wallet/config.json', SCAN_ORIGIN + '/wallet/config.json']
const DEFAULT_LEDGER = APEC_ORIGIN + '/agent-ledger/api'
const FALLBACK_LEDGER = SCAN_ORIGIN + '/agent-ledger/api'

let cachedRemote = null

function setCachedRemote (doc) { cachedRemote = normalizeRemote(doc) }
function getCachedRemote () { return cachedRemote }

function primaryConnect () {
  return [0, 1, 2, 3, 4].map(n => APEC_ORIGIN + '/rpc/' + n)
}
function fallbackConnect () {
  return [0, 1, 2, 3, 4].map(n => SCAN_ORIGIN + '/rpc/' + n)
}

function isRetiredRpc (url) {
  const s = String(url || '')
  if (!s) return false
  try {
    return RETIRED_RPC_HOSTS.includes(new URL(s).hostname)
  } catch (e) {
    return RETIRED_RPC_HOSTS.some(h => s.indexOf(h) >= 0)
  }
}

function sanitizeUrl (url) {
  try {
    const u = new URL(String(url || '').trim())
    if (u.username || u.password) return ''
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return ''
    if (u.protocol === 'http:' && u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') return ''
    const path = u.pathname.replace(/\/+$/, '')
    return u.origin + path + (u.search || '')
  } catch (e) { return '' }
}

function addUrl (list, url) {
  const s = sanitizeUrl(url)
  if (!s || isRetiredRpc(s) || list.indexOf(s) >= 0) return
  list.push(s)
}

function rpcCandidates (shard, opts) {
  opts = opts || {}
  const n = Number(shard)
  if (!Number.isInteger(n) || n < 0 || n > 4) return []
  const remote = opts.remote !== undefined ? opts.remote : cachedRemote
  const fromRemote = remote && remote.rpc && (remote.rpc[n] || remote.rpc[String(n)])
  if (Array.isArray(fromRemote)) {
    const cleaned = []
    for (const u of fromRemote) addUrl(cleaned, u)
    if (cleaned.length) return cleaned
  }
  const list = []
  const connect = opts.connect || []
  const fb = opts.connectFallback || []
  addUrl(list, connect[n])
  addUrl(list, primaryConnect()[n])
  addUrl(list, fb[n])
  addUrl(list, fallbackConnect()[n])
  return list
}

function migrateWalletConfig (cfg) {
  const next = cfg && typeof cfg === 'object' && !Array.isArray(cfg) ? cfg : {}
  let changed = false
  const primary = primaryConnect()
  const fallback = fallbackConnect()
  if (!Array.isArray(next.connect) || next.connect.length < 5) {
    next.connect = primary.slice()
    changed = true
  }
  for (let i = 0; i <= 4; i++) {
    if (!next.connect[i] || isRetiredRpc(next.connect[i])) {
      next.connect[i] = primary[i]
      changed = true
    }
  }
  if (!Array.isArray(next.connectFallback) || next.connectFallback.length < 5) {
    next.connectFallback = fallback.slice()
    changed = true
  }
  for (let i = 0; i <= 4; i++) {
    if (!next.connectFallback[i] || isRetiredRpc(next.connectFallback[i])) {
      next.connectFallback[i] = fallback[i]
      changed = true
    }
  }
  if (next.configVersion !== 3) { next.configVersion = 3; changed = true }
  return { config: next, changed }
}

function normalizeRemote (doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null
  const out = {}
  if (doc.zpowPools && typeof doc.zpowPools === 'object' && !Array.isArray(doc.zpowPools)) out.zpowPools = doc.zpowPools
  if (doc.rpc && typeof doc.rpc === 'object' && !Array.isArray(doc.rpc)) out.rpc = doc.rpc
  if (Array.isArray(doc.agentLedger)) out.agentLedger = doc.agentLedger.map(u => String(u))
  const hours = Number(doc.noRewardHours)
  if (Number.isFinite(hours) && hours >= 1 && hours <= 24 * 14) out.noRewardHours = hours
  const stale = Number(doc.payoutStaleHours)
  if (Number.isFinite(stale) && stale >= 1 && stale <= 24 * 14) out.payoutStaleHours = stale
  // Reward destination (TEST): server config for the lend endpoint (the rate itself is read from <url>/rate).
  if (doc.rewardLend && typeof doc.rewardLend === 'object' && !Array.isArray(doc.rewardLend)) {
    const u = sanitizeUrl(doc.rewardLend.url)
    if (u) out.rewardLend = { url: u }
  }
  return out
}

function ledgerUrls (opts) {
  opts = opts || {}
  if (opts.ledgerUrl) {
    const one = sanitizeUrl(opts.ledgerUrl)
    return one ? [one] : []
  }
  const env = opts.env || {}
  if (env.SCDO_AGENT_LEDGER) {
    const one = sanitizeUrl(env.SCDO_AGENT_LEDGER)
    return one ? [one] : []
  }
  const list = []
  const remote = opts.remote !== undefined ? opts.remote : cachedRemote
  const extra = remote && remote.agentLedger
  if (Array.isArray(extra)) for (const u of extra) addUrl(list, u)
  addUrl(list, DEFAULT_LEDGER)
  addUrl(list, FALLBACK_LEDGER)
  return list
}

function postJson (url, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    let u
    try { u = new URL(url) } catch (e) { return reject(e) }
    const data = Buffer.from(JSON.stringify(body))
    const lib = u.protocol === 'http:' ? http : https
    const req = lib.request(u, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': data.length },
      timeout: timeoutMs || 2500
    }, res => {
      let buf = ''
      res.on('data', c => { if (buf.length < 65536) buf += c })
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error('HTTP ' + res.statusCode))
        try { resolve(JSON.parse(buf)) } catch (e) { reject(e) }
      })
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
    req.end(data)
  })
}

function getJson (url, timeoutMs) {
  return new Promise((resolve, reject) => {
    let u
    try { u = new URL(url) } catch (e) { return reject(e) }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return reject(new Error('bad url'))
    const lib = u.protocol === 'http:' ? http : https
    const req = lib.get(u, { timeout: timeoutMs || 4000, headers: { accept: 'application/json' } }, res => {
      if (res.statusCode < 200 || res.statusCode >= 300) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)) }
      let buf = ''
      res.on('data', c => { if (buf.length < 65536) buf += c })
      res.on('end', () => { try { resolve(JSON.parse(buf)) } catch (e) { reject(e) } })
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
  })
}

async function firstReachable (urls, opts) {
  opts = opts || {}
  const list = (urls || []).filter(Boolean)
  const method = opts.method || 'web3_clientVersion'
  const post = opts.post || postJson
  for (const url of list) {
    try {
      const j = await post(url, { jsonrpc: '2.0', id: 1, method, params: [] }, opts.timeoutMs || 2500)
      if (j && (j.result !== undefined || j.error)) return url
    } catch (e) {}
  }
  return list[0] || ''
}

module.exports = {
  RETIRED_RPC_HOSTS,
  APEC_ORIGIN,
  SCAN_ORIGIN,
  REMOTE_CONFIG_URLS,
  DEFAULT_LEDGER,
  FALLBACK_LEDGER,
  setCachedRemote,
  getCachedRemote,
  primaryConnect,
  fallbackConnect,
  isRetiredRpc,
  sanitizeUrl,
  rpcCandidates,
  migrateWalletConfig,
  normalizeRemote,
  ledgerUrls,
  postJson,
  getJson,
  firstReachable
}
