// InviteRegistry on Shard0 (chain 5680).
// invite(address,uint96) payable creates a gift. cancel(address) withdraws it before claim.
// claim(address,address,bytes) is the on-chain claim. The screen paints before the receipt.
'use strict'
const { ethers } = require('ethers')

const REGISTRY = '0x458F974CcC4F1DB16Fe9F57489b134D7013bAD0d'
const CHAIN_ID = 5680
const MIN_GIFT = 1
const MAX_GIFT = 1000
const MAX_FEE_BPS = 1000
const IFACE = new ethers.Interface([
  'function invite(address id, uint96 sponsorFeeWei) payable',
  'function cancel(address id)',
  'function claim(address sponsor, address newbie, bytes sig)'
])

function clampGift (value) {
  const n = Math.floor(Number(value))
  if (!Number.isFinite(n) || n < MIN_GIFT) return MIN_GIFT
  if (n > MAX_GIFT) return MAX_GIFT
  return n
}

function giftWei (value) {
  return ethers.parseEther(String(clampGift(value)))
}

function sponsorFeeWei (valueWei, bps) {
  let b = Math.floor(Number(bps) || 0)
  if (!Number.isFinite(b) || b < 0) b = 0
  if (b > MAX_FEE_BPS) b = MAX_FEE_BPS
  return (BigInt(valueWei) * BigInt(b)) / 10000n
}

function isAddress (value) {
  return /^0x[0-9a-fA-F]{40}$/.test(String(value || ''))
}

function encodeInvite (id, feeWei) {
  if (!isAddress(id)) return ''
  return IFACE.encodeFunctionData('invite', [id, feeWei])
}

function encodeCancel (id) {
  if (!isAddress(id)) return ''
  return IFACE.encodeFunctionData('cancel', [id])
}

function encodeClaim (sponsor, newbie, sig) {
  if (!isAddress(sponsor) || !isAddress(newbie)) return ''
  const raw = String(sig || '')
  if (!/^0x[0-9a-fA-F]*$/.test(raw)) return ''
  return IFACE.encodeFunctionData('claim', [sponsor, newbie, raw])
}

function planCreate (input) {
  input = input || {}
  const gift = giftWei(input.gift)
  const fee = sponsorFeeWei(gift, input.feeBps)
  let wallet
  const given = String(input.secret || '').replace(/^0x/, '')
  if (/^[0-9a-fA-F]{64}$/.test(given)) wallet = new ethers.Wallet('0x' + given)
  else wallet = ethers.Wallet.createRandom()
  const id = wallet.address
  const data = encodeInvite(id, fee)
  const link = 'scdowallet://invite?s=' + wallet.privateKey.slice(2) + '&c=' + REGISTRY + '&n=' + CHAIN_ID
  return {
    to: REGISTRY,
    data: data,
    valueWei: gift.toString(),
    feeWei: fee.toString(),
    id: id,
    link: link
  }
}

function planCancel (id) {
  const data = encodeCancel(id)
  if (!data) return null
  return { to: REGISTRY, data: data, valueWei: '0', id: ethers.getAddress(id) }
}

function planClaim (sponsor, newbie, sig) {
  const data = encodeClaim(sponsor, newbie, sig)
  if (!data) return null
  return { to: REGISTRY, data: data, valueWei: '0' }
}

module.exports = {
  REGISTRY: REGISTRY,
  CHAIN_ID: CHAIN_ID,
  MIN_GIFT: MIN_GIFT,
  MAX_GIFT: MAX_GIFT,
  MAX_FEE_BPS: MAX_FEE_BPS,
  clampGift: clampGift,
  giftWei: giftWei,
  sponsorFeeWei: sponsorFeeWei,
  encodeInvite: encodeInvite,
  encodeCancel: encodeCancel,
  encodeClaim: encodeClaim,
  planCreate: planCreate,
  planCancel: planCancel,
  planClaim: planClaim
}
