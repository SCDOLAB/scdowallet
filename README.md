# ScdoWallet

[![Telegram](https://img.shields.io/badge/Telegram-@SCDOLabor-26A5E4?logo=telegram&logoColor=white)](https://t.me/SCDOLabor)

![icon](build/icon.ico)

## Latest: ScdoWallet 1.1.6 (October 2026)

Desktop wallet for SCDO, with a built-in node and GPU mining (NVIDIA) on Windows.

- **Download:** https://scdoscan.io/downloads/wallet/ (current release 1.1.6, with SHA256SUMS). The next release is named **SCDO Wallet 2.0**.
- **Windows installer:** `ScdoWalletBeta-1.1.6-win-x64-setup.exe` (file name kept for the built-in updater), SHA256 in https://scdoscan.io/downloads/wallet/ `SHA256SUMS`. 1.1.6 adds signed automatic updates and safe miner stop.
- **Source:** branch [`upgrade-2026-09`](https://github.com/SCDOLAB/scdowallet/tree/upgrade-2026-09). Earlier changes: [md/CHANGELOG-1.1.4.md](https://github.com/SCDOLAB/scdowallet/blob/upgrade-2026-09/md/CHANGELOG-1.1.4.md)

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

The code on `master` is the earlier ScdoWallet (last updated 2023) for the Classic accounts (SCDO Shard1 (Classic), SCDO Shard2 (Classic), SCDO Shard3 (Classic), SCDO Shard4 (Classic)): create or import accounts, transfers and contracts. It is kept for reference; use ScdoWallet 1.1.6 above.

Data folder: `~/.ScdoWallet/` (`account/`, `node/`, `rc/`, `tx/`, `lang.json`, `viewconfig.json`).

## License

[CC0 1.0 (Public Domain)](md/LICENSE.md)
