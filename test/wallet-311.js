// 3.1.1: miner speed before the first share, session earnings, send result, receive.
'use strict'
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const root = path.join(__dirname, '..')
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8')
const mine = require('../src/js/mineHome.js')
const { workerFigure, sessionDelta } = require('../src/miner/zpow/status')

const box = { window: {} }
vm.runInNewContext(read('src/js/i18n112.js'), box)
const I = box.window.I18N112
const CN = (k, p) => {
  let s = I.CN[k]
  if (s == null) s = k
  if (p) s = String(s).replace(/\{(\w+)\}/g, (m, n) => p[n] != null ? p[n] : m)
  return s
}
const esc = (s) => String(s == null ? '' : s)
const ui = read('src/js/app112.js')
const pay = ui.slice(ui.indexOf('function payModal'), ui.indexOf('function payShowLedger'))

assert.strictEqual(I.CN.shellBoot, '啟動中')
assert.strictEqual(I.CN.shellMineOn, '運算中')
assert.strictEqual(I.CN.sessionEarn, '本次收益')
assert.strictEqual(I.CN.sessionEarnShares, '份額 {n}')
assert.strictEqual(I.CN.sessionEarnPaid, '收益 {n} SCDO')
assert.strictEqual(I.EN.sessionEarnShares, 'Shares {n}')
assert.strictEqual(I.EN.sessionEarnPaid, 'Paid {n} SCDO')
assert.strictEqual(I.CN.shellDupAsk, '要再送一次一樣的轉帳嗎？')
assert.strictEqual(I.CN.shellDupNo, '取消')
assert.strictEqual(I.CN.shellDupYes, '確定再送一次')
assert.strictEqual(I.CN.wizNoRepeat, '請勿重複送出')
assert.strictEqual(I.CN.wizQuery, '這筆交易可能已送出，正在查詢')
assert.strictEqual(I.CN.wizSent, '已送出')
assert.strictEqual(I.CN.wizCopyHash, '複製交易雜湊')
assert.strictEqual(I.CN.wizScan, '在 apeccapital.org 查看')
assert.strictEqual(I.CN.wizFinish, '完成')
assert.strictEqual(I.CN.relNotes[0].v, '3.1.4')
assert.strictEqual(I.CN.relNotes.find(n => n.v === '3.1.1').items[0].includes('按開始之後'), true)
assert.ok(!/[\u4e00-\u9fff]/.test(I.EN.relNotes[0].items.join(' ')))
assert.ok(!/收益|價格|年化|報酬|yield|return|price|幣安|binance|okx/i.test(I.EN.relNotes[0].items[0]))

const booting = mine.minePageHtml({
  miners: {
    classicGpu: {
      running: true, mode: 'gpu', chain: 'classic', shard: 1, backend: 'zminer-gpu',
      code: 'POOL_CONNECTING', phase: 'starting', procs: ['zminer-gpu'],
      hashrate: null, rateSeen: false, sharesAccepted: 0, sharesSeen: false, sessionEarn: null
    }
  },
  chains: { cpu: [], gpu: [1] }
}, CN, esc)
assert.ok(booting.includes('啟動中'))
assert.ok(booting.includes('本次收益'))
assert.ok(booting.includes('class="dash"'))
assert.ok(booting.includes('mine-load wait'))
assert.ok(!booting.includes('每秒'))
assert.ok(!/<details\b[^>]*\sopen/.test(booting))

const running = mine.minePageHtml({
  miners: {
    classicGpu: {
      running: true, mode: 'gpu', chain: 'classic', shard: 1, backend: 'zminer-gpu',
      code: 'CLASSIC_MINING', phase: 'mining', procs: ['zminer-gpu'],
      hashrate: 180000, hashrateSource: 'status', rateSeen: true, sharesAccepted: 2, sharesSeen: true,
      sessionEarn: { exposed: true, shares: 2, paid: '0.5', earned: null },
      localBlock: 8
    }
  },
  chains: { cpu: [], gpu: [1] },
  pools: { 1: { online: true, chain_height: 12, network_difficulty: '99' } }
}, CN, esc)
assert.ok(running.includes('運算中'))
assert.ok(running.includes('每秒 180,000'))
assert.ok(running.includes('份額 2 · 收益 0.5 SCDO'))
assert.ok(!running.includes('>2 · 0.5 SCDO<'))

