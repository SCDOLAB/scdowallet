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

The Windows `extraResources` copy the whole `miner-bin/win32` folder into `miner/bin`, the same path Shard0 already uses. `zminer.exe` is not copied here by hand. `npm run dist:win` stages it from `scripts/build-zminer.sh` or from the `zminer-windows-amd64` artifact, and stops if the SHA256 is not the line in `miner-zpow/SHA256SUMS` (`f00ab73a384251a4b505bb41406975509299403057f60c6d807ff00b249a65fb`).

These Classic GPU files are still placed before a Windows build (they are not stored in git):

    miner-bin/win32/classic/node.exe
    miner-bin/win32/classic/libcudart.dll

`zminer.exe` is the CPU pool miner. Shard 1 is `82.223.19.88:3341`. Shards 2–4 use `3342–3344` and are not live yet.

`node.exe` is the Classic GPU miner. Link `libgoGpuDet.a` into it and ship `libcudart.dll` beside it. Do not also ship `goGpuDet.dll`: the node does not load that name, and a byte-identical copy of `libcudart.dll` is not a second library. `scripts/build-classic-node.sh` explains the CUDA build. Set `SCDO_CLASSIC_NODE` if the exe lives somewhere else. A different GPU binary can be plugged in with `SCDO_ZPOW_GPU_BIN` and `SCDO_ZPOW_GPU_ARGS`.
