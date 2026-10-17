// SCDO Wallet 2.0.1 mining types (JSDoc; the batch-1 spec's src/types/mining.ts adapted to this plain-JS renderer)
/**
 * @typedef {'NVIDIA'|'AMD'|'Intel'|'Unknown'} GpuVendor
 * @typedef {'ready'|'warn'|'notReady'} GpuCheckStatus
 * @typedef {{ vendor: GpuVendor, deviceName: string, vramGB: number, vramApprox?: boolean, driverVersion: string, cuda: boolean, status: GpuCheckStatus, reasons: string[] }} GpuInfo
 * @typedef {{ platform: string, supported: boolean, gpus: GpuInfo[], checkedAt: string }} GpuPreflight
 * @typedef {{ ok: boolean, height: number, difficulty: string, blockTimeSec: number|null, networkHashrate: number|null, localHashrate: number, sharePercent: number, window: number, source: string, asOf: string, error?: string }} MiningNetworkStats
 * @typedef {'solo'|'pool'} MiningMode
 * @typedef {{ miningMode: MiningMode, poolUrl: string, keepMining: boolean }} MiningConfig
 */
window.SCDOMining = window.SCDOMining || {}
// 2.0.4: UI language for the mining panels (app112.js sets SCDOMining.lang; 'CN' = 華語繁體)
window.SCDOMining.lang = 'CN'
window.SCDOMining.TW = Object.freeze({"Pool address": "礦池地址", "Official SCDO pool (default). You can change it to another pool.": "預設為 SCDO 官方礦池，可改成其他礦池。", "Pool: the graphics-card bookkeeping node connects directly to the pool address below.": "礦池：顯示卡記帳節點直接連線到下面的礦池地址。", "Graphics-card pre-flight check": "顯示卡預檢", " Detecting graphics-card hardware and drivers…": " 正在檢測顯示卡硬體和驅動程式…", "No graphics card was detected.": "沒有檢測到顯示卡。", "Unknown graphics card": "未知顯示卡", "READY": "就緒", "CHECK": "需檢查", "NOT READY": "未就緒", "Vendor: ": "廠商：", "Graphics memory: ": "顯示記憶體：", " (approx.)": "（約）", "unknown": "未知", "Driver: ": "驅動程式：", "not detected": "未檢測到", "Graphics-card bookkeeping: ": "顯示卡記帳：", "yes": "是", "no": "否", "This graphics card can be used for bookkeeping": "這張顯卡可以用來記帳", "This graphics card cannot be used for bookkeeping": "這張顯卡不能用來記帳", "Checked ": "檢查時間：", ". Needs an NVIDIA graphics card, the latest NVIDIA graphics driver, and 4 GB of graphics memory.": "。需要 NVIDIA 顯示卡，並安裝最新的 NVIDIA 顯示卡驅動程式，以及 4 GB 顯示記憶體。", "Graphics-card bookkeeping is not supported on Mac": "Mac 不支援顯示卡記帳", "Macs do not have the graphics driver this kind of graphics-card bookkeeping needs, and the built-in bookkeeping node (Rigel) has no macOS version, so graphics-card bookkeeping is not offered on this computer. Accounts, transfers and the network stats below work normally.": "Mac 沒有這種顯示卡記帳所需的驅動程式，內建記帳節點（Rigel）也沒有 macOS 版本，所以這台電腦不提供顯示卡記帳。帳戶、轉帳和下方的網路統計都可以正常使用。", "Network stats (Shard0 EVM)": "網路統計（Shard0 EVM）", "Refreshing…": "正在重新整理…", "Refresh": "重新整理", " Loading network data…": " 正在載入網路資料…", "Network data not available right now (": "暫時無法取得網路資料（", "). Retrying every 30 s.": "）。每 30 秒重試一次。", "offline": "離線", "Network hashrate (estimate)": "全網記帳速度 (H/s)（估計）", "Difficulty": "難度", "Average block time (last ": "平均出塊時間（最近 ", " blocks)": " 個區塊）", "Block height": "區塊高度", "Your hashrate": "本機記帳速度 (H/s)", "not bookkeeping": "未在記帳", "Your share of network hashrate": "本機佔全網記帳速度 (H/s)比例", "> 100 % (estimate lags behind)": "> 100 %（估計值有延遲）", "As of ": "資料時間：", " · source: ": " · 資料來源：", "scdoscan.io Shard0 EVM public node": "scdoscan.io Shard0 EVM 公開節點", "apeccapital.org Shard0 EVM public node": "apeccapital.org Shard0 EVM 公開節點", " · hashrate = difficulty ÷ average block time": " · 記帳速度 (H/s) = 難度 ÷ 平均出塊時間", "Figures are estimates derived from current network data and change constantly; they are not a forecast. Bookkeeping uses your hardware and electricity and can add heat, noise and wear.": "以上數字是根據目前網路資料推算的估計值，會不斷變化，不是預測。記帳會使用你的硬體和電力，並可能增加發熱、噪音和損耗。", "Pool address (you choose the pool; SCDO Wallet does not recommend or operate pools)": "礦池地址（礦池由你自己選擇；SCDO Wallet 不推薦也不經營任何礦池）", "Apply bookkeeping mode": "套用記帳模式", "Enter a pool address like stratum+tcp://host:port (also stratum+ssl, ethproxy+tcp, ethstratum+tcp). No user name or password in the address.": "請輸入礦池地址，例如 stratum+tcp://主機:連接埠（也支援 stratum+ssl、ethproxy+tcp、ethstratum+tcp）。地址裡不要包含使用者名稱或密碼。", "The pool address was not accepted.": "礦池地址沒有被接受。", "Bookkeeping mode": "記帳模式", "Solo (built-in SCDO node)": "單獨記帳（內建 SCDO 節點）", "Pool (enter a pool address)": "礦池（輸入礦池地址）", "Solo: you only see a result when this PC finds a whole block. With one graphics card that can take a very long time, or not happen at all.": "單獨記帳：只有這台電腦記到完整區塊時才會有結果。只用一張顯示卡可能要很長時間，也可能一直記不到。", "Pool: the graphics-card bookkeeping node connects directly to the pool you enter. Check the pool yourself before using it.": "礦池：顯示卡記帳節點會直接連線到你輸入的礦池。使用前請自行確認礦池。", "Stop bookkeeping to change the mode.": "請先停止記帳再變更模式。", " Keep bookkeeping: restart the bookkeeping node automatically if it exits, and resume bookkeeping when the wallet starts (off by default)": " 持續記帳：記帳節點退出時自動重新啟動，錢包啟動時恢復記帳（預設關閉）", "Keys and hashes are removed, addresses are shortened (0x1234…abcd) and your Windows user name is removed.": "金鑰和雜湊值會被移除，地址會縮短（0x1234…abcd），你的 Windows 使用者名稱也會被移除。", "Export bookkeeping logs (sanitized)": "匯出記帳日誌（已去除敏感資訊）", "Saved: ": "已儲存：", "Export failed.": "匯出失敗。", "Logs": "日誌", "Pool mode saved: ": "已儲存礦池模式：", "Solo mode saved": "已儲存單獨記帳模式", "Keep bookkeeping is on": "持續記帳已開啟", "Keep bookkeeping is off": "持續記帳已關閉", "The built-in bookkeeping node (Rigel) supports NVIDIA graphics cards only.": "內建記帳節點（Rigel）只支援 NVIDIA 顯示卡。", "NVIDIA driver not detected. Install the NVIDIA graphics driver.": "沒有檢測到 NVIDIA 驅動程式。請安裝 NVIDIA 顯示卡驅動程式。", "The driver needed for graphics-card bookkeeping was not found. Install or repair the latest NVIDIA graphics driver.": "找不到顯示卡記帳需要的驅動程式。請安裝或修復最新的 NVIDIA 顯示卡驅動程式。", "Graphics memory could not be measured exactly (nvidia-smi unavailable).": "無法精確測量顯示記憶體（nvidia-smi 無法使用）。", "All pre-flight checks passed.": "所有預檢項目都已通過。",
"Shard0 EVM network": "Shard0 EVM 的網路情況",
"Bookkeeping speed (H/s) ": "記帳速度 (H/s) 每秒 ",
" tries per second": " 次",
"Bookkeeping speed (H/s) is still being worked out": "記帳速度 (H/s) 還在計算",
"You are not bookkeeping yet, so there is no speed": "還沒開始記帳，所以還沒有速度",
"Network bookkeeping speed (H/s)": "全網記帳速度 (H/s)",
"Bookkeeping difficulty": "記帳難度",
"Difficulty ": "難度 ",
"Time between blocks": "區塊間隔",
"About ": "大約 ",
" seconds between blocks, counted from the last ": " 秒出一個區塊，用最近 ",
" blocks": " 個區塊算出來的",
"The time between blocks is still being worked out": "區塊間隔 還在算",
"How far the ledger has been written": "帳本記到哪裡",
"Block ": "第 ",
" on the ledger": " 個區塊",
"Your bookkeeping speed (H/s)": "你的記帳速度 (H/s)",
"Your share of bookkeeping": "你佔的比例",
"Your share is about 0 percent": "你大約佔了 0%",
"Your share is about ": "你大約佔了 ",
" percent": "%",
"Your share looks higher than the whole network because the estimate is behind": "這個估計慢了，所以看起來超過整個網路",
"Speed means how many tries happen each second. More tries make a block more likely.": "速度就是每秒嘗試多少次。次數越高，越容易記到區塊。",
"This is an estimate for the whole network, not a promise.": "這是整個網路的估計，不是保證。",
"Difficulty is how hard it is to find the next block. A bigger number needs more tries.": "難度是記下一個區塊有多難。數字越大，要嘗試的次數越多。",
"This is the average wait between blocks. It changes when the network changes.": "這是兩個區塊中間平均要等多久。網路變了，這個時間也會變。",
"This is how far this chain's ledger has been written.": "這是這條鏈的帳本已經記到第幾個區塊。",
"This is your computer's bookkeeping speed (H/s). It is zero until bookkeeping starts.": "這是你這台電腦的記帳速度 (H/s)。還沒開始記帳的時候沒有速度。",
"This is your computer's share of all the tries on the network.": "這是你這台電腦的嘗試次數，佔整個網路的多少。",
"). Retrying every 30 seconds.": "）。每 30 秒重試一次。",
" · bookkeeping speed (H/s) is tries per second, estimated from difficulty and the average time between blocks": " · 記帳速度 (H/s)就是每秒嘗試的次數，用難度和平均出塊時間估出來的。",
"Graphics memory ": "顯示記憶體 ",
"Graphics memory has not been read yet": "顯示記憶體 還沒讀到",
" (approximate)": "（大約）",
"This is the memory on the graphics card. Bookkeeping needs at least 4 GB. A bigger number can handle bookkeeping more comfortably.": "這是顯卡上的記憶體。記帳至少需要 4 GB。數字越大，越夠記帳用。",
"Graphics card check": "顯卡檢查",
"Graphics card detection failed": "顯示卡檢測失敗"})
window.SCDOMining.L = function (en) { const M = window.SCDOMining; return (M.lang === 'CN' && Object.prototype.hasOwnProperty.call(M.TW, en)) ? M.TW[en] : en }
// GPU check reasons come from the main process in English; the VRAM one carries numbers
window.SCDOMining.reason = function (r) { const M = window.SCDOMining; if (M.lang !== 'CN') return r; const m = /^Not enough graphics memory: at least (\S+) GB is required, found (\S+) GB\.$/.exec(String(r)); if (m) return '顯示記憶體不足：至少需要 ' + m[1] + ' GB，目前只有 ' + m[2] + ' GB。'; return M.L(r) }
window.SCDOMining.locale = function () { return window.SCDOMining.lang === 'CN' ? 'zh-TW' : 'en-AU' }
window.SCDOMining.MiningMode = Object.freeze({ SOLO: 'solo', POOL: 'pool' })
