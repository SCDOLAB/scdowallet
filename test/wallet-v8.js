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
  // 3.1.0: the footer lists each chain. It does not render one cross-chain total.
  const foot = dash.footerHtml({ per: ['1', '2', '3', '4', '5'] }, T, esc)
  assert.ok(!foot.includes('id="footAll"') && !foot.includes(esc(T('d_totalLine'))))
  assert.ok(foot.includes('Shard0 EVM') && foot.includes('Shard4 Classic'))
  assert.ok(foot.includes('>1 SCDO</b>') && foot.includes('>5 SCDO</b>'))
  // no duplicates: no mining/idle/syncing badges (the speed and sync fields say it), no lead line repeating the cat label
  const busy = dash.chainModels({ T, isl, miners: { shard0: { chain: 'shard0', running: true, code: 'MINING', mode: 'gpu', hashrate: 5e6, localBlock: 10, networkBlock: 10 } }, temps: [], gpuNames: ['RTX'], balances: ['1', '2', '3', '4', '5'], accounts: [{}, {}, {}, {}, {}], blocks: [0, 0, 0, 0, 0], net: {}, eta: s => s })
  for (const m of busy) for (const p of m.pills) assert.ok(![T('d_pillGpu', { chain: m.name }), T('d_pillCpu'), T('d_pillIdle'), T('d_pillSyncing')].includes(p.text), 'duplicate badge ' + p.text)
  assert.ok(!dash.homeHtml(busy, [], T, esc).includes(esc(T('d_lead'))))
  // the status island keeps only what no card shows (earnings)
  const sum = isl.summaryIsland({ T, shard0: { chain: 'shard0', running: true, code: 'MINING', mode: 'gpu', hashrate: 5e6, localBlock: 10, networkBlock: 10, peers: 3 }, classicCpu: null, classicGpu: null, gpuTemps: [{ tempC: 60 }] })
  for (const c of sum.chips) assert.strictEqual(c.kind, 'earn', 'island repeats ' + c.key)
  assert.strictEqual(sum.money.length, 0)
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
    const classicLeft = s.replace(/Shard\d Classic/g, '').replace(/Shard1–Shard4 Classic/g, '').replace(/Shard1-Shard4 Classic/g, '').replace(/Shard1–4 Classic/g, '')
    assert.ok(!/Classic/.test(classicLeft), L + ' ' + k + ' still splits out Classic: ' + classicLeft.slice(0, 80))
  }
}

// ---- menu: every action by hand, with the v8 shortcuts ------------------------
const menu = read('src/js/menu.js')
assert.ok(menu.includes("建立新地址（Shard0–Shard4 任選）…"))
for (const [act, key] of [['home', 'CmdOrCtrl+1'], ['receive', 'CmdOrCtrl+2'], ['mining', 'CmdOrCtrl+3'], ['remitItem', 'CmdOrCtrl+T'], ['navSettings', 'CmdOrCtrl+E']]) {
  const line = menu.split('\n').find(l => l.includes('L.' + act + ',') && l.includes('accelerator'))
  assert.ok(line && line.includes("'" + key + "'"), 'menu ' + act + ' ' + key)
}
assert.ok(read('src/js/app112.js').includes("case 'catShow'"))
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
// ---- footer: one line that wraps (label above number) instead of overlapping; the cat keeps its own space ----
const css = read('src/css/app112.css')
assert.ok(css.includes('.foot-bar .foot-line { flex: 1; min-width: 0; display: flex; flex-wrap: wrap;'))
assert.ok(css.includes('.foot-bar .foot-line b { font-size: 26px; color: #2E7D32; white-space: nowrap; }'))
assert.ok(/\.foot-bar \{[^}]*padding: 8px 330px 8px 18px/.test(css), 'footer leaves room for AI小貓 on the right')
// ---- white text on green is #1d7a34 (5.4:1); #248a3d was 4.40:1 ----
assert.ok(css.includes('.cat-pop .ios-in .send { width: 32px; height: 32px; border-radius: 50%; border: 0; padding: 0; background: #1d7a34;'))
assert.ok(css.includes('.btn.pri { background: #1d7a34; color: #fff; }'))
assert.ok(!/248a3d/i.test(css), 'no #248a3d left')
console.log('wallet-v8: ok')
