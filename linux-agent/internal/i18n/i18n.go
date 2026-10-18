// Package i18n is the agent CLI copy. English is the default. 華語 is selected
// with --lang zh or a LANG=zh* locale. The language name is 華語.
package i18n

import "strings"

type Lang string

const (
	EN Lang = "en"
	ZH Lang = "zh"
)

// Detect chooses a language. flag wins. Otherwise LC_ALL, then LANG, when it starts with zh.
func Detect(flag, lcAll, langEnv string) Lang {
	switch strings.ToLower(strings.TrimSpace(flag)) {
	case "zh", "zh-hant", "zh-tw", "zh-hk":
		return ZH
	case "en", "en-us", "en-gb":
		return EN
	}
	blob := strings.TrimSpace(lcAll)
	if blob == "" {
		blob = strings.TrimSpace(langEnv)
	}
	if strings.HasPrefix(strings.ToLower(blob), "zh") {
		return ZH
	}
	return EN
}

// Bundle is the copy for one language.
type Bundle struct {
	Lang Lang
	m    map[string]string
}

func New(lang Lang) Bundle {
	if lang == ZH {
		return Bundle{Lang: ZH, m: zh}
	}
	return Bundle{Lang: EN, m: en}
}

func (b Bundle) T(key string) string {
	if s, ok := b.m[key]; ok {
		return s
	}
	if s, ok := en[key]; ok {
		return s
	}
	return key
}

// Catalog returns every user-facing string so tests can scan wording.
func Catalog() map[Lang]map[string]string {
	return map[Lang]map[string]string{EN: en, ZH: zh}
}

