# 3.1.0 menu and site map

The window menu, the in-app function bar, and AI小貓 read one list: `src/js/siteNavMap.js`.
Names and order follow the scdoscan.io home navigation. A function the wallet can do opens that screen. Anything else opens the same page on scdoscan.io. Each function appears once.

The wallet does not write 「主鏈」. Shard0 is Shard0 EVM. Shard1–Shard4 are ShardN Classic.

| Site item | Opens |
| --- | --- |
| 首頁 | Wallet home |
| GPU 共享 | https://scdoscan.io/gpu-share/?ref=nav |
| 錢包 | Folder for wallet-only screens (not a second home) |
| 收款 | Receive |
| 匯款 | Send |
| 設定 | Settings |
| 建立新地址 | Create address |
| 匯入錢包 | Import |
| 遊戲 | https://scdoscan.io/games/ |
| 區塊鏈 | Folder |
| 區塊 | https://scdoscan.io/#/blocks |
| 交易 | https://scdoscan.io/#/txs |
| 代幣 | https://scdoscan.io/#/tokens |
| Gas 追蹤 | https://scdoscan.io/gastracker |
| 運算服務 | Mining screen (processor on the left, graphics card on the right) |
| 算力中心 | https://scdoscan.io/pool/ |
| 算力服務分支 | Mining settings when this wallet runs a node |
| 產品 / 代幣發行 / 企業服務 / 會員 | Matching scdoscan.io pages |
| 開發者 / API / 驗證並發布 | Matching scdoscan.io pages |
| 資源 / 新手入門 / 部落格 / 論文 / 我的 IP / 漏洞賞金 / 智慧體賬本 | Matching scdoscan.io pages |
| 關於 / 團隊 / 路線圖 / 合作夥伴 / 透明中心 / 合規 / 投資者關係 | Matching scdoscan.io pages |

AI小貓 suggestions are this same list, collapsed under a disclosure. Choosing one opens the screen or the browser. The cat still answers from local rules only. It does not call a paid model.

Pool addresses stay in `src/miner/zpow/pools.js` (82.223.19.88, stratum 3341–3344, stats 8341–8344). A user override still belongs under 進階, and `SCDO_ZPOW_POOLS` still replaces a host or port. Online or offline comes from `/api/stats` (`dry_run === false` and `chain_height` present), never from a fixed flag.
