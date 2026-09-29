# ScdoWallet

![icon](build/icon.ico)

## Latest: ScdoWalletBeta 1.1.4 (September 2026)

Desktop wallet for SCDO, with a built-in node and GPU mining (NVIDIA) on Windows.

- **Download:** [GitHub release v1.1.4](https://github.com/SCDOLAB/scdowallet/releases/tag/v1.1.4) or https://scdoscan.io/downloads/wallet/
- **Windows installer:** `ScdoWalletBeta-1.1.4-win-x64-setup.exe`, SHA256 `6db2074802868537752b422631cb532662664d7ce8e422d59ec5e9428c2ad012`
- **Source:** branch [`upgrade-2026-09`](https://github.com/SCDOLAB/scdowallet/tree/upgrade-2026-09). Changes: [md/CHANGELOG-1.1.4.md](https://github.com/SCDOLAB/scdowallet/blob/upgrade-2026-09/md/CHANGELOG-1.1.4.md)

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

The code on `master` is the earlier ScdoWallet (last updated 2023) for the Classic accounts (SCDO Shard1 (Classic), SCDO Shard2 (Classic), SCDO Shard3 (Classic), SCDO Shard4 (Classic)): create or import accounts, transfers and contracts. It is kept for reference; use ScdoWalletBeta 1.1.4 above.

Data folder: `~/.ScdoWallet/` (`account/`, `node/`, `rc/`, `tx/`, `lang.json`, `viewconfig.json`).

## License

[CC0 1.0 (Public Domain)](md/LICENSE.md)
