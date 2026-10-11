// shard0 (core-geth Ethash EVM, chainId 5680) support for ScdoWallet.
// The same secp256k1 private key that controls an old-shard account (1S01.., 2S02..)
// also controls exactly one 0x address on shard0 (keccak256(pubkey)[12:]).
'use strict'
const { ethers } = require('ethers')
const { guardAmount } = require('../js/amount')

function sendAmount (amount, decimals) {
  const dec = decimals == null ? 18 : Math.max(0, Number(decimals) || 0)
  const g = guardAmount(amount == null || amount === '' ? '0' : amount, Math.min(8, dec))
  if (!g.ok) {
    const err = new Error(g.code)
    err.code = g.code
    throw err
  }
  return g.value
}

const DEFAULT_SHARD0 = {
  rpc: 'https://scdoscan.io/rpc/0',
  chainId: 5680,
  explorer: 'https://scdoscan.io',
  faucet: 'https://scdoscan.io/rpc/0/faucet',
  tokens: [
    { symbol: 'tUSDT', address: '0xb042c1833687d05cba414f04ec4013744ddeadcc', decimals: 6 },
    { symbol: 'tAUD', address: '0x13c22e6944eeeca58768dcaaa03dd485fb8c9ad0', decimals: 2 }
  ]
}
const ERC20 = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function transfer(address to, uint256 amount) returns (bool)'
]

class Shard0 {
  constructor (cfg) {
    this.cfg = Object.assign({}, DEFAULT_SHARD0, cfg || {})
    this.provider = new ethers.JsonRpcProvider(this.cfg.rpc,
      { chainId: this.cfg.chainId, name: 'scdo-shard0' }, { staticNetwork: true, batchMaxCount: 1 })
  }

  static addressFromPrivateKey (priv) {
    return new ethers.Wallet(priv).address // EIP-55 checksummed
  }

