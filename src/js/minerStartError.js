// Plain words for Shard0 EVM miner failures. The English sentence stays in the log.
// zh-Hant screens use these sentences. English screens keep an English sentence.
'use strict'
;(function () {
  const FULL = {
    NO_NVIDIA: {
      CN: '沒有找到可用的 NVIDIA 顯示卡或驅動，已停止。可以改用「只執行節點」。',
      EN: 'No usable NVIDIA graphics card or driver was found, so bookkeeping stopped. Use Run node only instead.'
    },
    DEFENDER: {
      CN: '防毒軟體（Windows Defender）把顯示卡記帳節點刪掉了。請在防毒軟體裡把 SCDO Wallet 的資料夾加入允許清單，再按「開始記帳」。',
      EN: 'Antivirus software (Windows Defender) removed the graphics-card bookkeeping node. Add the SCDO Wallet folder to the allow list, then press Start bookkeeping.'
    },
    DOWNLOAD: {
      CN: '記帳節點下載失敗，請檢查網路後再試一次。',
      EN: 'The bookkeeping node download failed. Check the network and try again.'
    },
    SHA256: {
      CN: '下載的記帳節點不完整，已幫你刪掉，請再試一次。',
      EN: 'The downloaded bookkeeping node was incomplete and has been deleted. Please try again.'
    },
    PORTS: {
      CN: '這台電腦記帳要用的連線埠被別的程式佔用了，請關掉其他記帳節點或重新開機後再試。',
      EN: 'The connection ports this computer needs for bookkeeping are in use. Close the other bookkeeping nodes or restart the computer, then try again.'
    },
    BAD_POOL: {
      CN: '記帳池地址不對。請改成完整的記帳池地址後再試。',
      EN: 'The pool address is not valid. Enter the full pool address and try again.'
    },
    BAD_PAYOUT: {
      CN: '節點服務費地址不對。請改成 0x 開頭的 Shard0 EVM 收款地址後再試。',
      EN: 'The node service-fee address is not valid. Use a Shard0 EVM address that starts with 0x.'
    },
    CRASHING: {
      CN: '記帳節點反覆自己關掉，已經停止。請再試一次；如果一直失敗，可以在「記帳」頁的「日誌」按「匯出記帳日誌」，把檔案傳給客服。',
      EN: 'The bookkeeping node kept closing on its own, so it was stopped. Try again. If it keeps failing, open the Bookkeeping page, press "Export bookkeeping logs (sanitized)" under Logs, and send the file to support.'
    },
    EXTERNAL_DOWN: {
      CN: '這台電腦上的另一個節點沒有回應。請確認那個節點還開著，再試一次。',
      EN: 'The other node on this computer is not answering. Check that it is still open, then try again.'
    },
    // Classic (Shard1 to Shard4) start failures. The English detail stays in the log.
    NO_ZMINER: {
      CN: '找不到處理器記帳節點。請重新安裝 SCDO Wallet。',
      EN: 'The processor bookkeeping program was not found. Please reinstall SCDO Wallet.'
    },
    NO_POOL: {
      CN: 'Shard1 到 Shard4 的處理器記帳池目前還沒有開放，所以沒有開始記帳。Shard0 EVM 請用顯示卡記帳。',
      EN: 'The Shard1 to Shard4 processor pools are not open yet, so bookkeeping did not start. Shard0 EVM does bookkeeping with a graphics card.'
    },
    NO_ROSETTA: {
      CN: '這台 Mac 需要先安裝 Apple 的 Rosetta 2 才能用處理器記帳。請打開「終端機」執行：softwareupdate --install-rosetta --agree-to-license，然後再按開始記帳。',
      EN: 'This Mac needs Apple Rosetta 2 for processor bookkeeping. Open Terminal and run: softwareupdate --install-rosetta --agree-to-license, then press Start bookkeeping again.'
    },
    NO_CLASSIC_NODE: {
      CN: '找不到 Classic 的顯示卡記帳節點。請重新安裝 SCDO Wallet。',
      EN: 'The Classic graphics-card bookkeeping program was not found. Please reinstall SCDO Wallet.'
    },
    NO_ZMINER_GPU: {
      CN: '找不到顯卡記帳池程式。請重新安裝 SCDO Wallet。',
      EN: 'The graphics-card pool program was not found. Please reinstall SCDO Wallet.'
    },
    NO_CUDART: {
      CN: '顯示卡記帳需要的檔案不見了，所以沒有開始記帳。請重新安裝 SCDO Wallet。',
      EN: 'A file the graphics-card bookkeeping node needs is missing, so bookkeeping did not start. Please reinstall SCDO Wallet.'
    },
    SHA256_MISSING: {
      CN: '溫馨提醒：還沒能確認記帳節點是不是官方版本，所以這次沒有啟動。重新安裝 SCDO Wallet 就可以。',
      EN: 'A reminder: the wallet could not yet check that the bookkeeping node is the official version, so this start did not go ahead. Reinstalling SCDO Wallet takes care of it.'
    },
    SHA256_MISMATCH: {
      CN: '溫馨提醒：下載的記帳節點跟官方版本對不上，所以這次沒有啟動。重新安裝或再試一次就可以。',
      EN: 'A reminder: the bookkeeping node does not match the official version, so this start did not go ahead. Reinstalling or trying again takes care of it.'
    },
    BAD_ARGS: {
      CN: '記帳節點的啟動設定不對，所以沒有開始記帳。請檢查記帳地址和設定，再試一次。',
      EN: 'The settings for starting the bookkeeping node are not valid, so bookkeeping did not start. Check the bookkeeping address and settings, then try again.'
    },
    BAD_POOLS: {
      CN: '記帳池設定不對，所以沒有開始記帳。請再試一次；如果一直失敗，請重新安裝 SCDO Wallet。',
      EN: 'The pool settings are not valid, so bookkeeping did not start. Try again. If it keeps failing, reinstall SCDO Wallet.'
    },
    BAD_DATADIR: {
      CN: '存放記帳資料的資料夾位置不對，所以沒有開始記帳。請再試一次；如果一直失敗，請重新安裝 SCDO Wallet。',
      EN: 'The folder for the bookkeeping data is in the wrong place, so bookkeeping did not start. Try again. If it keeps failing, reinstall SCDO Wallet.'
    },
    BAD_KEY: {
      CN: '這台電腦連上記帳網路用的金鑰有問題，所以沒有開始記帳。請關掉 SCDO Wallet 再打開，然後再試一次。',
      EN: 'The key this computer uses to join the bookkeeping network has a problem, so bookkeeping did not start. Close SCDO Wallet, open it again, and try again.'
    },
    NETWORK: {
      CN: '連不上記帳池或節點，請檢查網路後再試一次。',
      EN: 'Could not reach the pool or the node. Check the network and try again.'
    },
    LIGHT: {
      CN: '輕量模式不記帳。到設定裡關掉輕量模式再開始。',
      EN: 'Light mode keeps bookkeeping off. Turn Light mode off to start.'
    },
    UNKNOWN: {
      CN: '記帳節點沒有啟動成功，請再試一次；如果一直失敗，可以在「記帳」頁的「日誌」按「匯出記帳日誌」，把檔案傳給客服。',
      EN: 'The bookkeeping node did not start. Try again. If it keeps failing, open the Bookkeeping page, press "Export bookkeeping logs (sanitized)" under Logs, and send the file to support.'
    }
  }
  const CLASSIC_CODES = ['NO_ZMINER', 'NO_POOL', 'NO_ROSETTA', 'NO_ZMINER_GPU', 'NO_CLASSIC_NODE', 'NO_CUDART', 'SHA256_MISSING', 'SHA256_MISMATCH', 'BAD_ARGS', 'BAD_POOLS', 'BAD_DATADIR', 'BAD_KEY', 'NETWORK']
  const SHORT = {
    NO_NVIDIA: { CN: '沒有找到顯示卡', EN: 'no graphics card found' },
    DEFENDER: { CN: '被防毒軟體刪掉', EN: 'removed by antivirus' },
    DOWNLOAD: { CN: '下載失敗', EN: 'download failed' },
    SHA256: { CN: '下載的程式不完整', EN: 'downloaded program was incomplete' },
    PORTS: { CN: '連線埠被佔用', EN: 'connection ports are in use' },
    BAD_POOL: { CN: '記帳池地址不對', EN: 'pool address is not valid' },
    BAD_PAYOUT: { CN: '服務費地址不對', EN: 'service-fee address is not valid' },
    CRASHING: { CN: '程式反覆關掉', EN: 'the program kept closing' },
    EXTERNAL_DOWN: { CN: '另一個節點沒有回應', EN: 'the other node is not answering' },
    NO_ZMINER: { CN: '找不到處理器記帳節點', EN: 'processor bookkeeping program not found' },
    NO_POOL: { CN: '記帳池還沒開放', EN: 'pool not open yet' },
    NO_ROSETTA: { CN: '需要安裝 Rosetta 2', EN: 'Rosetta 2 is needed' },
    NO_CLASSIC_NODE: { CN: '找不到顯示卡記帳節點', EN: 'graphics-card bookkeeping program not found' },
    NO_ZMINER_GPU: { CN: '找不到顯卡記帳池程式', EN: 'graphics-card pool program not found' },
    NO_CUDART: { CN: '顯示卡記帳檔案不見了', EN: 'a graphics-card bookkeeping file is missing' },
    SHA256_MISSING: { CN: '沒辦法確認是官方版本', EN: 'could not check the official version' },
    SHA256_MISMATCH: { CN: '跟官方版本對不上', EN: 'does not match the official version' },
    BAD_ARGS: { CN: '啟動設定不對', EN: 'start settings are not valid' },
    BAD_POOLS: { CN: '記帳池設定不對', EN: 'pool settings are not valid' },
    BAD_DATADIR: { CN: '資料夾位置不對', EN: 'data folder is in the wrong place' },
    BAD_KEY: { CN: '網路金鑰有問題', EN: 'network key has a problem' },
    NETWORK: { CN: '連不上記帳池或節點', EN: 'could not reach the pool or node' },
    LIGHT: { CN: '輕量模式', EN: 'Light mode' },
    UNKNOWN: { CN: '沒有啟動成功', EN: 'did not start' }
  }

  function kind (code, message) {
    const c = String(code || '').toUpperCase()
    const msg = String(message || '')
    if (c === 'NO_NVIDIA') return 'NO_NVIDIA'
    if (CLASSIC_CODES.includes(c)) return c
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
    if (lang === 'CN') return '記帳節點出錯：' + shortLabel('CN', code, message)
    return 'Bookkeeping node error: ' + shortLabel('EN', code, message)
  }
  // Stop mining is for a running miner. A node-only run, and a stopped miner, leave it off.
  function minersRunning (st) {
    if (!st) return false
    if (st.classicNote) return true
    return !!(st.running && (st.mode === 'mine' || st.mode === 'pool'))
  }

  // Classic start: a mapped code, else a timeout or HTTP failure, else the zh-Hant/English line
  // from the i18n table (stKey), else the plain UNKNOWN sentence. Never the raw English.
  function classicStartText (lang, code, message, stText) {
    const c = String(code || '').toUpperCase()
    const msg = String(message || '')
    if (c && FULL[c]) return full(lang, c, '')
    if (!c && /\btimeout\b|HTTP \d+|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(msg)) return full(lang, 'NETWORK', '')
    if (stText) return stText
    return full(lang, 'ERROR', '')
  }

  const api = { kind, full, shortLabel, tooltipError, minersRunning, classicStartText, FULL, SHORT, CLASSIC_CODES }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (typeof window !== 'undefined') window.SCDOStartError = api
})()