var en = map[string]string{
	"help": `scdo-agent — headless SCDO bookkeeping agent

Usage:
  scdo-agent [--lang en|zh] [--data-dir DIR] <command> [flags]

Commands:
  init      Create an agent identity
  run       Register and send heartbeats in the foreground
  status    Show the agent address and ledger online state
  list      List agent identities on this machine
  logs      Show how to read the service log
  upgrade-now  Check the signed feed, swap the binary, and reconcile adapters
  wallet    Create a bot wallet, set limits, or export the keystore
  pay       Pay an HTTP 402 with Base Sepolia USDC
  serve-paywall  Receive a payment through the testnet facilitator
  erc8004   Register this agent on the Shard0 ERC-8004 identity registry
  version   Print the version
  help      Show this help

version:
  scdo-agent version
  scdo-agent --version
  scdo-agent -v

Language:
  English by default. For 華語, pass --lang zh or use a LANG=zh* locale.

init:
  scdo-agent init --name NAME --payout 0xADDR [--label TEXT]
      [--role light-node|server-node] [--ref TOKEN] [--src TOKEN]
      [--passphrase-file PATH]

  --payout is required. The secp256k1 key is stored mode 0600 and is never printed.
  --passphrase-file encrypts that key. Without it, a service-user key file is used
  for unattended systemd.

run:
  scdo-agent run --name NAME [--ledger URL] [--passphrase-file PATH]

  Heartbeats go out every 5 minutes. The ledger base is https://scdo.com.au
  and falls back to https://apeccapital.org. This process keeps the ledger record.

status:
  scdo-agent status --name NAME [--ledger URL]

logs:
  scdo-agent logs --name NAME

upgrade-now:
  sudo scdo-agent upgrade-now [--dry-run] [--user] [--passphrase-file PATH]
      [--config-dir DIR] [--binary PATH]

  A system install needs root, except for --dry-run, which only checks the signed feed.
  install.sh --user updates ~/.local/bin/scdo-agent without root and restarts
  systemctl --user units. The feed selects files.<cpu> (url, sha256, size)
  and falls back to the top-level file. The signature stays Ed25519 over the
  canonical JSON with the signature removed.
  A failed health check restores the previous binary. Key files are copied
  into the backup and are not deleted.

User install (no root):
  sh install.sh --user
  Binary ~/.local/bin/scdo-agent. Data ~/.local/share/scdo-agent.
  systemctl --user enable --now scdo-agent@NAME.service
  loginctl enable-linger $USER keeps the user services running after logout.
  A name already enabled as a system unit is not started a second time.

wallet:
  scdo-agent wallet create --bot ID [--name NAME] [--email ADDR]
      [--passphrase-file PATH] [--ledger URL]
  scdo-agent wallet show --bot ID
  scdo-agent wallet limit --bot ID [--per-payment USDC] [--daily USDC]
      [--allow-domain HOST] [--allow-payto 0xADDR]
  scdo-agent wallet freeze --bot ID
  scdo-agent wallet unfreeze --bot ID
  scdo-agent wallet export --bot ID [--out FILE]
      [--export-passphrase-file PATH] [--raw --i-understand-raw-key]
  scdo-agent wallet bind-email --bot ID [--email ADDR]
  scdo-agent wallet confirm-email --bot ID --code 123456
  scdo-agent wallet bind-x --bot ID
  scdo-agent pay URL --bot ID [--max USDC] [--dry-run]
  scdo-agent serve-paywall --bot ID --price USDC [--path /answer] [--port 8410]

  --bot is the agent name when --name is omitted. An email is stored only as a
  salted commitment. The salt stays in the agent directory and is sent only to
  /bind/email/start, never printed.
  Payments use the open-source x402 SDK. Only Base Sepolia USDC is enabled.
  Limits are checked before signing. A policy refusal exits with status 3.
  An empty payee or domain list allows any Base Sepolia payee or host.
  serve-paywall uses https://x402.org/facilitator and books each settled
  payment with /ledger/income.
  export writes an encrypted Web3 keystore. A raw key is printed only on a
  terminal, and only with --raw and --i-understand-raw-key.
  Your keys stay on your machine. SCDO never holds them.

erc8004:
  scdo-agent erc8004 register --name NAME [--rpc URL] [--passphrase-file PATH]

  Registers the ledger address on Shard0 (eip155:5680). Gas is native SCDO.
  The key is not printed. An address that already has an identity is left as it is.
  Automatic registration on start stays off unless /etc/scdo-agent/config.toml
  contains erc8004 = true.

Data directory: /var/lib/scdo-agent/<name>/
One systemd instance per agent: scdo-agent@<name>.service.
`,
	"ready":              "Agent %s is ready.",
	"address":            "Address: %s",
	"payout":             "Payout: %s",
	"role":               "Role: %s",
	"data":               "Data: %s",
	"next":               "Next:",
	"nextEnable":         "  sudo systemctl enable --now scdo-agent@%s.service",
	"nextStatus":         "  scdo-agent status --name %s",
	"exists":             "Agent %s already exists. The existing key was left in place.",
	"notInit":            "Agent %s is not initialised. Run init first.",
	"running":            "Agent %s is already running.",
	"noAgents":           "No agents.",
	"listHead":           "Agents:",
	"logsHint":           "Service log: journalctl -u scdo-agent@%s.service -f",
	"logsOut":            "A foreground run writes the same lines to standard output.",
	"online":             "Online: %s",
	"ledger":             "Ledger: %s",
	"code":               "Code: %s",
	"unreachable":        "The ledger could not be reached.",
	"notReg":             "This agent has no ledger record yet.",
	"version":            "scdo-agent %s",
	"roleLight":          "bookkeeping node",
	"roleServer":         "server node",
	"langName":           "English",
	"usage":              "Run scdo-agent help for usage.",
	"badPayout":          "A payout address is required: --payout 0x...",
	"needName":           "A name is required: --name <name>",
	"passFile":           "Set --passphrase-file or SCDO_AGENT_PASSPHRASE_FILE to unlock the key.",
	"about":              "x402 payments use https://github.com/coinbase/x402 (Apache-2.0, Copyright 2026 x402 Foundation).",
	"needBot":            "A bot id is required: --bot <id>",
	"needURL":            "A URL is required.",
	"needPrice":          "A price is required: --price 0.01",
	"needLimit":          "Set --per-payment, --daily, --allow-domain, or --allow-payto.",
	"needExportPass":     "Set --export-passphrase-file to encrypt the keystore.",
	"walletEmail":        "Email commitment: %s",
	"walletBotLine":      "Bot: %s",
	"walletPer":          "Per payment: %s USDC",
	"walletDaily":        "Daily: %s USDC",
	"walletSpent":        "Spent in the last 24 hours: %s USDC",
	"walletPayees":       "Payees: %s",
	"walletDomains":      "Domains: %s",
	"walletAnyPayee":     "Payees: any Base Sepolia address",
	"walletAnyDomain":    "Domains: any host",
	"walletKillOn":       "Kill switch: on",
	"walletKillOff":      "Kill switch: off",
	"walletKeys":         "Your keys stay on your machine. SCDO never holds them.",
	"limitBlocked":       "Payment stopped: over today's limit",
	"payDry":             "Would pay %s atomic units to %s.",
	"paywallReady":       "Paywall for %s at %s USDC on %s port %d. Facilitator: https://x402.org/facilitator",
	"exportWrote":        "Keystore: %s",
	"connectBots":        "Grok / AI bots: give each bot its own wallet and books",
	"connectX":           "Bind an X account with wallet bind-x when the ledger enables it.",
	"emailNoSender":      "The ledger accepted this email, but it has no mail sender yet (delivery: todo_no_sender). No code was sent.",
	"emailStarted":       "Email verification started.",
	"emailVerified":      "Email verified on the ledger.",
	"emailTries":         "Email code was not accepted (%d of 5).",
	"emailStopped":       "Email confirmation stopped after 5 tries.",
	"needCode":           "A 6-digit code is required: --code 123456",
	"xNotEnabled":        "X binding not yet enabled on the ledger",
	"xURL":               "Open this URL to bind the X account: %s",
	"walletReady":        "Wallet %s is bound for bot %s.",
	"walletNetwork":      "Network: %s",
	"walletLedger":       "Ledger: %s",
	"walletBot":          "Bot wallet: %s",
	"walletTx":           "Transaction: https://sepolia.basescan.org/tx/%s",
	"walletKilled":       "Payments are stopped and the ledger record is frozen.",
	"walletUnkilled":     "Payments are allowed and the ledger record is unfrozen.",
	"erc8004ID":          "Agent id: %s",
	"erc8004URI":         "Registration: %s",
	"erc8004Tx":          "Transaction: %s",
	"erc8004Ready":       "ERC-8004 identity %s is registered.",
	"erc8004Already":     "ERC-8004 identity %s is already registered.",
	"needRoot":           "upgrade-now needs root for a system install. Use --user after install.sh --user, or --dry-run to check the feed without replacing the binary.",
	"otherMode":          "Agent %s is already active in the other install mode. It was not started.",
	"nextEnableUser":     "  systemctl --user enable --now scdo-agent@%s.service",
	"logsHintUser":       "Service log: journalctl --user -u scdo-agent@%s.service -f",
	"upgradeBusy":        "An upgrade is already running.",
	"upgradeUnreachable": "The release feed could not be reached. The installed binary was left in place.",
	"upgradeCurrent":     "Installed %s is current.",
	"upgradeWould":       "Would install %s (installed %s).",
	"upgradeArch":        "Feed is for %s; this CPU is %s.",
	"upgradeOk":          "Updated %s -> %s.",
	"upgradeNone":        "No newer release.",
	"upgradeRolled":      "Health check failed. The previous binary was restored.",
	"upgradeReconcile":   "Reconcile: %s",
}

