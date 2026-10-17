// Generates index.html (English) and zh/index.html (華語繁體). One language per page, never mixed.
'use strict'
const fs = require('fs'); const path = require('path')
const L = {
  en: { lang: 'en', title: 'SCDO AI Agent Ledger', intro: 'Every wallet and bookkeeping node registers as an agent with its own key. Each machine signs its own heartbeats and self-heal events; this server only checks signatures and holds no private keys.', agents: 'Agents', online: 'Online', agent: 'Agent', status: 'Status', hash: 'Hashrate', temp: 'GPU temp', peers: 'Peers', block: 'Block', heals: 'Self-heals', last: 'Last seen', yes: 'online', no: 'offline', none: 'No bookkeeping nodes yet. Bookkeeping nodes will appear here after they register with SCDO Wallet 3.1.4.', err: 'Could not load the ledger.', api: 'Public JSON', other: '華語繁體', otherHref: 'zh/', ago: ' min ago', lastHeal: 'Last heal' },
  zh: { lang: 'zh-Hant', title: 'SCDO AI 代理帳本', intro: '每個錢包和記帳節點都以自己的金鑰註冊為代理。每台機器自行簽署心跳和自我修復紀錄；伺服器只驗證簽章，不持有任何私鑰。', agents: '代理數', online: '在線', agent: '代理', status: '狀態', hash: '算力', temp: '顯示卡溫度', peers: '節點連線', block: '區塊', heals: '自我修復', last: '最後回報', yes: '在線', no: '離線', none: '目前還沒有記帳節點。記帳節點使用 SCDO 錢包 3.1.4 註冊後，就會顯示在這裡。', err: '無法載入帳本。', api: '公開 JSON', other: 'English', otherHref: '../', ago: ' 分鐘前', lastHeal: '最近修復' }
}
function page (t, api) {
  return `<!doctype html><html lang="${t.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${t.title}</title>
<style>body{font-family:system-ui,sans-serif;margin:0;background:#0d1117;color:#e6edf3}main{max-width:1100px;margin:auto;padding:24px}a{color:#58a6ff}table{width:100%;border-collapse:collapse;font-size:14px}th,td{padding:6px 8px;border-bottom:1px solid #30363d;text-align:left}code{font-size:12px}.on{color:#3fb950}.off{color:#8b949e}.kpi{display:flex;gap:24px;margin:16px 0}.kpi b{font-size:28px;display:block}footer{text-align:center;color:#8b949e;padding:24px}</style></head>
<body><main><p style="text-align:right"><a href="${t.otherHref}">${t.other}</a></p><h1>${t.title}</h1><p>${t.intro}</p>
<div class="kpi"><div><b id="total">–</b>${t.agents}</div><div><b id="online">–</b>${t.online}</div></div>
<table><thead><tr><th>${t.agent}</th><th>${t.status}</th><th>${t.hash}</th><th>${t.temp}</th><th>${t.peers}</th><th>${t.block}</th><th>${t.heals}</th><th>${t.lastHeal}</th><th>${t.last}</th></tr></thead><tbody id="rows"></tbody></table>
<p id="msg"></p></main><footer>SCDO Laboratory</footer>
<script>
const T=${JSON.stringify({ yes: t.yes, no: t.no, none: t.none, err: t.err, ago: t.ago })};
const esc=s=>String(s==null?'–':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const hr=h=>h==null?'–':h>=1e6?(h/1e6).toFixed(2)+' MH/s':h>=1e3?(h/1e3).toFixed(1)+' kH/s':h+' H/s';
fetch('${api}/agents',{cache:'no-store'}).then(r=>r.json()).then(d=>{
 document.getElementById('total').textContent=d.total;document.getElementById('online').textContent=d.online;
 if(!d.agents.length){document.getElementById('msg').textContent=T.none;return}
 document.getElementById('rows').innerHTML=d.agents.map(a=>'<tr><td><a href="https://scdoscan.io/#/address?address='+esc(a.agent)+'"><code>'+esc(a.agent.slice(0,10)+'…'+a.agent.slice(-6))+'</code></a></td><td class="'+(a.online?'on':'off')+'">'+(a.online?T.yes:T.no)+(a.problems.length?' · '+esc(a.problems.join(', ')):'')+'</td><td>'+hr(a.hashrate)+'</td><td>'+(a.gpuTempC==null?'–':esc(a.gpuTempC)+' °C')+'</td><td>'+esc(a.peers)+'</td><td>'+esc(a.localBlock)+'</td><td>'+esc(a.heals)+'</td><td>'+(a.lastHeal?esc(a.lastHeal.action):'–')+'</td><td>'+(a.lastSeen?Math.round((d.time-a.lastSeen)/60000)+T.ago:'–')+'</td></tr>').join('')
}).catch(()=>{document.getElementById('msg').textContent=T.err})
</script></body></html>
`
}
const api = '/agent-ledger/api'
fs.writeFileSync(path.join(__dirname, 'index.html'), page(L.en, api))
fs.writeFileSync(path.join(__dirname, 'zh', 'index.html'), page(L.zh, api))
