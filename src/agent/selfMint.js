// 3.1.15: self-registered ERC-8004 identity (Agent Ledger "verified" v1-2026-10-21).
// The agent key (never the user's wallet account) sends register() on the Shard0 identity registry, so the
// mint tx comes from the agent address and ownerOf is the agent. When the agent has no SCDO for gas it asks the
// ledger once for a small drip (POST /gas/drip, envelope type "gas_drip") and waits until the balance is on
// chain before minting. Tokens minted by others are never burned or transferred. No key leaves identity.js.
'use strict'
const { Interface, id: keccakId, zeroPadValue, getAddress } = require('ethers')

const CHAIN_ID = 5680
const REGISTRY = '0xe1A6728e467ed9Fa2F2d0d7eE425a95c9d941F4d'
const METADATA_KEY = 'scdoLedgerAgent'
const REGISTERED = keccakId('Registered(uint256,string,address)')
const IFACE = new Interface([
  'function register(string agentURI, tuple(string metadataKey, bytes metadataValue)[] metadata) returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)'
])
const RPCS = ['https://scdo.com.au/rpc/0', 'https://apeccapital.org/rpc/0']

function agentURI (address) { return 'https://scdo.com.au/agent-ledger/api/agents/' + address + '/registration.json' }
function registerData (address) {
  return IFACE.encodeFunctionData('register', [agentURI(address), [[METADATA_KEY, '0x' + Buffer.from(address).toString('hex')]]])
}
const big = h => BigInt(h)

// rpc(method, params) -> result. Returns { tokenId, tx } or null.
async function findSelfMinted (rpc, address) {
  const logs = await rpc('eth_getLogs', [{ address: REGISTRY, fromBlock: '0x0', toBlock: 'latest', topics: [REGISTERED, null, zeroPadValue(address, 32).toLowerCase()] }])
  let best = null
  for (const l of logs || []) {
    const tokenId = big(l.topics[1])
    try {
      const owner = IFACE.decodeFunctionResult('ownerOf', await rpc('eth_call', [{ to: REGISTRY, data: IFACE.encodeFunctionData('ownerOf', [tokenId]) }, 'latest']))[0]
      const tx = await rpc('eth_getTransactionByHash', [l.transactionHash])
      if (owner.toLowerCase() !== address.toLowerCase() || !tx || String(tx.from).toLowerCase() !== address.toLowerCase()) continue
      if (!best || tokenId < best.tokenId) best = { tokenId, tx: l.transactionHash }
    } catch (e) { /* burned or unreadable: not counted */ }
  }
  return best
}

// opts: { address, rpc, signTx(tx)->raw hex, requestDrip()->Promise, sleep, dripWaitMs, pollMs, receiptWaitMs }
// Returns { already, tokenId, tx, drip }.
async function ensureSelfMint (opts) {
  const address = getAddress(opts.address)
  const rpc = opts.rpc
  const sleep = opts.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)))
  const found = await findSelfMinted(rpc, address)
  if (found) return { already: true, tokenId: found.tokenId.toString(), tx: found.tx }
  const data = registerData(address)
  let gas = big(await rpc('eth_estimateGas', [{ from: address, to: REGISTRY, data, value: '0x0' }]))
  gas += gas / 5n
  const gasPrice = big(await rpc('eth_gasPrice', []))
  const need = gas * gasPrice + (gas * gasPrice) / 10n
  let drip = null
  if (big(await rpc('eth_getBalance', [address, 'latest'])) < need) {
    if (!opts.requestDrip) throw new Error('no SCDO for gas')
    drip = await opts.requestDrip()
    const deadline = Date.now() + (opts.dripWaitMs || 3 * 60 * 1000)
    for (;;) {
      let bal = 0n
      try { bal = big(await rpc('eth_getBalance', [address, 'latest'])) } catch (e) {}
      if (bal >= need) break
      if (Date.now() > deadline) throw new Error('gas drip not confirmed yet')
      await sleep(opts.pollMs || 3000)
    }
  }
  const nonce = Number(big(await rpc('eth_getTransactionCount', [address, 'pending'])))
  const raw = await opts.signTx({ type: 0, chainId: CHAIN_ID, nonce, gasPrice, gasLimit: gas, to: REGISTRY, data, value: 0n })
  const hash = await rpc('eth_sendRawTransaction', [raw])
  const deadline = Date.now() + (opts.receiptWaitMs || 90 * 1000)
  for (;;) {
    const rec = await rpc('eth_getTransactionReceipt', [hash])
    if (rec) {
      if (rec.status !== '0x1') throw new Error('registration transaction reverted')
      const log = (rec.logs || []).find(l => l.topics && String(l.topics[0]).toLowerCase() === REGISTERED.toLowerCase())
      if (!log) throw new Error('registration receipt has no agent id')
      return { already: false, tokenId: big(log.topics[1]).toString(), tx: hash, drip }
    }
    if (Date.now() > deadline) throw new Error('registration transaction was not mined')
    await sleep(opts.pollMs || 3000)
  }
}

// JSON-RPC over the public Shard0 endpoints, first that answers.
function httpRpc (post, urls) {
  urls = urls || RPCS
  let n = 0
  return async (method, params) => {
    let last = null
    for (const url of urls) {
      const r = await post(url, { jsonrpc: '2.0', id: ++n, method, params }, 20000, true)
      if (r && r.body && r.body.error) throw new Error(String(r.body.error.message || 'rpc error').slice(0, 200))
      if (r && r.status === 200 && r.body && 'result' in r.body) return r.body.result
      last = r
    }
    throw new Error('shard0 rpc unreachable' + (last && last.error ? ': ' + last.error : ''))
  }
}

module.exports = { CHAIN_ID, REGISTRY, REGISTERED, agentURI, registerData, findSelfMinted, ensureSelfMint, httpRpc }
