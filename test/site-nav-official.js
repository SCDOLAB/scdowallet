// Official scdo.com.au top nav (site-functions.json) is the in-app bar, one id per destination.
'use strict'
const assert = require('assert')
const siteNav = require('../src/js/siteNavMap')

const tops = siteNav.GROUPS.filter(g => g.id !== 'home').map(g => g.id)
assert.deepStrictEqual(tops, ['gpu', 'wallets', 'games', 'treasury', 'chain', 'mining', 'prod', 'dev', 'res', 'about'])
assert.strictEqual(siteNav.byId('gpu').cn, 'GPU 共享')
assert.strictEqual(siteNav.byId('wallets').cn, '錢包')
assert.strictEqual(siteNav.byId('games').cn, '遊戲')
assert.strictEqual(siteNav.byId('treasury').cn, '金庫')
assert.strictEqual(siteNav.byId('chain').cn, '區塊鏈')
assert.strictEqual(siteNav.byId('mining').cn, '運算服務')
assert.strictEqual(siteNav.byId('prod').cn, '產品')
assert.strictEqual(siteNav.byId('dev').cn, '開發者')
assert.strictEqual(siteNav.byId('res').cn, '資源')
assert.strictEqual(siteNav.byId('about').cn, '關於')
assert.strictEqual(siteNav.byId('mining').en, 'Compute')
assert.strictEqual(siteNav.byId('wallets').barSingle, true)
assert.strictEqual(siteNav.byId('wallets').action, 'wallet')

const hrefs = {
  gpu: 'https://scdo.com.au/gpu-share/',
  walletSite: 'https://scdo.com.au/wallets/',
  games: 'https://scdo.com.au/games/',
  treasury: 'https://scdo.com.au/treasury/',
  explorer: 'https://scdo.com.au/scan/',
  blocks: 'https://scdo.com.au/scan/#/blocks',
  txs: 'https://scdo.com.au/scan/#/txs',
  tokens: 'https://scdo.com.au/scan/#/tokens',
  gas: 'https://scdo.com.au/gastracker',
  mine: 'https://scdo.com.au/mine/',
  pool: 'https://scdo.com.au/pool/',
  nodes: 'https://scdo.com.au/nodes/',
  launch: 'https://scdo.com.au/launch',
  enterprise: 'https://scdo.com.au/enterprise/',
  api: 'https://scdo.com.au/api-docs.html',
  verify: 'https://scdo.com.au/verify-contract.html',
  start: 'https://scdo.com.au/start.html',
  blog: 'https://scdo.com.au/blog/',
  papers: 'https://scdo.com.au/papers/',
  docs: 'https://scdo-laboratory.gitbook.io/scdolab',
  ip: 'https://scdo.com.au/ip/',
  bounty: 'https://scdo.com.au/games/stakewheel/',
  agents: 'https://scdo.com.au/agents/',
  team: 'https://scdo.com.au/team/',
  roadmap: 'https://scdo.com.au/roadmap/',
  partners: 'https://scdo.com.au/partners',
  transparency: 'https://scdo.com.au/transparency/',
  compliance: 'https://scdo.com.au/compliance.html',
  investors: 'https://scdo.com.au/investors/'
}
for (const id of Object.keys(hrefs)) {
  const it = siteNav.byId(id)
  assert.ok(it, id)
  assert.strictEqual(siteNav.url(it.href), hrefs[id], id)
}
assert.strictEqual(siteNav.byId('mine').action, 'mineHome')
assert.strictEqual(siteNav.byId('localNode').action, 'mineSettings')
assert.strictEqual(siteNav.byId('wallet').action, 'wallet')
assert.strictEqual(siteNav.match('記帳').id, 'mine')
assert.ok(siteNav.GROUPS.find(g => g.id === 'chain').children.some(c => c.id === 'explorer'))
assert.ok(siteNav.GROUPS.find(g => g.id === 'mining').children.map(c => c.cn).join(',').includes('算力中心'))

console.log('site-nav-official: ok')