const zeroPay = mine.minePageHtml({
  miners: {
    classicGpu: {
      running: true, mode: 'gpu', chain: 'classic', shard: 1, backend: 'zminer-gpu',
      code: 'CLASSIC_MINING', phase: 'mining', procs: ['zminer-gpu'],
      hashrate: 260000, hashrateSource: 'status', rateSeen: true, sharesAccepted: 109, sharesSeen: true,
      sessionEarn: { exposed: true, shares: 109, paid: '0', earned: null }
    }
  },
  chains: { cpu: [], gpu: [1] }
}, CN, esc)
assert.ok(zeroPay.includes('份額 109 · 收益 0 SCDO'))
assert.ok(!zeroPay.includes('109 · 0 SCDO'))
const unknownEarn = mine.minePageHtml({
  miners: {
    classicGpu: {
      running: true, mode: 'gpu', chain: 'classic', shard: 1, backend: 'zminer-gpu',
      code: 'CLASSIC_MINING', phase: 'mining', procs: ['zminer-gpu'],
      hashrate: 1000, hashrateSource: 'status', rateSeen: true, sessionEarn: null
    }
  },
  chains: { cpu: [], gpu: [1] }
}, CN, esc)
const unknownLine = unknownEarn.slice(unknownEarn.indexOf('class="mine-earn"'), unknownEarn.indexOf('</div>', unknownEarn.indexOf('class="mine-earn"')))
assert.ok(unknownLine.includes('本次收益'))
assert.ok(unknownLine.includes('class="dash"'))
assert.ok(unknownLine.includes('\u2014'))
assert.ok(!unknownLine.includes('份額'))
assert.ok(running.includes('mine-load run'))
assert.ok(running.includes('本機高度'))
assert.ok(running.includes('網路難度'))
assert.ok(running.includes('99'))
const xBody = running.slice(running.indexOf('mine-x-body'), running.indexOf('</details>', running.indexOf('mine-x-body')))
assert.ok(xBody.length > 0 && !xBody.includes('<details'))
assert.ok(!/<details\b[^>]*\sopen/.test(running))

const line = mine.homeLine({
  miners: {
    classicGpu: {
      running: true, mode: 'gpu', chain: 'classic', shard: 1, backend: 'zminer-gpu',
      procs: ['zminer-gpu'], phase: 'starting', code: 'POOL_CONNECTING'
    }
  },
  pools: { 1: { online: true, chain_height: 10 }, 2: { online: true, chain_height: 20 }, 3: { online: false, chain_height: 99 }, 4: { chain_height: 40 } }
}, CN)
assert.strictEqual(line, I.CN.homeLineGpuPool)
assert.strictEqual(mine.heightTicker({ 1: { online: true, chain_height: 10 }, 2: { online: true, chain_height: 20 }, 3: { online: false, chain_height: 99 }, 4: { chain_height: 40 } }), 'Shard1 10 · Shard2 20 · Shard3 \u2014 · Shard4 40')

assert.strictEqual(workerFigure({ counters: { shares_valid: 99 }, balances_owed_scdo: 5 }, '1S01abc', 'wallet'), null)
const fig = workerFigure({ address: '1S01abc', shares: 4, paid_scdo: 1.5, earned_scdo: 2 }, '1S01abc', 'wallet')
assert.strictEqual(fig.shares, 4)
const delta = sessionDelta({ shares: 4, paid: '1.5', earned: '2' }, fig)
assert.strictEqual(delta.exposed, true)
assert.strictEqual(delta.shares, 0)
assert.strictEqual(delta.paid, '0')
const mapped = workerFigure({ workers: { wallet: { shares: 3, paid_scdo: 0 } } }, '1S01abc', 'wallet')
assert.strictEqual(mapped.shares, 3)

