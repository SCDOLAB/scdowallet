# miner-bin

The build (electron-builder `extraResources`) expects these files, which are **not stored in git** because of their
size (about 19-57 MB each):

    miner-bin/linux/geth
    miner-bin/linux/scdo-stratum
    miner-bin/win32/geth.exe
    miner-bin/win32/scdo-stratum.exe

- `geth` / `geth.exe`: SCDO Shard0 (EVM) node, core-geth v1.12.23 fork, source https://github.com/SCDOLAB/scdo-shard0 (branch `scdo`).
- `scdo-stratum` / `scdo-stratum.exe`: stratum proxy from the same repository.

Put the files in place before building and check them against `SHA256SUMS` in this folder
(`sha256sum -c SHA256SUMS`). The released Windows installer contains exactly these files.
`scdo-shard0-genesis.json` stays in git.
