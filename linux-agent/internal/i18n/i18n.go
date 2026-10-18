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
  wallet    Create a bot wallet, pay on Base Sepolia, or stop payments
  version   Print the version
  help      Show this help

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
  sudo scdo-agent upgrade-now [--dry-run] [--passphrase-file PATH]
      [--config-dir DIR] [--binary PATH]

  Root is required except for --dry-run, which only checks the signed feed.
  A failed health check restores the previous binary. Key files are copied
  into the backup and are not deleted.

wallet:
  scdo-agent wallet create --name NAME --bot ID [--max ATOMIC] [--daily ATOMIC]
      [--payee 0xADDR] [--passphrase-file PATH] [--ledger URL]
  scdo-agent wallet pay --name NAME URL [--ledger URL] [--passphrase-file PATH]
  scdo-agent wallet export --name NAME
  scdo-agent wallet allow --name NAME --payee 0xADDR
  scdo-agent wallet kill --name NAME
  scdo-agent wallet unkill --name NAME
  scdo-agent wallet record --name NAME

  Payments use the open-source x402 SDK. Only Base Sepolia USDC is enabled.
  --max is the per-payment cap and --daily is the daily cap, in atomic units
  (6 decimals). An empty payee list allows any Base Sepolia payee. kill stops
  signing and freezes the ledger record.

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
	"walletReady":        "Wallet %s is bound for bot %s.",
	"walletNetwork":      "Network: %s",
	"walletLedger":       "Ledger: %s",
	"walletBot":          "Bot wallet: %s",
	"walletTx":           "Transaction: https://sepolia.basescan.org/tx/%s",
	"walletKilled":       "Payments are stopped and the ledger record is frozen.",
	"walletUnkilled":     "Payments are allowed and the ledger record is unfrozen.",
	"needRoot":           "upgrade-now needs root. Use --dry-run to check the feed without replacing the binary.",
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
  wallet    建立機器人錢包、在 Base Sepolia 付款，或停止付款
  version   顯示版本
  help      顯示這份說明

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
  sudo scdo-agent upgrade-now [--dry-run] [--passphrase-file 路徑]
      [--config-dir 目錄] [--binary 路徑]

  除了 --dry-run 之外需要 root。--dry-run 只檢查簽章後的發布檔。
  健康檢查失敗時會還原先前的執行檔。金鑰會複製進備份，不會被刪除。

wallet：
  scdo-agent wallet create --name 名稱 --bot 編號 [--max 最小單位] [--daily 最小單位]
      [--payee 0x地址] [--passphrase-file 路徑] [--ledger URL]
  scdo-agent wallet pay --name 名稱 URL [--ledger URL] [--passphrase-file 路徑]
  scdo-agent wallet export --name 名稱
  scdo-agent wallet allow --name 名稱 --payee 0x地址
  scdo-agent wallet kill --name 名稱
  scdo-agent wallet unkill --name 名稱
  scdo-agent wallet record --name 名稱

  付款使用開源的 x402 SDK。只啟用 Base Sepolia 的 USDC。
  --max 是單筆上限，--daily 是每日上限，單位是最小單位（6 位小數）。
  收款清單是空的時候，允許任何 Base Sepolia 收款地址。kill 會停止簽章並凍結帳本紀錄。

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
	"walletReady":        "錢包 %s 已綁定到機器人 %s。",
	"walletNetwork":      "網路：%s",
	"walletLedger":       "帳本：%s",
	"walletBot":          "機器人錢包：%s",
	"walletTx":           "交易：https://sepolia.basescan.org/tx/%s",
	"walletKilled":       "付款已停止，帳本紀錄已凍結。",
	"walletUnkilled":     "付款已恢復，帳本紀錄已解除凍結。",
	"needRoot":           "upgrade-now 需要 root。若只要檢查發布檔、不替換執行檔，請加 --dry-run。",
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