var zh = map[string]string{
	"help": `scdo-agent — 無介面的 SCDO 記帳代理

用法：
  scdo-agent [--lang en|zh] [--data-dir DIR] <命令> [旗標]

命令：
  init      建立一個代理身份
  run       在前景登記並送出心跳
  status    顯示代理地址與帳本上的在線狀態
  list      列出這台機器上的代理
  logs      顯示如何查看服務紀錄
  upgrade-now  檢查簽章後的發布檔，替換執行檔，並核對顯示卡與帳號對應
  wallet    建立機器人錢包、設定限額，或匯出金鑰庫
  pay       對 HTTP 402 支付 Base Sepolia USDC
  serve-paywall  以測試網 facilitator 收取付款
  erc8004   在 Shard0 的 ERC-8004 身份登記冊登記這個代理
  version   顯示版本
  help      顯示這份說明

version：
  scdo-agent version
  scdo-agent --version
  scdo-agent -v

語言：
  預設為英文。華語：--lang zh，或 LANG=zh* 語系。

init：
  scdo-agent init --name 名稱 --payout 0x地址 [--label 文字]
      [--role light-node|server-node] [--ref 代碼] [--src 代碼]
      [--passphrase-file 路徑]

  --payout 為必填。secp256k1 金鑰以 0600 權限存放，不會印出。
  --passphrase-file 會把金鑰加密後存放。未設定時，以僅限服務使用者讀取的金鑰檔提供無人值守的 systemd。

run：
  scdo-agent run --name 名稱 [--ledger URL] [--passphrase-file 路徑]

  每 5 分鐘送出一次心跳。帳本位址為 https://scdo.com.au，失敗時改用 https://apeccapital.org。此行程只維護帳本紀錄。

status：
  scdo-agent status --name 名稱 [--ledger URL]

logs：
  scdo-agent logs --name 名稱

upgrade-now：
  sudo scdo-agent upgrade-now [--dry-run] [--user] [--passphrase-file 路徑]
      [--config-dir 目錄] [--binary 路徑]

  系統安裝除了 --dry-run 之外需要 root。--dry-run 只檢查簽章後的發布檔。
  install.sh --user 不需要 root 就能替換 ~/.local/bin/scdo-agent，並重啟
  systemctl --user 的單元。發布檔會讀取 files.<處理器> 的 url、sha256、size，
  沒有時改用最外層欄位。簽章仍是 Ed25519，對象是拿掉 signature 之後的規範 JSON。
  健康檢查失敗時會還原先前的執行檔。金鑰會複製進備份，不會被刪除。

使用者安裝（不需要 root）：
  sh install.sh --user
  執行檔在 ~/.local/bin/scdo-agent，資料在 ~/.local/share/scdo-agent。
  systemctl --user enable --now scdo-agent@名稱.service
  登出後若要繼續執行，請跑 loginctl enable-linger $USER。
  已經在系統單元裡啟用的名稱不會再啟動第二次。

wallet：
  scdo-agent wallet create --bot 編號 [--name 名稱] [--email 信箱]
      [--passphrase-file 路徑] [--ledger URL]
  scdo-agent wallet show --bot 編號
  scdo-agent wallet limit --bot 編號 [--per-payment USDC] [--daily USDC]
      [--allow-domain 網域] [--allow-payto 0x地址]
  scdo-agent wallet freeze --bot 編號
  scdo-agent wallet unfreeze --bot 編號
  scdo-agent wallet export --bot 編號 [--out 檔案]
      [--export-passphrase-file 路徑] [--raw --i-understand-raw-key]
  scdo-agent wallet bind-email --bot 編號 [--email 信箱]
  scdo-agent wallet confirm-email --bot 編號 --code 123456
  scdo-agent wallet bind-x --bot 編號
  scdo-agent pay 網址 --bot 編號 [--max USDC] [--dry-run]
  scdo-agent serve-paywall --bot 編號 --price USDC [--path /answer] [--port 8410]

  未加 --name 時，--bot 就是代理名稱。電子郵件只存成加鹽的承諾。鹽留在代理目錄，
  只在 /bind/email/start 送出，不會印出。
  付款使用開源的 x402 SDK。只啟用 Base Sepolia 的 USDC。
  簽章前會先檢查限額。政策拒絕時結束代碼為 3。
  收款地址或網域清單是空的時候，允許任何 Base Sepolia 收款地址或主機。
  serve-paywall 使用 https://x402.org/facilitator，並把每筆已結算的付款送到 /ledger/income。
  export 寫出加密的 Web3 金鑰庫。原始金鑰只在終端機上印出，而且必須加上
  --raw 與 --i-understand-raw-key。
  金鑰只存在你的機器上，SCDO 不保管。

erc8004：
  scdo-agent erc8004 register --name 名稱 [--rpc URL] [--passphrase-file 路徑]

  在 Shard0（eip155:5680）登記帳本地址。手續費使用原生 SCDO。金鑰不會印出。
  這個地址若已經有身份，就不會再送出交易。
  除非 /etc/scdo-agent/config.toml 寫了 erc8004 = true，否則啟動時不會自動登記。

資料目錄：/var/lib/scdo-agent/<名稱>/
每台代理一個 systemd 實例：scdo-agent@<名稱>.service。
`,
	"ready":              "代理 %s 已就緒。",
	"address":            "地址：%s",
	"payout":             "收款地址：%s",
	"role":               "角色：%s",
	"data":               "資料：%s",
	"next":               "下一步：",
	"nextEnable":         "  sudo systemctl enable --now scdo-agent@%s.service",
	"nextStatus":         "  scdo-agent status --name %s",
	"exists":             "代理 %s 已經存在。原有金鑰保持不變。",
	"notInit":            "代理 %s 尚未初始化。請先執行 init。",
	"running":            "代理 %s 已在執行。",
	"noAgents":           "沒有代理。",
	"listHead":           "代理：",
	"logsHint":           "服務紀錄：journalctl -u scdo-agent@%s.service -f",
	"logsOut":            "前景執行時，同樣的內容寫到標準輸出。",
	"online":             "在線：%s",
	"ledger":             "帳本：%s",
	"code":               "代碼：%s",
	"unreachable":        "無法連上帳本。",
	"notReg":             "此代理在帳本上還沒有紀錄。",
	"version":            "scdo-agent %s",
	"roleLight":          "記帳節點",
	"roleServer":         "伺服器節點",
	"langName":           "華語",
	"usage":              "執行 scdo-agent help 查看用法。",
	"badPayout":          "必須提供收款地址：--payout 0x...",
	"needName":           "必須提供名稱：--name <名稱>",
	"passFile":           "請設定 --passphrase-file 或 SCDO_AGENT_PASSPHRASE_FILE 以解開金鑰。",
	"about":              "x402 付款使用 https://github.com/coinbase/x402（Apache-2.0，Copyright 2026 x402 Foundation）。",
	"needBot":            "必須提供機器人編號：--bot <編號>",
	"needURL":            "必須提供網址。",
	"needPrice":          "必須提供價格：--price 0.01",
	"needLimit":          "請設定 --per-payment、--daily、--allow-domain 或 --allow-payto。",
	"needExportPass":     "請用 --export-passphrase-file 加密金鑰庫。",
	"walletEmail":        "電子郵件承諾：%s",
	"walletBotLine":      "機器人：%s",
	"walletPer":          "單筆：%s USDC",
	"walletDaily":        "每日：%s USDC",
	"walletSpent":        "近 24 小時已付：%s USDC",
	"walletPayees":       "收款地址：%s",
	"walletDomains":      "網域：%s",
	"walletAnyPayee":     "收款地址：任何 Base Sepolia 地址",
	"walletAnyDomain":    "網域：任何主機",
	"walletKillOn":       "停止開關：開",
	"walletKillOff":      "停止開關：關",
	"walletKeys":         "金鑰只存在你的機器上，SCDO 不保管。",
	"limitBlocked":       "已停止付款：超過今日限額",
	"payDry":             "將支付 %s 最小單位給 %s。",
	"paywallReady":       "%s 的收款牆，價格 %s USDC，路徑 %s，連接埠 %d。facilitator：https://x402.org/facilitator",
	"exportWrote":        "金鑰庫：%s",
	"connectBots":        "Grok / AI 機器人：每個機器人一個錢包、一本帳",
	"connectX":           "帳本開放後，用 wallet bind-x 綁定 X 帳號。",
	"emailNoSender":      "帳本已接受這個電子郵件，但還沒有寄信程式（delivery: todo_no_sender）。驗證碼尚未寄出。",
	"emailStarted":       "電子郵件驗證已開始。",
	"emailVerified":      "帳本已把這個電子郵件標成已驗證。",
	"emailTries":         "驗證碼未被接受（第 %d 次，最多 5 次）。",
	"emailStopped":       "電子郵件確認已在 5 次嘗試後停止。",
	"needCode":           "必須提供 6 位驗證碼：--code 123456",
	"xNotEnabled":        "X binding not yet enabled on the ledger",
	"xURL":               "開啟這個網址以綁定 X 帳號：%s",
	"walletReady":        "錢包 %s 已綁定到機器人 %s。",
	"walletNetwork":      "網路：%s",
	"walletLedger":       "帳本：%s",
	"walletBot":          "機器人錢包：%s",
	"walletTx":           "交易：https://sepolia.basescan.org/tx/%s",
	"walletKilled":       "付款已停止，帳本紀錄已凍結。",
	"walletUnkilled":     "付款已恢復，帳本紀錄已解除凍結。",
	"erc8004ID":          "代理編號：%s",
	"erc8004URI":         "登記檔：%s",
	"erc8004Tx":          "交易：%s",
	"erc8004Ready":       "ERC-8004 身份 %s 已登記。",
	"erc8004Already":     "ERC-8004 身份 %s 已經登記。",
	"needRoot":           "系統安裝的 upgrade-now 需要 root。若已用 install.sh --user，請加 --user。若只要檢查發布檔、不替換執行檔，請加 --dry-run。",
	"otherMode":          "代理 %s 已在另一種安裝模式中啟用，因此沒有啟動。",
	"nextEnableUser":     "  systemctl --user enable --now scdo-agent@%s.service",
	"logsHintUser":       "服務紀錄：journalctl --user -u scdo-agent@%s.service -f",
	"upgradeBusy":        "已有一個更新正在執行。",
	"upgradeUnreachable": "無法連上發布檔。已安裝的執行檔保持不變。",
	"upgradeCurrent":     "已安裝的 %s 已是最新。",
	"upgradeWould":       "將會安裝 %s（目前為 %s）。",
	"upgradeArch":        "發布檔適用於 %s；這台機器的處理器是 %s。",
	"upgradeOk":          "已更新 %s -> %s。",
	"upgradeNone":        "沒有較新的版本。",
	"upgradeRolled":      "健康檢查失敗。先前的執行檔已還原。",
	"upgradeReconcile":   "核對：%s",
}
