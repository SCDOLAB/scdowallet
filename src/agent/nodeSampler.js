// 3.1.15: per-minute readings of the local Shard0 EVM node for the signed heartbeat
// (same fields as linux-agent 0.5.9, cursor/linux-agent-059-nodesync): head_block, head_hash,
// peer_count, enode (admin_nodeInfo when exposed) and node_samples [{t,h,hash,peers}].
// Only a node on chainId 5680 counts. No node: nothing is added. Public chain data only.
'use strict'
const http = require('http')

const SHARD0_CHAIN_ID = 5680
const MAX_SAMPLES = 120
const DEFAULT_URLS = ['http://127.0.0.1:8545', 'http://127.0.0.1:18545']

function rpcHttp (url, method, params, timeoutMs) {
  return new Promise((resolve, reject) => {
    let u
    try { u = new URL(url) } catch (e) { return reject(e) }
    if (u.protocol !== 'http:' || (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost')) return reject(new Error('local http only'))
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params || [] })
    const rq = http.request({ hostname: u.hostname, port: u.port || 80, path: u.pathname || '/', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, timeout: timeoutMs || 3000 }, (r) => {
      let data = ''
      r.setEncoding('utf8')
      r.on('data', (c) => { data += c; if (data.length > 65536) rq.destroy(new Error('too large')) })
      r.on('end', () => {
        try {
          const j = JSON.parse(data)
          if (j.error || j.result == null) return reject(new Error('rpc error'))
          resolve(j.result)
        } catch (e) { reject(e) }
      })
    })
    rq.on('timeout', () => rq.destroy(new Error('timeout')))
    rq.on('error', reject)
    rq.end(body)
  })
}

const hexU = (s) => { const v = parseInt(String(s || '').replace(/^0x/, ''), 16); return Number.isFinite(v) ? v : 0 }

class NodeSampler {
  constructor (opts) {
    opts = opts || {}
    const env = opts.env || process.env
    this.urls = opts.urls || (env.SCDO_NODE_RPC ? String(env.SCDO_NODE_RPC).split(',').map(s => s.trim()).filter(Boolean) : DEFAULT_URLS)
    this.rpc = opts.rpc || rpcHttp
    this.now = opts.now || (() => Math.floor(Date.now() / 1000))
    this.samples = []
    this.enode = ''
    this.sentTo = 0
    this.timer = null
  }

  async sample () {
    for (const url of this.urls) {
      try {
        if (hexU(await this.rpc(url, 'eth_chainId', [])) !== SHARD0_CHAIN_ID) continue
        const blk = await this.rpc(url, 'eth_getBlockByNumber', ['latest', false])
        if (!blk || !blk.hash) continue
        const pc = await this.rpc(url, 'net_peerCount', [])
        let enode = ''
        try { const info = await this.rpc(url, 'admin_nodeInfo', []); enode = (info && (info.id || info.enode)) || '' } catch (e) {}
        this.samples.push({ t: this.now(), h: hexU(blk.number), hash: String(blk.hash).toLowerCase(), peers: hexU(pc) })
        if (this.samples.length > MAX_SAMPLES) this.samples = this.samples.slice(-MAX_SAMPLES)
        if (enode) this.enode = String(enode)
        return true
      } catch (e) {}
    }
    return false
  }

  // Adds the latest reading and every sample not yet accepted into a heartbeat body.
  addTo (body) {
    if (!body || !this.samples.length) return body
    const last = this.samples[this.samples.length - 1]
    body.head_block = last.h
    body.head_hash = last.hash
    body.peer_count = last.peers
    if (this.enode) body.enode = this.enode
    body.node_samples = this.samples.map(x => ({ t: x.t, h: x.h, hash: x.hash, peers: x.peers }))
    this.sentTo = last.t
    return body
  }

  // After an accepted heartbeat: keep only samples newer than the ones it carried.
  clear () { this.samples = this.samples.filter(x => x.t > this.sentTo) }

  start (everyMs) {
    if (this.timer) return
    const run = () => { this.sample().catch(() => {}) }
    this.timer = setInterval(run, everyMs || 60000)
    if (this.timer.unref) this.timer.unref()
    run()
  }

  stop () { if (this.timer) clearInterval(this.timer); this.timer = null }
}

module.exports = { NodeSampler, rpcHttp, SHARD0_CHAIN_ID, MAX_SAMPLES }