  static isAddress (a) {
    return typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a) && ethers.isAddress(a)
  }

  async chainInfo () {
    const [chainId, block] = await Promise.all([
      this.provider.send('eth_chainId', []), this.provider.getBlockNumber()])
    return { chainId: parseInt(chainId, 16), block }
  }

  // -> { native: '1.23', nativeWei: bigint, tokens: [{symbol, balance, raw}] }
  async balances (address) {
    const nativeWei = await this.provider.getBalance(address)
    const tokens = await Promise.all(this.cfg.tokens.map(async t => {
      try {
        const c = new ethers.Contract(t.address, ERC20, this.provider)
        const raw = await c.balanceOf(address)
        return { symbol: t.symbol, address: t.address, decimals: t.decimals, raw, balance: ethers.formatUnits(raw, t.decimals) }
      } catch (e) {
        return { symbol: t.symbol, address: t.address, decimals: t.decimals, raw: null, balance: '?', error: String(e.message || e) }
      }
    }))
    return { native: ethers.formatEther(nativeWei), nativeWei, tokens }
  }

  token (symbol) {
    return this.cfg.tokens.find(t => t.symbol === symbol)
  }

  buildReq (to, amount, asset) {
    if (!Shard0.isAddress(to)) throw new Error('invalid shard0 address (0x + 40 hex): ' + to)
    if (!asset || asset === 'SCDO') return { to, value: ethers.parseEther(sendAmount(amount)) }
    const t = this.token(asset)
    if (!t) throw new Error('unknown token ' + asset)
    const iface = new ethers.Interface(ERC20)
    return { to: t.address, value: 0n, data: iface.encodeFunctionData('transfer', [to, ethers.parseUnits(sendAmount(amount, t.decimals), t.decimals)]) }
  }

  // 2.0.2 rerun N-1: sign with an explicit nonce, no broadcast -> { raw, hash, tx }. The hash is known before broadcasting,
  // so the wallet can record the transfer first and never lose track of it (timeouts, crashes).
  async signWithNonce (priv, to, amount, asset, nonce) {
    const wallet = new ethers.Wallet(priv, this.provider)
    const tx = await this.prepare(wallet, this.buildReq(to, amount, asset), nonce)
    const raw = await wallet.signTransaction(tx)
    return { raw, hash: ethers.keccak256(raw), tx }
  }

  // 2.0.2 rerun N-2: broadcast an already signed tx with a hard timeout (ethers' default is 5 min).
  async broadcastRaw (raw, timeoutMs) {
    let t
    try {
      return await Promise.race([this.provider.send('eth_sendRawTransaction', [raw]),
        new Promise((resolve, reject) => { t = setTimeout(() => reject(new Error('BROADCAST_TIMEOUT')), timeoutMs || 20000) })])
    } finally { clearTimeout(t) }
  }

  // Build + sign (EIP-1559, chainId 5680) + broadcast. asset = 'SCDO' or a token symbol.
  async send (priv, to, amount, asset, opts) {
    opts = opts || {}
    const wallet = new ethers.Wallet(priv, this.provider)
    const req = this.buildReq(to, amount, asset)
    const tx = await this.prepare(wallet, req)
    if (opts.dryRun) return { signed: await wallet.signTransaction(tx), tx }
    const resp = await wallet.sendTransaction(tx)
    return { hash: resp.hash, tx, response: resp }
  }

  async prepare (wallet, req, fixedNonce) {
    const from = await wallet.getAddress()
    const [nonce, fee, gas] = await Promise.all([
      fixedNonce != null ? Promise.resolve(fixedNonce) : this.provider.getTransactionCount(from, 'pending'),
      this.provider.getFeeData(),
      this.provider.estimateGas(Object.assign({ from }, req))
    ])
    const tip = fee.maxPriorityFeePerGas && fee.maxPriorityFeePerGas > 0n ? fee.maxPriorityFeePerGas : 1000000000n
    const block = await this.provider.getBlock('latest')
    const base = block && block.baseFeePerGas != null ? block.baseFeePerGas : (fee.gasPrice || 1000000000n)
    return Object.assign({}, req, {
      type: 2,
      chainId: this.cfg.chainId,
      nonce,
      gasLimit: gas === 21000n ? gas : gas * 12n / 10n, // 2.0.2 D-03
      maxPriorityFeePerGas: tip,
      maxFeePerGas: base * 2n + tip
    })
  }

  // Fee preview for the send flow (no key needed): same gas/fee rules as prepare().
  // -> { gasLimit, maxFeePerGas, baseFee, tip, maxFeeWei (upper bound), estFeeWei (likely) }
  async estimateSend (from, to, amount, asset) {
    let req
    if (!asset || asset === 'SCDO') req = { from, to, value: ethers.parseEther(sendAmount(amount || '0')) }
    else {
      const t = this.token(asset); if (!t) throw new Error('unknown token ' + asset)
      const iface = new ethers.Interface(ERC20)
      req = { from, to: t.address, value: 0n, data: iface.encodeFunctionData('transfer', [to, ethers.parseUnits(sendAmount(amount || '0', t.decimals), t.decimals)]) }
    }
    const [fee, block] = await Promise.all([this.provider.getFeeData(), this.provider.getBlock('latest')])
    let gas
    try { gas = await this.provider.estimateGas(req) } catch (e) { gas = (!asset || asset === 'SCDO') ? 21000n : 65000n }
    const tip = fee.maxPriorityFeePerGas && fee.maxPriorityFeePerGas > 0n ? fee.maxPriorityFeePerGas : 1000000000n
    const base = block && block.baseFeePerGas != null ? block.baseFeePerGas : (fee.gasPrice || 1000000000n)
    const gasLimit = gas === 21000n ? gas : gas * 12n / 10n // 2.0.2 D-03
    const maxFeePerGas = base * 2n + tip
    return { gasLimit, maxFeePerGas, baseFee: base, tip, maxFeeWei: gasLimit * maxFeePerGas, estFeeWei: gas * (base + tip) }
  }

  async waitReceipt (hash, timeoutMs) {
    return this.provider.waitForTransaction(hash, 1, timeoutMs || 180000)
  }

  explorerTx (hash) { return this.cfg.explorer + '/#/tx?txhash=' + hash }
  explorerAddress (a) { return this.cfg.explorer + '/#/address?address=' + a }
}

module.exports = { Shard0, DEFAULT_SHARD0, ERC20 }
