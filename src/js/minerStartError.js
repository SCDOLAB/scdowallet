// Plain words for main-chain miner failures. The English sentence stays in the log.
// zh-Hant screens use these sentences. English screens keep an English sentence.
'use strict'
;(function () {
  const FULL = {
    NO_NVIDIA: {
      CN: '沒有找到可用的 NVIDIA 顯示卡或驅動，已停止。可以改用「只執行節點」。',
      EN: 'No usable NVIDIA graphics card or driver was found, so mining stopped. Use Run node only instead.'
    },
    DEFENDER: {
      CN: '防毒軟體（Windows Defender）把顯示卡挖礦程式刪掉了。請在防毒軟體裡把 SCDO Wallet 的資料夾加入允許清單，再按「開始挖礦」。',
      EN: 'Antivirus software (Windows Defender) removed the graphics-card miner. Add the SCDO Wallet folder to the allow list, then press Start mining.'
    },
    DOWNLOAD: {
      CN: '挖礦程式下載失敗，請檢查網路後再試一次。',
      EN: 'The miner download failed. Check the network and try again.'
    },
    SHA256: {
      CN: '下載的挖礦程式不完整，已幫你刪掉，請再試一次。',
      EN: 'The downloaded miner was incomplete and has been deleted. Please try again.'
    },
    PORTS: {
      CN: '這台電腦挖礦要用的連線埠被別的程式佔用了，請關掉其他挖礦程式或重新開機後再試。',
      EN: 'The connection ports this computer needs for mining are in use. Close the other mining programs or restart the computer, then try again.'
    },
    BAD_POOL: {
      CN: '礦池地址不對。請改成完整的礦池地址後再試。',
      EN: 'The pool address is not valid. Enter the full pool address and try again.'
    },
    BAD_PAYOUT: {
      CN: '節點服務費地址不對。請改成 0x 開頭的主鏈收款地址後再試。',
      EN: 'The node service-fee address is not valid. Use a main chain address that starts with 0x.'
    },
    CRASHING: {
      CN: '挖礦程式反覆自己關掉，已經停止。請再試一次；如果一直失敗，可以在「設定」匯出診斷資料。',
      EN: 'The miner kept closing on its own, so it was stopped. Try again. If it keeps failing, export the diagnostic data in Settings.'
    },
    EXTERNAL_DOWN: {
      CN: '這台電腦上的另一個節點沒有回應。請確認那個節點還開著，再試一次。',
      EN: 'The other node on this computer is not answering. Check that it is still open, then try again.'
    },
    UNKNOWN: {
      CN: '挖礦程式沒有啟動成功，請再試一次；如果一直失敗，可以在「設定」匯出診斷資料。',
      EN: 'The miner did not start. Try again. If it keeps failing, export the diagnostic data in Settings.'
    }
  }
  const SHORT = {
    NO_NVIDIA: { CN: '沒有找到顯示卡', EN: 'no graphics card found' },
    DEFENDER: { CN: '被防毒軟體刪掉', EN: 'removed by antivirus' },
    DOWNLOAD: { CN: '下載失敗', EN: 'download failed' },
    SHA256: { CN: '下載的程式不完整', EN: 'downloaded program was incomplete' },
    PORTS: { CN: '連線埠被佔用', EN: 'connection ports are in use' },
    BAD_POOL: { CN: '礦池地址不對', EN: 'pool address is not valid' },
    BAD_PAYOUT: { CN: '服務費地址不對', EN: 'service-fee address is not valid' },
    CRASHING: { CN: '程式反覆關掉', EN: 'the program kept closing' },
    EXTERNAL_DOWN: { CN: '另一個節點沒有回應', EN: 'the other node is not answering' },
    UNKNOWN: { CN: '沒有啟動成功', EN: 'did not start' }
  }

  function kind (code, message) {
    const c = String(code || '').toUpperCase()
    const msg = String(message || '')
    if (c === 'NO_NVIDIA') return 'NO_NVIDIA'
    if (c === 'DEFENDER' || /defender|quarantine/i.test(msg)) return 'DEFENDER'
    if (c === 'PORTS' || /no free local ports/i.test(msg)) return 'PORTS'
    if (c === 'BAD_POOL') return 'BAD_POOL'
    if (c === 'BAD_PAYOUT') return 'BAD_PAYOUT'
    if (c === 'CRASHING') return 'CRASHING'
    if (c === 'EXTERNAL_DOWN') return 'EXTERNAL_DOWN'
    if (/sha256 mismatch/i.test(msg)) return 'SHA256'
    if (/download timeout|\btimeout\b|HTTP \d+|ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(msg)) return 'DOWNLOAD'
    if (c && c !== 'ERROR' && FULL[c]) return c
    return 'UNKNOWN'
  }

  function pick (table, lang, code, message) {
    const row = table[kind(code, message)] || table.UNKNOWN
    return lang === 'CN' ? row.CN : row.EN
  }
  function full (lang, code, message) { return pick(FULL, lang, code, message) }
  function shortLabel (lang, code, message) { return pick(SHORT, lang, code, message) }
  function tooltipError (lang, code, message) {
    if (lang === 'CN') return '挖礦程式出錯：' + shortLabel('CN', code, message)
    return 'Miner error: ' + shortLabel('EN', code, message)
  }
  // Stop mining is for a running miner. A node-only run, and a stopped miner, leave it off.
  function minersRunning (st) {
    if (!st) return false
    if (st.classicNote) return true
    return !!(st.running && (st.mode === 'mine' || st.mode === 'pool'))
  }

  const api = { kind, full, shortLabel, tooltipError, minersRunning, FULL, SHORT }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (typeof window !== 'undefined') window.SCDOStartError = api
})()
