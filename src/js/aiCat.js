// AI小貓: on-device rules. No network, no model, no seed, no signing, no spending.
'use strict'
;(function () {
const HEAT_C = 85
const STALL_MS = 3 * 60 * 1000
const PEER_WAIT_MS = 60 * 1000
const LOW_FREE = 512 * 1024 * 1024
const BLOCKED = { send: 1, sign: 1, spend: 1, review: 1, login: 1 }

function num (v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function clean (text) {
  return String(text == null ? '' : text).normalize('NFKC').replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '').replace(/\s+/g, ' ').trim()
}

function looksLikeSecret (text) {
  const s = clean(text)
  if (/0x[0-9a-fA-F]{64}\b/.test(s) || /(?:^|\s)[0-9a-fA-F]{64}(?:\s|$)/.test(s)) return true
  const words = s.split(' ')
  return words.length >= 12 && words.length <= 24 && words.every(w => /^[a-z]+$/i.test(w))
}

function accountsOf (ctx) {
  return Array.isArray(ctx && ctx.accounts) ? ctx.accounts : []
}

function classicByShard (accounts) {
  const by = { 1: [], 2: [], 3: [], 4: [] }
  for (const a of accounts) {
    const n = Number(a && a.shard)
    if (by[n] && a.address) by[n].push(a)
  }
  return by
}

function liveShardSet (ctx) {
  const live = new Set()
  const pools = ctx && ctx.pools
  if (pools && typeof pools === 'object') {
    for (const n of [1, 2, 3, 4]) {
      const p = pools[n] || pools[String(n)]
      if (p && p.live) live.add(n)
    }
  } else live.add(1)
  const gpu = ctx && ctx.classicGpu
  if (gpu && gpu.running) {
    const shard = Number(gpu.shard)
    const peers = num(gpu.peers)
    const local = num(gpu.localBlock)
    const network = num(gpu.networkBlock)
    if (shard >= 1 && shard <= 4 && ((peers != null && peers > 0) || local != null || network != null)) live.add(shard)
  }
  if (Array.isArray(ctx && ctx.liveShards)) {
    for (const n of ctx.liveShards) {
      const x = Number(n)
      if (x >= 1 && x <= 4) live.add(x)
    }
  }
  return live
}

function startFail (code) {
  const map = {
    NO_ZMINER: '找不到處理器挖礦程式。',
    NO_CLASSIC_NODE: '找不到顯卡挖礦程式。',
    NO_CUDART: '顯卡挖礦程式缺少執行元件。',
    NO_NVIDIA: '這台電腦沒有可用的 NVIDIA 顯卡。',
    ALREADY_RUNNING: '這個挖礦程式已經在跑。',
    BAD_ADDRESS: '這個地址不能用來挖這條鏈。',
    BAD_SHARD: '地址和這條鏈對不上。',
    CANCELED: '你取消了主鏈的顯卡挖礦。'
  }
  return map[code] || '沒有啟動。'
}

function planMine (ctx) {
  ctx = ctx || {}
  const temp = num(ctx.tempC)
  if (temp != null && temp >= HEAT_C) {
    return { say: '顯卡溫度 ' + temp + '°C，已經過熱。75°C 以下才安全，超過 85°C 會自動暫停，所以已經停下顯卡挖礦，保護顯卡。', actions: [{ type: 'stopGpu' }] }
  }
  const gpuOk = !!(ctx.gpu && ctx.gpu.available)
  const cpuOk = !!(ctx.cpu && ctx.cpu.available)
  const nvidia = !!(ctx.gpu && ctx.gpu.nvidia)
  const by = classicByShard(accountsOf(ctx))
  const shards = [1, 2, 3, 4].filter(n => by[n].length)
  const prefer = by[Number(ctx.preferShard)] ? Number(ctx.preferShard) : (shards[0] || 0)
  if (!gpuOk && !cpuOk && !(ctx.includeShard0 && nvidia)) {
    return { say: '這台電腦目前沒有可用的顯示卡節點或處理器挖礦程式。', actions: [] }
  }
  if (!shards.length && !ctx.includeShard0) {
    return { say: '還沒有 Shard1 到 Shard4 的帳戶。請先建立或匯入，再開始挖礦。', actions: [] }
  }
  const jobs = []
  const bits = []
  if (shards.length) {
    const gpuShard = prefer || shards[0]
    const live = liveShardSet(ctx)
    const otherLive = shards.filter(n => n !== gpuShard && live.has(n))
    const cpuShard = otherLive.length ? otherLive[0] : gpuShard
    if (gpuOk) {
      jobs.push({ chain: 'classic', backend: 'gpu', shard: gpuShard, address: by[gpuShard][0].address })
      bits.push('用顯卡在 Shard' + gpuShard + ' 挖礦')
    }
    if (cpuOk) {
      const s = gpuOk ? cpuShard : gpuShard
      jobs.push({ chain: 'classic', backend: 'cpu', shard: s, address: by[s][0].address })
      bits.push('用處理器在 Shard' + s + ' 挖礦')
    }
    const missing = [1, 2, 3, 4].filter(n => !by[n].length)
    if (missing.length) bits.push('Shard' + missing.join('、Shard') + ' 還沒有帳戶')
    const used = {}
    jobs.forEach(j => { if (j.chain === 'classic') used[j.shard] = 1 })
    const left = shards.filter(n => !used[n])
    if (left.length) bits.push('Shard' + left.join('、Shard') + ' 等現在這次挖完再換')
  }
  if (ctx.includeShard0) {
    if (!ctx.shard0Address) bits.push('沒有主鏈地址，所以沒有一起挖主鏈')
    else if (!nvidia) bits.push('沒有 NVIDIA 顯卡，所以沒有一起挖主鏈')
    else {
      jobs.push({ chain: 'shard0', backend: 'gpu', address: ctx.shard0Address })
      bits.push('另外用顯卡挖主鏈')
    }
  }
  if (!jobs.length) return { say: bits.join('。') + '。', actions: [] }
  return {
    say: '準備開始：' + bits.join('，') + '。顯卡超過 85°C 會自動暫停，保護顯卡。',
    actions: [{ type: 'startJobs', jobs: jobs }]
  }
}

function heatGuard (ctx) {
  ctx = ctx || {}
  const temp = num(ctx.tempC)
  if (temp == null || temp < HEAT_C) return null
  const classicHot = ctx.classicGpu && ctx.classicGpu.running && ctx.classicGpu.mode !== 'cpu'
  const shard0Hot = ctx.shard0 && ctx.shard0.running && ctx.shard0.mode !== 'node'
  if (!classicHot && !shard0Hot) return null
  return { say: '顯卡溫度 ' + temp + '°C，已經過熱。75°C 以下才安全，超過 85°C 會自動暫停，所以已經停下顯卡挖礦，保護顯卡。', actions: [{ type: 'stopGpu' }] }
}

function diagnose (ctx) {
  ctx = ctx || {}
  const out = []
  const gpu = ctx.classicGpu
  if (gpu && gpu.running && gpu.mode !== 'cpu') {
    const local = num(gpu.localBlock)
    const network = num(gpu.networkBlock)
    const behind = local == null || network == null || network - local > 8
    const age = num(gpu.heightAgeMs)
    if (behind && age != null && age >= STALL_MS && gpu.wallet) {
      out.push({ kind: 'stalled', chain: 'classic', backend: 'gpu', shard: Number(gpu.shard), address: gpu.wallet })
    }
  }
  const s0 = ctx.shard0
  if (s0 && s0.running && s0.wallet && (s0.code === 'NO_PEERS' || s0.peers === 0)) {
    const age = num(s0.peerAgeMs)
    if (age != null && age >= PEER_WAIT_MS) out.push({ kind: 'nopeers', chain: 'shard0', mode: s0.mode === 'node' ? 'node' : 'mine', address: s0.wallet })
  }
  const free = ctx.mem && num(ctx.mem.free)
  if (free != null && free < LOW_FREE) out.push({ kind: 'mem', free: free })
  return out
}

function planHeal (ctx) {
  ctx = ctx || {}
  const temp = num(ctx.tempC)
  if (temp != null && temp >= HEAT_C) {
    return heatGuard(ctx) || { say: '顯卡溫度 ' + temp + '°C，已經過熱。現在沒有用顯卡挖礦，所以沒有把挖礦停下來。', actions: [] }
  }
  const found = diagnose(ctx)
  if (!found.length) return { say: '帳本下載、連上的節點和記憶體目前都正常。', actions: [] }
  const jobs = []
  const bits = []
  for (const p of found) {
    if (p.kind === 'stalled') {
      jobs.push({ chain: 'classic', backend: 'gpu', shard: p.shard, address: p.address })
      bits.push('Shard' + p.shard + ' 的帳本下載停住了，準備重新啟動，再連上其他節點')
    } else if (p.kind === 'nopeers') {
      jobs.push({ chain: 'shard0', mode: p.mode, address: p.address })
      bits.push('主鏈還沒有連上其他節點，準備重新連線')
    } else if (p.kind === 'mem') {
      const mb = Math.max(0, Math.round(p.free / (1024 * 1024)))
      bits.push('可用記憶體只剩下 ' + mb + ' MB')
      const gpu = ctx.classicGpu
      const s0 = ctx.shard0
      if (gpu && gpu.running && gpu.wallet && gpu.mode !== 'cpu' && !jobs.some(j => j.chain === 'classic')) {
        jobs.push({ chain: 'classic', backend: 'gpu', shard: Number(gpu.shard), address: gpu.wallet })
        bits.push('準備重新啟動顯卡挖礦')
      } else if (s0 && s0.running && s0.wallet && !jobs.some(j => j.chain === 'shard0')) {
        jobs.push({ chain: 'shard0', mode: s0.mode === 'node' ? 'node' : 'mine', address: s0.wallet })
        bits.push('準備重新啟動主鏈')
      } else if (!jobs.length) bits.push('先不要再啟動新的節點')
    }
  }
  if (!jobs.length) return { say: bits.join('，') + '。', actions: [] }
  return { say: bits.join('，') + '。', actions: [{ type: 'restartJobs', jobs: jobs }] }
}

function sayBalance (ctx) {
  const rows = Array.isArray(ctx && ctx.balances) ? ctx.balances.filter(r => r && r.text) : []
  if (!rows.length) return { say: '目前沒有可顯示的餘額。請先選擇帳戶，或等連線更新。', actions: [] }
  return { say: rows.map(r => (r.label || '帳戶') + '：' + r.text).join('。') + '。', actions: [] }
}

function planBackup () {
  return {
    say: '帳戶要靠帳戶檔案和密碼才能恢復。小貓不會顯示種子、私鑰或密碼，也不會把它寫進紀錄。請在接下來的清單裡自己按「立即備份」，並另外複製到隨身碟。',
    actions: [{ type: 'openBackup' }]
  }
}

function refuseSecret () {
  return { say: '請不要把種子、私鑰或密碼貼在這裡。小貓不會顯示，也不會記錄。', actions: [] }
}

function parseTransfer (text) {
  const q = clean(text)
  let amount = ''
  let unit = ''
  let who = ''
  const unitRe = '(美金|美元|台幣|臺幣|港幣|人民幣|USDT|USD|TWD|HKD|CNY|NTD|AUD|元)?'
  const a = q.match(new RegExp('(?:匯款|匯|轉帳|轉|傳送)\\s*([0-9]+(?:\\.[0-9]{1,8})?)\\s*' + unitRe + '\\s*(?:個|枚)?\\s*(?:SCDO)?\\s*(?:給|到|至)\\s*(.+)$', 'i'))
  const b = q.match(new RegExp('(?:給|到|至)\\s*(.+?)\\s*(?:匯款|匯|轉帳|轉|傳送)\\s*([0-9]+(?:\\.[0-9]{1,8})?)\\s*' + unitRe + '\\s*(?:個|枚)?\\s*(?:SCDO)?$', 'i'))
  if (a) { amount = a[1]; unit = a[2] || ''; who = a[3] } else if (b) { who = b[1]; amount = b[2]; unit = b[3] || '' } else return null
  who = String(who || '').trim()
  if (!who || !(Number(amount) > 0)) return null
  return { amount: amount + unit, who: who }
}

function resolvePayee (who, ctx) {
  const accounts = accountsOf(ctx)
  const q = clean(who)
  if (/^0x[0-9a-fA-F]{40}$/.test(q)) {
    const hit = accounts.find(a => a.evm && a.evm.toLowerCase() === q.toLowerCase())
    return { chain: 'shard0', to: q, file: hit ? hit.file : (ctx.selectedFile || ''), label: hit ? hit.label : q }
  }
  if (/^[1-4]S[0-9a-fA-F]{40}$/.test(q)) {
    const hit = accounts.find(a => a.address && a.address.toLowerCase() === q.toLowerCase())
    return { chain: 'classic', to: q, file: hit ? hit.file : '', shard: Number(q[0]), label: hit ? hit.label : q }
  }
  const exact = accounts.filter(a => a.label === q)
  const hits = exact.length ? exact : accounts.filter(a => a.label && q && a.label.indexOf(q) >= 0)
  if (!hits.length) {
    const payees = Array.isArray(ctx && ctx.payees) ? ctx.payees : []
    const named = payees.filter(p => p && clean(p.name || '') === q)
    if (named.length) return { to: named[0].name, label: named[0].name, remit: true }
    return { to: q, label: q, remit: true }
  }
  if (hits.length > 1) return { many: hits.map(a => a.label) }
  const a = hits[0]
  if (a.address && Number(a.shard) >= 1) return { chain: 'classic', to: a.address, file: a.file, shard: Number(a.shard), label: a.label }
  if (a.evm) return { chain: 'shard0', to: a.evm, file: a.file, label: a.label }
  return null
}

function planTransfer (text, ctx) {
  const parsed = parseTransfer(text)
  if (!parsed) return null
  const pay = resolvePayee(parsed.who, ctx || {})
  if (pay && pay.many) {
    return { say: '找到不只一個「' + pay.many.join('、') + '」。請說出完整名稱或地址。小貓不會送出。', actions: [] }
  }
  const file = (ctx && ctx.selectedFile) || (pay && pay.file) || ''
  if (!file) return { say: '請先選擇帳戶。小貓不會送出。', actions: [] }
  const to = pay && pay.to ? pay.to : parsed.who
  const label = pay && pay.label ? pay.label : parsed.who
  const chain = pay && pay.chain ? pay.chain : 'remit'
  return {
    say: '已把「匯 ' + parsed.amount + ' 給 ' + label + '」填進匯款表單。請你自己核對路線，再按確認。小貓不會簽名，也不會把錢送出。',
    actions: [{ type: 'prefill', chain: chain, file: file, to: to, amount: parsed.amount }]
  }
}

function wantsMine (q) {
  return /一鍵挖礦|開始挖礦|幫我挖|啟動挖礦|開挖/.test(q)
}

function reply (text, ctx) {
  ctx = ctx || {}
  const q = clean(text)
  if (!q) {
    return { say: '我是 AI小貓。我只在這台電腦上用規則幫忙，不會把資料送出去。我可以一鍵挖礦、在同步卡住時重新啟動節點、回答餘額、引導你備份帳戶檔案，也可以把「匯 100 給某人」填進表單。簽名和送出都要你自己按確認。', actions: [] }
  }
  if (looksLikeSecret(q) || /種子|助記詞|私鑰|密碼是/.test(q) && /顯示|給我|告訴|貼|是多少|看一下/.test(q)) return refuseSecret()
  if (/顯示.*(?:種子|助記詞|私鑰)|(?:種子|助記詞|私鑰).*(?:顯示|給我|告訴我)/.test(q)) return refuseSecret()
  const moved = planTransfer(q, ctx)
  if (moved) return moved
  if (/備份|帳戶檔案|助記詞|種子/.test(q)) return planBackup()
  if (/餘額|有多少|多少錢|多少\s*SCDO|資產/.test(q)) return sayBalance(ctx)
  if (/修復|同步卡住|沒有同伴|沒有節點|連不上|記憶體/.test(q)) return planHeal(ctx)
  if (wantsMine(q) || /也挖\s*(?:Shard\s*0|主鏈)|包含\s*(?:Shard\s*0|主鏈)/i.test(q)) {
    return planMine(Object.assign({}, ctx, { includeShard0: !!(ctx.includeShard0 || /Shard\s*0|主鏈|main chain/i.test(q)) }))
  }
  return { say: '我可以幫你：一鍵挖礦、自我修復、看餘額、備份帳戶檔案，或是把「匯 100 給某人」填進表單。我不會簽名，也不會把錢送出。', actions: [] }
}

function safePlan (plan) {
  const actions = (plan && plan.actions || []).filter(a => a && !BLOCKED[a.type])
  return { say: plan && plan.say ? String(plan.say) : '', actions: actions }
}

const api = {
  HEAT_C: HEAT_C,
  STALL_MS: STALL_MS,
  reply: function (text, ctx) { return safePlan(reply(text, ctx)) },
  planMine: function (ctx) { return safePlan(planMine(ctx)) },
  planHeal: function (ctx) { return safePlan(planHeal(ctx)) },
  heatGuard: function (ctx) { const p = heatGuard(ctx); return p ? safePlan(p) : null },
  parseTransfer: parseTransfer,
  looksLikeSecret: looksLikeSecret,
  startFail: startFail,
  diagnose: diagnose
}
if (typeof module !== 'undefined' && module.exports) module.exports = api
if (typeof window !== 'undefined') window.SCDOCat = Object.freeze(api)
})()
