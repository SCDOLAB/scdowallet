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

## Classic shards 1–4

The Windows `extraResources` copy the whole `miner-bin/win32` folder into `miner/bin`, the same path Shard0 already uses. Drop these files here (they are not stored in git):

    miner-bin/win32/zminer.exe
    miner-bin/win32/SHA256SUMS          # must list zminer.exe; the wallet refuses to start it without a match
    miner-bin/win32/classic/node.exe    # go-scdo CUDA node
    miner-bin/win32/classic/libcudart.dll

`zminer.exe` is the CPU pool miner. Shard 1 is `82.223.19.88:3341`. Shards 2–4 use `3342–3344` and are not live yet. The published `zminer.exe` hash in `miner-zpow/SHA256SUMS` is `39a161d5e7620c302994ae36b0cd0ba04e4acfc26b4844d86c88988bbb7adc32`.

`node.exe` is the Classic GPU miner. `scripts/build-zminer.sh` builds `zminer.exe` (Go 1.12.7). `scripts/build-classic-node.sh` explains the CUDA build. Set `SCDO_ZMINER_EXE` or `SCDO_CLASSIC_NODE` if a binary lives somewhere else. A different GPU binary can be plugged in with `SCDO_ZPOW_GPU_BIN` and `SCDO_ZPOW_GPU_ARGS`.
