# ScdoWalletBeta 1.1.2 (2026-09-29)

UI redesign modelled on mainstream wallets (MetaMask, Trust Wallet, OKX Wallet, Rabby, Exodus):

- Header: account switcher dropdown (full name + full 0x address + copy + QR), network selector
  (new chain shard0 / old chain shards 1-4), 中文 / English switch (persists), settings gear.
- Tabs: 首页 / 新链 shard0 账户 / 老链账户 / 挖矿.
- Home: big shard0 balance, Receive / Send action row, Assets + Activity tabs, old-chain total in a small box.
- Receive: QR + full address + copy. Send: stepped flow (address -> amount with Max + fee preview -> review + password -> status).
- Accounts: reversible hide with "显示已隐藏账户（N）"; delete needs keyfile password + "我已了解" + final confirm,
  and the keyfile is first copied to Documents\ScdoWallet\备份\<date>\ and verified (SHA-256) before removal.
- Settings: language, hidden accounts, create / import, keyfile backup, backup folder, RPC list, about.
- Mining: NVIDIA detection; no GPU -> clear message + "只运行节点" (node-only); Rigel/CUDA never started without NVIDIA;
  CUDA/no-device errors stop instead of looping; honest status texts; CPU mining hidden; logs / Defender under "高级";
  detects an SCDO node already running on the PC and monitors it instead of clashing on ports; free-port fallback.
- Stop: graceful Ctrl+C / SIGINT to geth (up to 60 s) before any force kill; also on app quit.
- Old 1.1.1 UI kept as legacy-1.1.1-index.html in the source (not packaged); contract deploy/call UI not exposed in 1.1.2.
