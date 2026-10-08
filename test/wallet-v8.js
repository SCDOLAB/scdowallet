// 3.0.2 (approved v8 mockup): five identical Home cards, no 主鏈 anywhere, and every
// transfer / remittance / signature waits for an explicit confirmation window.
'use strict'
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const root = path.join(__dirname, '..')
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8')
const isl = require('../src/js/statusIsland')
const dash = require('../src/js/dashboard')
const cat = require('../src/js/aiCat')

const box = { window: {} }
vm.runInNewContext(read('src/js/i18n112.js'), box)
const I = box.window.I18N112
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const mkT = (L) => (k, v) => { const s = I[L][k]; assert.ok(s != null, L + ' missing ' + k); return String(s).replace(/\{(\w+)\}/g, (m, n) => (v && v[n] != null ? v[n] : m)) }

// ---- five identical cards -------------------------------------------------
function structure (html) {
  // tags + classes + data-field/data-act, without any text or values
  return (html.match(/<(\w+)([^>]*)>/g) || []).map(t => {
    const tag = t.match(/^<(\w+)/)[1]
    const cls = (t.match(/class="([^"]*)"/) || [])[1] || ''
    const f = (t.match(/data-field="([^"]*)"/) || [])[1] || ''
    const a = (t.match(/data-act="([^"]*)"/) || [])[1] || ''
    return [tag, cls.replace(/\b(on|off|warn|bad|ok|temp-\w+|part|muted)\b/g, '').trim(), f, a].join('|')
  }).join('\n')
}
for (const L of ['CN', 'EN']) {
  const T = mkT(L)
  const accounts = [0, 1, 2, 3, 4].map(n => ({ label: 'acct' + n, count: 1, address: n === 0 ? '0x' + 'ab'.repeat(20) : n + 'S0' + n + 'cd'.repeat(19), file: 'f' + n + '.json' }))
  const variants = [
    { miners: {}, temps: [], gpuNames: [] },
    { miners: { shard0: { running: true, state: 'mining', hashrate: 1234567, backend: 'gpu' }, classicCpu: { running: true, state: 'mining', shard: 2, hashrate: 900 } }, temps: [{ name: 'RTX', tempC: 66 }], gpuNames: ['NVIDIA GeForce RTX 3060'] }
  ]
  for (const v of variants) {
    const models = dash.chainModels({ T, isl, miners: v.miners, temps: v.temps, gpuNames: v.gpuNames, balances: ['1', '2', '3', '4', '5'], accounts, blocks: [0, 1, 2, 3, 4], net: { s0Ok: true, s0Block: 100, oldOk: true }, eta: (s) => s + 's' })
    assert.strictEqual(models.length, 5)
    assert.deepStrictEqual(models.map(m => m.name), ['Shard0 EVM', 'Shard1', 'Shard2', 'Shard3', 'Shard4'])
    const cards = models.map(m => dash.cardHtml(m, T, esc))
    const fieldsOf = (h) => (h.match(/data-field="(\w+)"/g) || []).map(s => s.slice(12, -1))
    for (const h of cards) {
      assert.deepStrictEqual(fieldsOf(h), ['balance', 'sync', 'speed', 'blocks', 'gpu', 'temp', 'net', 'address'], L + ' card fields')
      assert.ok(h.includes('data-act="copy"') && h.includes('data-act="receive"'), 'copy + QR on every card')
      const acts = (h.match(/data-act="(\w+)"/g) || []).map(s => s.slice(10, -1))
      assert.deepStrictEqual(acts.sort(), ['copy', 'receive'], 'cards are read-only except copy and QR')
      assert.ok(!/主鏈|main chain/i.test(h))
    }
    // structure identical once the pill row (state badges vary with real data) is taken out
    const norm = cards.map(h => structure(h.replace(/<span class="state[^"]*">[^<]*<\/span>/g, '')))
    for (let i = 1; i < 5; i++) assert.strictEqual(norm[i], norm[0], L + ' card ' + i + ' differs from Shard0 EVM card')
    // unused graphics card is written in full
    const idle = models.filter(m => !/RTX/.test(m.gpu))
    for (const m of idle) assert.strictEqual(m.gpu, T('d_noGpuUse'))
    const home = dash.homeHtml(models, [], T, esc)
    assert.strictEqual((home.match(/data-chain-card=/g) || []).length, 5)
    assert.strictEqual((home.match(/id="tempKey"/g) || []).length, 1, 'temperature key once')
    assert.ok(home.indexOf('id="chainCards"') < home.indexOf('id="recentTxHost"'), 'recent transactions below the cards')
    assert.ok(home.includes(esc(T('d_accHead'))))
  }
  assert.strictEqual(T('d_noGpuUse'), L === 'CN' ? '沒有使用' : 'Not in use')
  assert.strictEqual(T('d_accHead'), L === 'CN' ? '帳戶（Shard0–Shard4）' : 'Accounts (Shard0–Shard4)')
  const foot = dash.footerHtml({ all: '15', per: ['1', '2', '3', '4', '5'] }, T, esc)
  for (const id of ['footAll', 'foot0', 'foot1', 'foot2', 'foot3', 'foot4']) assert.ok(foot.includes('id="' + id + '"'))
}

// ---- no 主鏈 / main chain, no Classic split in the UI strings ----------------------
for (const f of ['src/js/app112.js', 'src/js/i18n112.js', 'src/js/menu.js', 'src/js/dashboard.js', 'src/js/statusIsland.js', 'index.html', 'main.js']) {
  const s = read(f)
  assert.ok(!s.includes('主鏈'), f + ' contains 主鏈')
  assert.ok(!s.includes('主链'), f + ' contains 主链')
}
// AI小貓 may still understand 主鏈 when someone types it, but never says it.
for (const line of read('src/js/aiCat.js').split('\n').filter(l => l.includes('主鏈'))) assert.ok(/\.test\(q\)/.test(line), 'aiCat says 主鏈: ' + line.trim().slice(0, 80))
for (const q of ['也挖主鏈', '開始挖礦', '餘額', '修同步', '建立新地址', '轉帳']) assert.ok(!/主鏈|main chain/i.test(JSON.stringify(cat.reply(q, { accounts: [], gpu: { available: true }, cpu: { available: true } }))), 'aiCat reply ' + q)
for (const L of ['CN', 'EN']) {
  for (const [k, v] of Object.entries(I[L])) {
    const s = JSON.stringify(v)
    assert.ok(!/main chain/i.test(s), L + ' ' + k + ' says main chain')
    assert.ok(!/Classic/.test(s), L + ' ' + k + ' still splits out Classic: ' + s.slice(0, 80))
  }
}

// ---- menu: every action by hand, with the v8 shortcuts ------------------------
const menu = read('src/js/menu.js')
assert.ok(menu.includes("建立新地址（Shard0–Shard4 任選）…"))
for (const [act, key] of [['create', 'CmdOrCtrl+N'], ['import', 'CmdOrCtrl+I'], ['backup', 'CmdOrCtrl+B'], ['mineStart', 'CmdOrCtrl+G'], ['mineStop', 'CmdOrCtrl+Shift+G'], ['send', 'CmdOrCtrl+T'], ['remitItem', 'CmdOrCtrl+P']]) {
  const line = menu.split('\n').find(l => l.includes('L.' + act + ',') && l.includes('accelerator'))
  assert.ok(line && line.includes("'" + key + "'"), 'menu ' + act + ' ' + key)
}
assert.ok(menu.includes("act('catShow')"))
const ui = read('src/js/app112.js')
for (const c of ['create', 'import', 'backup', 'manage', 'mineStart', 'mineStop', 'reward', 'send', 'remit', 'catShow']) assert.ok(new RegExp("case '" + c + "'").test(ui.slice(ui.indexOf('function menuAction'))), 'menuAction ' + c)
assert.ok(!/class="tabs"|id="tabBar"|id="actBar"/.test(read('index.html') + ui.slice(ui.indexOf('function renderHeader'), ui.indexOf('function renderHeader') + 1500)))

// ---- confirmation before every transfer / remittance / signature ---------------
// 1) AI小貓 never emits spending actions, whatever is typed.
const ctx = { accounts: [{ label: 'a', file: 'a.json', shard: 0, evm: '0x' + '11'.repeat(20) }], shard0Address: '0x' + '11'.repeat(20), selectedFile: 'a.json', gpu: { available: true }, cpu: { available: true } }
for (const q of ['轉帳', '匯款', '轉 100 給 0x' + '22'.repeat(20), '匯 50 給小明', '簽名', '幫我送出', '全部轉走', 'send 5 to 0x' + '33'.repeat(20), '開始挖礦', '建立新地址']) {
  const r = cat.reply(q, ctx)
  for (const a of r.actions || []) assert.ok(!['send', 'sign', 'spend', 'review', 'login'].includes(a.type), q + ' -> ' + a.type)
}
const ps = cat.planOpen('轉帳', {}); assert.strictEqual(ps.actions[0].type, 'open'); assert.strictEqual(ps.actions[0].form, 'send')
const pr = cat.planOpen('匯款', {}); assert.strictEqual(pr.actions[0].form, 'remit')
// 2) The cat's open action only opens the form; it never calls a send IPC.
const runCat = ui.slice(ui.indexOf('function runCatAction'), ui.indexOf('function runCatAction') + 4000)
assert.ok(/case 'send':\s*case 'remit':\s*openRemittance\(\)|'send'.*openRemittance|openRemittance\(\)/.test(runCat))
assert.ok(!/s0:send|old:send|remit:login|s0:review/.test(runCat.slice(0, runCat.indexOf('\n  }\n') > 0 ? runCat.indexOf('\n  }\n') : runCat.length)))
// 3) In the pay form, every send / sign IPC is preceded by an awaited confirmTx() window.
const pay = ui.slice(ui.indexOf('async function confirmPay'), ui.indexOf('function payShowLedger'))
const ipcs = [...pay.matchAll(/api\.invoke\('(s0:send|old:send)'/g)].map(m => m.index)
assert.strictEqual(ipcs.length, 3)
for (const at of ipcs) {
  const before = pay.slice(Math.max(0, at - 1200), at)
  assert.ok(/if \(!\(await confirmTx\(\{ title: T\('cf_title'\)/.test(before), 'send without confirmTx at ' + at)
}
const login = pay.indexOf('await remitLogin(payer.filename)')
assert.ok(login > 0 && /await confirmTx\(\{ title: T\('cf_titleSign'\)/.test(pay.slice(login - 400, login)), 'remittance signature needs confirmTx')
const cfn = ui.slice(ui.indexOf('function confirmTx'), ui.indexOf('function cfRows'))
assert.ok(cfn.includes("$('cfYes').onclick = () => finish(true)") && cfn.includes("e.key === 'Escape'") && cfn.includes("$('cfNo').focus") === false)
assert.ok(cfn.includes("const b = $('cfNo'); if (b) b.focus()"), 'focus starts on cancel so Enter never confirms by accident')
const rows = ui.slice(ui.indexOf('function cfRows'), ui.indexOf('function cfRows') + 600)
for (const k of ['cf_amount', 'cf_to', 'cf_chain']) assert.ok(rows.includes("T('" + k + "')"), 'confirmation shows ' + k)
for (const L of ['CN', 'EN']) for (const k of ['cf_title', 'cf_titleSign', 'cf_amount', 'cf_to', 'cf_chain', 'cf_yes', 'cf_yesSign', 'cf_no', 'cf_note', 'cf_canceled']) assert.ok(I[L][k], L + ' ' + k)

// ---- private key: masked dialog only, never into the chat ---------------------
const create = ui.slice(ui.indexOf('function createModal'), ui.indexOf('function createModal') + 4000)
assert.ok(/type="password"[^>]*id="cPriv"|id="cPriv"[^>]*type="password"/.test(create), 'private key field is masked')
// ---- footer: large balances (10,027,844.2529) wrap to a new line instead of overlapping ----
const css = read('src/css/app112.css')
assert.ok(css.includes('.foot-bar .sum { flex: 1; min-width: 0; display: flex; flex-wrap: wrap;'), 'footer totals wrap')
assert.ok(css.includes('.foot-bar .sum > div { flex: 1 0 auto; min-width: max-content; }'), 'each footer total keeps its full number')
// ---- white text on green is #1d7a34 (5.4:1); #248a3d was 4.40:1 ----
assert.ok(css.includes('.cat-pop .ios-in .send { width: 32px; height: 32px; border-radius: 50%; border: 0; padding: 0; background: #1d7a34;'))
assert.ok(css.includes('.btn.pri { background: #1d7a34; color: #fff; }'))
assert.ok(!/248a3d/i.test(css), 'no #248a3d left')
console.log('wallet-v8: ok')
