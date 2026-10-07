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

Classic mining uses the go-scdo CUDA node, packed the same way as Shard0: the Windows `extraResources` copy the whole `miner-bin/win32` folder into `miner/bin`. Drop the files here (they are not stored in git):

    miner-bin/win32/classic/node.exe
    miner-bin/win32/classic/libcudart.dll

Shard 1 points at pool `82.223.19.88:3341` (HTTP stats `8341`). Shards 2–4 use the same host on `3342–3344` / `8342–8344` and are not live yet.

`scripts/build-classic-node.sh` explains the CUDA build. Set `SCDO_CLASSIC_NODE` if the exe lives somewhere else, and `SCDO_CUDART_DIR` if the DLL is not beside it. A different GPU binary can be plugged in with `SCDO_ZPOW_GPU_BIN` and `SCDO_ZPOW_GPU_ARGS` (a JSON argv array; `{pool}` `{user}` `{threads}` `{shard}` are replaced). The wallet does not start a CPU miner.
