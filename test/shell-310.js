// 3.1.0: five-item nav, send wizard, and the one mining button.
'use strict'
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const root = path.join(__dirname, '..')
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8')
const mine = require('../src/js/mineHome.js')
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
const menu = read('src/js/menu.js')
const html = read('index.html')

assert.ok(html.includes('id="sideNav"'))
assert.ok(!html.includes('id="tabBar"') && !html.includes('id="actBar"'))
for (const label of ["home: '首頁'", "receive: '收款'", "remit: '匯款'", "mining: '運算服務'", "navSettings: '設定'"]) assert.ok(menu.includes(label), label)
assert.ok(menu.includes("act('home')") && menu.includes("act('recv')") && menu.includes("act('mineHome')") && menu.includes('openRemittance()') && menu.includes("act('settings')"))
assert.ok(!menu.includes("act('mineStart')") && !menu.includes("act('mineStop')") && !menu.includes("act('mine')"))
assert.ok(!menu.includes('開始挖礦') && !menu.includes('停止挖礦'))

const home = ui.slice(ui.indexOf('function pageHome'), ui.indexOf('function backHome'))
assert.ok(home.includes('chainRowsHtml()') && home.includes('mineHomeStripHtml()'))
assert.ok(!home.includes('id="shellTotal"') && !home.includes('data-act="toggleChains"') && !home.includes("shellFold('homeTx'"))
assert.ok(!home.includes('type="checkbox"') && !home.includes('role="switch"') && !home.includes('btn pri'))
assert.ok(ui.includes('function pageRecv') && ui.includes('id="qrBox"') && ui.includes("T('copy')"))
assert.ok(ui.includes('Shard0 EVM') && ui.includes("'Shard' + i + ' Classic'"))