assert.ok(pay.includes("TC('wizNoRepeat')") && pay.includes("TC('wizQuery')") && pay.includes("TC('wizSent')"))
assert.ok(pay.includes("TC('wizCopyHash')") && pay.includes("TC('wizScan')") && pay.includes("TC('wizFinish')"))
assert.ok(pay.includes('id="payHash"') && pay.includes('data-act="openTx"') && pay.includes('data-act="copy"'))
assert.ok(pay.includes("s0:waitReceipt") && pay.includes('mine-load wait'))
assert.ok(pay.includes("T('shellDupYes')") && pay.includes("T('shellDupNo')"))
assert.ok(pay.includes('data-act="nav" data-v="recv"'))
assert.ok(ui.includes("selectHtml('recvPick'") && ui.includes("T('recvAddrLbl')") && ui.includes('width: 320, height: 320'))
assert.ok(!ui.slice(ui.indexOf('function pageRecv'), ui.indexOf('function paintRecvQr')).includes('id="recvChain"'))
assert.strictEqual(I.CN.wizNextAmt, '下一步填金額')
assert.strictEqual(I.CN.backupNow, '匯出備份檔')
assert.strictEqual(I.CN.acctId, '帳戶識別碼')
assert.strictEqual(I.CN.homeLineGpuPool, '顯示卡經礦池挖礦中')
assert.strictEqual(I.CN.setResumeHint, '開啟後，下次啟動錢包會自動繼續上次的挖礦')
assert.strictEqual(I.CN.recvAddrLbl, '地址')
assert.strictEqual(I.CN.homeTxOk, '已確認')
assert.strictEqual(I.CN.homeTxWait, '確認中')
assert.ok(ui.includes('id="homeHeights"') && ui.includes('id="homeHeightLine"') && ui.includes('home-chain-fold'))
assert.ok(ui.includes('class="home-tx-tag') && ui.includes("T('homeTxOk')") && ui.includes("T('homeTxWait')"))
assert.ok(pay.includes("TC('wizNextAmt')") && pay.includes('accountMenuHtml'))
assert.ok(ui.includes("T('acctId')") && ui.includes("T('backupNow')"))
assert.strictEqual(I.CN.shellAmtRoom, '餘額不夠（還要留出手續費）')
assert.strictEqual(I.EN.shellAmtRoom, 'Not enough balance (leave room for the fee)')
assert.ok(pay.includes('function paintAmtRoom') && pay.includes("T('shellAmtRoom')") && pay.includes('btn.disabled = over'))
assert.ok(pay.includes('exceedsBalance') && pay.includes('async function ensureRoomFee') && pay.includes("T('available'"))
assert.ok(read('src/css/shell310.css').includes('@media (max-height: 820px)') && read('src/css/shell310.css').includes('.shell-recv .qrwrap { width: 176px; height: 176px; margin: 4px auto; }') && read('src/css/shell310.css').includes('.shell-recv .qrwrap canvas, .shell-recv .qrwrap img { width: 160px; height: 160px; }'))
assert.ok(ui.includes('id="homeSnap"') && ui.includes('id="homeLastTx"') && ui.includes('homeSnapHtml()'))
const home = ui.slice(ui.indexOf('function pageHome'), ui.indexOf('function backHome'))
assert.ok(home.includes('id="homeChains"') && home.includes('id="chainRows"') && home.includes('chainRowsHtml()'))
assert.ok(!home.includes('type="checkbox"'))

const simp = /[复请账发广状额转创钥据链设认钱节东国这为开关门长对从会来过还进选网页显软电脑输车币买经约调户号]/
function scanSimplified (rel) {
  const text = read(rel)
  const hit = text.match(simp)
  assert.ok(!hit, rel + ' simplified: ' + (hit && hit[0]))
}
for (const rel of [
  'src/js/i18n112.js',
  'src/js/app112.js',
  'src/js/mineHome.js',
  'src/js/chainHome.js',
  'src/prototypes/more-popup.html',
  'src/prototypes/account-card.html',
  'src/prototypes/tx-record.html',
  'src/prototypes/js/readme.md'
]) scanSimplified(rel)

console.log('wallet-311: ok')
