# ScdoWallet

[![Telegram](https://img.shields.io/badge/Telegram-@SCDOLabor-26A5E4?logo=telegram&logoColor=white)](https://t.me/SCDOLabor)

![icon](build/icon.ico)

## Next: SCDO Wallet 3.1.5

Source version in this tree is 3.1.5 (16 October 2026). The Windows installer is published to the download page after this build is packed. Release notes: [doc/release-notes/3.1.5.md](doc/release-notes/3.1.5.md).

- Shard0 graphics-card mining uses the Melbourne pool `139.84.196.31:3333`, and the node starts from the Melbourne bootnode.
- Shard1–Shard4 keep `<pool-host>` until a remote config document overrides them.
- Public RPC defaults to `https://apeccapital.org/rpc/N` and falls back to `https://scdoscan.io/rpc/N`.
- The AI agent ledger posts to apeccapital.org, falls back to scdoscan.io, and reports payout, health and crashes.

## Latest published installer: SCDO Wallet 3.1.4 for Windows (13 October 2026)

Desktop wallet for SCDO, with a built-in node and mining on Windows. Built by SCDO Laboratory.

- **Download:** https://scdoscan.io/downloads/wallet/ (mirrors: https://apeccapital.org/downloads/wallet/, https://scdo.com.au/downloads/wallet/)
- **Windows installer:** [`SCDOWallet-3.1.4-win-x64-setup.exe`](https://scdoscan.io/downloads/wallet/SCDOWallet-3.1.4-win-x64-setup.exe), 164,601,522 bytes, SHA256 `a3b63c478bfca55e0c2b85c41fe659f2bb706e8e854f163a50e3b7f9c53c305e` (also in `SHA256SUMS`). Installed wallets get it through the signed built-in updater.
- **Source:** `master` at `ad6b40e`. Release notes: [doc/release-notes/3.1.4.md](doc/release-notes/3.1.4.md)

What's new in 3.1.4:
- Mining retries automatically after the guard gives up on a miner, after a cool-down.
- With *Keep mining* on, the chains that were mining resume when the wallet is reopened after a close, kill or crash.
- AI Agent Ledger: each rig signs its own heartbeats and self-heal events with its own key; public at https://scdoscan.io/agent-ledger/
- Heat guard: 85-94°C is a warning only; mining stops only at 95°C or above.
- CPU *This session* earnings no longer reset to 0 after a restart; only Stop resets them.

Networks in the wallet:

- **SCDO Shard0 (EVM)**, Chain ID 5680 (0x1630), RPC `https://scdoscan.io/rpc/0`, explorer https://scdoscan.io
- **SCDO Shard1 (Classic)**, **SCDO Shard2 (Classic)**, **SCDO Shard3 (Classic)** and **SCDO Shard4 (Classic)**, shown together under "Classic accounts"

The installer is not code-signed yet; Windows SmartScreen may ask for confirmation. Keyfiles stay in `~/.ScdoWallet/account/` on your PC.

### Build from source (branch `upgrade-2026-09`)

```bash
git clone -b upgrade-2026-09 https://github.com/SCDOLAB/scdowallet.git
cd scdowallet
npm install
npm start          # run
npm test           # tests
npm run dist:win   # Windows installer
```

The node and stratum proxy binaries are not stored in git; see [miner-bin/README.md](https://github.com/SCDOLAB/scdowallet/blob/upgrade-2026-09/miner-bin/README.md).

## Earlier ScdoWallet (2023)

The code on `master` is the earlier ScdoWallet (last updated 2023) for the Classic accounts (SCDO Shard1 (Classic), SCDO Shard2 (Classic), SCDO Shard3 (Classic), SCDO Shard4 (Classic)): create or import accounts, transfers and contracts. It is kept for reference; use SCDO Wallet 3.1.4 above.

Data folder: `~/.ScdoWallet/` (`account/`, `node/`, `rc/`, `tx/`, `lang.json`, `viewconfig.json`).

## License

[CC0 1.0 (Public Domain)](md/LICENSE.md)