const pay = ui.slice(ui.indexOf('function payModal'), ui.indexOf('function payShowLedger'))
assert.ok(pay.includes('id="wizStep1"') && pay.includes('id="wizStep2"') && pay.includes('id="wizStep3"'))
assert.ok(pay.includes('id="wizBack2"') && pay.includes('id="wizBack3"') && pay.includes('id="btnRemitSign"'))
assert.ok(pay.includes('wizNeedAmt') && pay.includes('units <= 0n'))
assert.ok(pay.includes('id="payHash"') && pay.includes("data-act=\"openTx\""))
assert.ok(/if \(!\(await confirmTx\(\{ title: T\('cf_title'\)/.test(pay))

const minePage = ui.slice(ui.indexOf('function pageMine'), ui.indexOf('function pageRecv'))
assert.ok(minePage.includes('minePageHtml(') && !minePage.includes('data-act="mineShard"') && !minePage.includes('data-act="mineBackend"'))
assert.ok(ui.includes('saved.classic || (gpuAvail ? \'gpu\' : \'cpu\')'))
assert.ok(ui.includes("case 'nav':"))

function strip (input) { return mine.stripHtml(input, CN, esc) }
function page (input) { return mine.minePageHtml(input, CN, esc) }
const paused = {
  miners: {
    classicGpu: {
      running: true, mode: 'gpu', chain: 'classic', shard: 1, code: 'CLASSIC_PAUSED', phase: 'syncing', paused: true,
      procs: ['classic-node'], localBlock: 45, networkBlock: 100
    }
  }
}
const live = {
  miners: {
    classicGpu: {
      running: true, mode: 'gpu', chain: 'classic', shard: 1, code: 'CLASSIC_GPU', phase: 'mining',
      procs: ['classic-node'], hashrate: 80, localBlock: 100, networkBlock: 100
    }
  }
}
const idleHtml = strip({ miners: {}, phase: 'stopped' })
assert.ok(idleHtml.includes('CPU 挖礦') && idleHtml.includes('GPU 挖礦'))
assert.ok(idleHtml.includes('已停止') && idleHtml.includes('開始挖礦') && !idleHtml.includes('停止挖礦'))
assert.ok(idleHtml.includes('data-dev="cpu"') && idleHtml.includes('data-dev="gpu"'))
assert.ok(!idleHtml.includes('type="checkbox"') && !idleHtml.includes('role="switch"'))
const waitHtml = strip(paused)
assert.ok(waitHtml.includes('等待同步（Shard1 Classic 同步進度 45%）') && waitHtml.includes('停止挖礦') && waitHtml.includes('開始挖礦'))
const liveHtml = page(live)
assert.ok(liveHtml.includes('CPU 挖礦') && liveHtml.includes('GPU 挖礦'))
assert.ok(liveHtml.includes('運算中') && liveHtml.includes('class="mine-glance') && liveHtml.includes('停止挖礦') && liveHtml.includes('今天挖到') && liveHtml.includes('進階'))
assert.ok(liveHtml.includes('選擇要挖的鏈') && !/<details\b[^>]*\sopen/.test(liveHtml))
assert.ok(!liveHtml.includes('data-act="mineShard"') && !liveHtml.includes('data-act="mineBackend"'))
const busyHtml = page({ miners: {}, gpuBusy: true })
assert.ok(busyHtml.includes('顯卡正被其他程式使用') && busyHtml.includes('開始挖礦') && !busyHtml.includes('挖礦狀態：已停止'))
const hot = page({ miners: { classicGpu: { running: true, mode: 'gpu', chain: 'classic', shard: 1, procs: ['g'], hashrate: 10, localBlock: 5, networkBlock: 5 } }, temps: [{ tempC: 90 }] })
assert.ok(hot.includes('temp-hot'))
const warm = page({ miners: { classicGpu: { running: true, mode: 'gpu', chain: 'classic', shard: 1, procs: ['g'], hashrate: 10, localBlock: 5, networkBlock: 5 } }, temps: [{ tempC: 76 }] })
assert.ok(warm.includes('temp-warm'))
const cool = page({ miners: { classicGpu: { running: true, mode: 'gpu', chain: 'classic', shard: 1, procs: ['g'], hashrate: 10, localBlock: 5, networkBlock: 5 } }, temps: [{ tempC: 60 }] })
assert.ok(cool.includes('temp-ok'))
assert.ok(cool.includes('\u2014') || cool.includes('今天挖到'))

assert.strictEqual(I.CN.relNotes[0].v, '3.1.0')
assert.strictEqual(I.EN.relNotes[0].v, '3.1.0')
assert.ok(!/[\u4e00-\u9fff]/.test(I.EN.relNotes[0].items.join(' ')))
assert.ok(I.CN.relNotes.find(n => n.v === '3.0.10').items.join(' ').includes('顯卡正被其他程式使用'))
assert.ok(!I.CN.relNotes[0].items.join(' ').includes('主鏈'))

// Complex sections start collapsed. Only 「查看各鏈餘額」 is remembered.
function detailTags (src) {
  return src.match(/<details\b[^>]*>/g) || []
}
const tags = detailTags(ui).concat(detailTags(read('src/js/mineHome.js')))
assert.ok(tags.length >= 4, 'expected collapsed disclosures')
for (const tag of tags) assert.ok(!/\sopen(\s|=|>|$)/.test(tag), 'details starts open: ' + tag)
assert.ok(!ui.includes('st.advOpen'))
assert.ok(!ui.includes('homeChains310') && !ui.includes('id="shellTotal"') && !ui.includes('data-act="toggleChains"'))
assert.ok(pay.indexOf('id="wizFee"') < pay.indexOf('id="wizDetails"'))
const feeBreak = pay.slice(pay.indexOf('id="wizDetails"'), pay.indexOf('</details>', pay.indexOf('id="wizDetails"')))
assert.ok(feeBreak.includes('id="wizChainNow"') && feeBreak.includes('id="wizGas"') && feeBreak.includes("TC('wizDetails')"))
assert.ok(!feeBreak.includes('id="wizFee"'))
assert.strictEqual(I.CN.wizDetails, '明細')
assert.strictEqual(I.EN.wizDetails, 'Details')
const idlePage = page({ miners: {} })
assert.ok(idlePage.includes('id="mineAdvFold"') && idlePage.includes('\u25B8') && !/<details\b[^>]*\sopen/.test(idlePage))
const setFn = ui.slice(ui.indexOf('function pageMineSet'), ui.indexOf('function remitReset'))
const advFn = ui.slice(ui.indexOf('function mineAdvanced'), ui.indexOf('function pageMineSet'))
assert.ok(setFn.includes('mineAdvanced(') && advFn.includes("shellFold('advBox'") && advFn.includes('id="mLog"'))
assert.ok(!/<details\b[^>]*\sopen/.test(setFn + advFn))
assert.ok(ui.includes("shellFold('setAdvanced'") && ui.includes('id="wizPayer"'))
const css = read('src/css/shell310.css')
for (const bad of ['#0c1222', '#12182b', '#3b6cff', '#8a5cff', '#b15cff', '#2f6bff', '#3ddc84', '#c62828', '#c45c00', '#f0b45a']) {
  assert.ok(!css.toLowerCase().includes(bad.toLowerCase()), bad)
}
for (const good of ['#F2F2F7', '#1d7a34', '#8e8e93', '#8a4b00', '#c93400', '#d93025', '#1c1c1e']) assert.ok(css.includes(good), good)
assert.ok(!css.toLowerCase().includes('#f5f5f7'))
assert.ok(css.includes('border-radius: 24px') && css.includes('border-radius: 16px') && css.includes('border-radius: 12px') && css.includes('border-radius: 999px'))
assert.ok(css.includes('width: 216px') && css.includes('font-size: 40px') && css.includes('scale(.97)') && css.includes('opacity: .55'))
assert.ok(!css.includes('#22B573') && !css.includes('#FF5F57') && !css.includes('#FEBC2E') && !css.includes('#28C840'))
assert.ok(!ui.includes('#0c1222'))
const mainJs = read('main.js')
const win = mainJs.slice(mainJs.indexOf('function createWindow'), mainJs.indexOf('mainWindow.loadFile'))
assert.ok(win.includes("titleBarStyle: 'default'"))
assert.ok(!/frame:\s*false/.test(win) && !win.includes('hiddenInset') && !win.includes('titleBarStyle: \'hidden\''))
assert.ok(pay.includes('const DUP_SEND_MS = 10 * 60 * 1000') && pay.includes('shellDupAsk') && !pay.includes('dupSendMinutes'))
assert.strictEqual(I.CN.shellDupAsk, '要再送一次一樣的轉帳嗎？')
assert.ok(!/[\u4e00-\u9fff]/.test(I.EN.shellDupAsk))

const noGpu = page({ miners: {}, caps: { gpu: { available: false }, cpu: { available: true } } })
assert.ok(noGpu.includes('未偵測到顯卡'))
assert.ok(noGpu.includes('只支援顯卡') && noGpu.includes('disabled'))
assert.ok(!noGpu.includes('礦池還沒上線'))
const offline = page({ miners: {}, caps: { gpu: { available: true }, cpu: { available: true } }, pools: { 3: { online: false } } })
assert.ok(offline.includes('Shard3 礦池暫時連不上'))
assert.ok(mine.chainSupport('cpu', 3, {}).ok)
assert.ok(!mine.chainSupport('cpu', 3, {}, { 3: { online: false } }).ok)
const cpuShard0 = noGpu.slice(noGpu.indexOf('data-dev="cpu"'), noGpu.indexOf('data-dev="gpu"'))
assert.ok(cpuShard0.includes('Shard0 EVM') && cpuShard0.includes('disabled') && cpuShard0.includes('只支援顯卡'))
const picked = mine.defaultChainPick({ classic: 'gpu', shard0: true }, { gpu: { available: true } }, { gpu: { shard: 2 } }, {})
assert.deepStrictEqual(picked.gpu, [0, 2])
assert.deepStrictEqual(picked.cpu, [])
const autoGpu = mine.defaultChainPick({}, { gpu: { available: true } }, {}, {})
assert.deepStrictEqual(autoGpu, { cpu: [], gpu: [1] })
const autoCpu = mine.defaultChainPick({}, { gpu: { available: false }, cpu: { available: true } }, {}, {})
assert.deepStrictEqual(autoCpu.cpu, [1])
assert.deepStrictEqual(autoCpu.gpu, [])
assert.ok(!mine.chainSupport('cpu', 0, {}).ok)
assert.ok(mine.chainSupport('cpu', 3, {}).ok)
assert.ok(mine.chainSupport('cpu', 1, {}).ok)
assert.ok(!mine.chainSupport('gpu', 1, { gpu: { available: false } }).ok)
const cpuJobs = mine.jobsForDevice({ device: 'cpu', chains: [0, 1, 2], addresses: { 1: '1S01' + 'a'.repeat(36) } })
assert.strictEqual(cpuJobs.jobs.length, 1)
assert.strictEqual(cpuJobs.jobs[0].backend, 'cpu')
assert.strictEqual(cpuJobs.jobs[0].shard, 1)
const reward = '0x' + 'ab'.repeat(20)
const gpuJobs = mine.jobsForDevice({
  device: 'gpu', chains: [0, 1, 3],
  addresses: { 0: reward, 1: '1S01' + 'b'.repeat(36) },
  nvidia: true, preflight: { ok: true, gpus: [{ status: 'ready' }] }, reward: reward
})
assert.ok(gpuJobs.jobs.some(j => j.chain === 'shard0' && j.backend === 'gpu'))
assert.ok(gpuJobs.jobs.some(j => j.chain === 'classic' && j.shard === 1))
assert.ok(!gpuJobs.jobs.some(j => j.shard === 3))
assert.ok(gpuJobs.notices.indexOf('shellOneClassic') >= 0)
assert.deepStrictEqual(mine.selectionAfterStop({ cpu: [1], gpu: [0, 1] }), { cpu: [1], gpu: [0, 1] })
assert.strictEqual(mine.reduceMinePhase('starting', 'click'), 'starting')
assert.strictEqual(mine.reduceMinePhase('stopping', 'click'), 'stopping')
assert.ok(ui.includes("st.homeMineDev[device] === 'starting'"))
const stopDev = ui.slice(ui.indexOf('async function stopDevice'), ui.indexOf('async function startDevice'))
assert.ok(stopDev.includes('rememberMineChoice()'))
assert.ok(!stopDev.includes('mineChainsCpu310') && !stopDev.includes('mineChainsGpu310') && !stopDev.includes('removeItem'))
assert.ok(ui.includes('mineChainsCpu310') && ui.includes('mineChainsGpu310'))

// One walk of every screen: extra sections start collapsed. The primary action stays outside them.
function noOpen (name, src) {
  for (const tag of src.match(/<details\b[^>]*>/g) || []) assert.ok(!/\sopen(\s|=|>|$)/.test(tag), name + ' starts open: ' + tag)
}
const recvFn = ui.slice(ui.indexOf('function pageRecv'), ui.indexOf('function paintRecvQr'))
const remitFn = ui.slice(ui.indexOf('function payModal'), ui.indexOf('function payShowLedger'))
const setModal = ui.slice(ui.indexOf('async function settingsModal'), ui.indexOf('async function fillAboutHash'))
assert.ok(!setModal.includes('DUP_SEND') && !setModal.includes('dupSend310'))
const screens = [
  ['home', home],
  ['receive', recvFn],
  ['send', remitFn],
  ['mining', page({ miners: {} })],
  ['settings', setModal],
  ['mining settings', setFn]
]
for (const [name, src] of screens) noOpen(name, src)
assert.ok(!home.includes("shellFold('homeTx'") && !home.includes('id="recentTxHost"') && !home.includes('id="shellTotal"'))
assert.ok(home.includes('id="chainRows"') && !home.includes('homeTx310'))
const recvReturn = recvFn.slice(recvFn.lastIndexOf('return `'))
assert.ok(recvFn.includes('id="qrBox"') && recvFn.includes("selectHtml('recvPick'"))
assert.ok(recvReturn.indexOf('recv-tabs') < recvReturn.indexOf('${pick}') && recvReturn.indexOf('${pick}') < recvReturn.indexOf('${body}'))
assert.ok(recvReturn.indexOf('${body}') < recvReturn.indexOf("shellFold('recvChains'"))
assert.ok(remitFn.includes('id="wizPayees"') && remitFn.indexOf('id="wizFee"') < remitFn.indexOf('id="wizDetails"'))
const mined = screens[3][1]
const cpuPanel = mined.slice(mined.indexOf('data-dev="cpu"'), mined.indexOf('data-dev="gpu"'))
const gpuPanel = mined.slice(mined.indexOf('data-dev="gpu"'))
assert.ok(cpuPanel.indexOf('id="homeMineCpu"') < cpuPanel.indexOf('<details') && cpuPanel.indexOf('type="checkbox"') > cpuPanel.indexOf('<details'))
assert.ok(gpuPanel.indexOf('id="homeMineGpu"') < gpuPanel.indexOf('<details'))
assert.ok(mined.includes('id="minePick-cpu"') && mined.includes('id="mineAdvFold"') && !/<details\b[^>]*\sopen/.test(mined))
for (const id of ['setLang', 'setNotify', 'setSecurity', 'setUpdate', 'setAbout', 'setCat', 'setAdvanced']) assert.ok(setModal.includes("shellFold('" + id + "'"), id)
const secAt = setModal.indexOf("shellFold('setSecurity'")
const updAt = setModal.indexOf("shellFold('setUpdate'")
assert.ok(secAt > 0 && setModal.indexOf('data-act="backup"') > secAt && setModal.indexOf('data-act="backup"') < updAt)
assert.ok(setModal.indexOf('data-act="setLang"') > setModal.indexOf("shellFold('setLang'") && setModal.indexOf('data-act="setLang"') < setModal.indexOf("shellFold('setNotify'"))
assert.ok(setModal.indexOf("T('rpcList')") > setModal.indexOf("shellFold('setAdvanced'"))
assert.ok(!setModal.includes('<div class="setsec"'))
assert.ok(I.CN.relNotes[0].items.join(' ').includes('最近交易') && I.EN.relNotes[0].items.join(' ').includes('Recent transactions'))
console.log('shell-310: ok')
