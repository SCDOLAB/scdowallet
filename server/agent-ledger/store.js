// Append-only JSONL store + in-memory index. Holds addresses, signatures and status; never any key.
'use strict'
const fs = require('fs')
const path = require('path')

class Store {
  constructor (dir) {
    this.dir = dir
    fs.mkdirSync(dir, { recursive: true })
    this.file = path.join(dir, 'envelopes.jsonl')
    this.agents = new Map()
    this.load()
  }
  load () {
    let text = ''
    try { text = fs.readFileSync(this.file, 'utf8') } catch (e) { return }
    for (const line of text.split('\n')) { if (!line) continue; try { this.index(JSON.parse(line)) } catch (e) {} }
  }
  index (rec) {
    const p = rec.env.payload
    const key = p.agent.toLowerCase()
    let a = this.agents.get(key)
    if (!a) { a = { agent: p.agent, firstSeen: rec.receivedAt, seq: 0, registration: null, heartbeat: null, heals: [], counts: { heartbeat: 0, heal: 0 } }; this.agents.set(key, a) }
    a.seq = Math.max(a.seq, p.seq)
    a.lastSeen = rec.receivedAt
    if (p.type === 'register') a.registration = { ts: p.ts, body: p.body, sig: rec.env.sig }
    else if (p.type === 'heartbeat') { a.heartbeat = { ts: p.ts, body: p.body, sig: rec.env.sig, seq: p.seq }; a.counts.heartbeat++ }
    else if (p.type === 'heal') { a.heals.push({ ts: p.ts, body: p.body, sig: rec.env.sig, seq: p.seq }); if (a.heals.length > 50) a.heals.shift(); a.counts.heal++ }
  }
  append (env) {
    const rec = { receivedAt: Date.now(), env }
    fs.appendFileSync(this.file, JSON.stringify(rec) + '\n')
    this.index(rec)
    return rec
  }
  get (agent) { return this.agents.get(String(agent || '').toLowerCase()) || null }
  size () { return this.agents.size }
}
module.exports = { Store }
