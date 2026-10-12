// 3.1.4: the agent heartbeat reads Rigel / node figures from the alternate ports (5155 / 18645) when the defaults are not used.
'use strict'
const assert = require('assert')
const http = require('http')
const { MinerManager } = require('../src/miner/manager')
const listen = (port, h) => new Promise(r => { const s = http.createServer(h); s.listen(port, '127.0.0.1', () => r(s)) })
;(async () => {
  const rig = await listen(5155, (q, s) => s.end(JSON.stringify({ hashrate: { ethash: 41230000 } })))
  const node = await listen(18645, (q, s) => { let b = ''; q.on('data', c => { b += c }); q.on('end', () => { const m = JSON.parse(b).method; s.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: m === 'net_peerCount' ? '0x5' : '0x1ad9b' })) }) })
  const out = await MinerManager.prototype.agentProbe.call({})
  assert.strictEqual(out.hashrate, 41230000); assert.strictEqual(out.rigelPort, 5155)
  assert.strictEqual(out.peers, 5); assert.strictEqual(out.localBlock, 0x1ad9b); assert.strictEqual(out.rpcPort, 18645)
  rig.close(); node.close()
  console.log('agent-probe: alternate ports 5155/18645 read ok')
})().catch(e => { console.error(e); process.exit(1) })
