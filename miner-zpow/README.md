# Classic miners (shards 1–4)

Shard0 stays on Ethash (local geth, scdo-stratum, Rigel). Shards 1–4 have two miners, and Shard0 GPU, Classic GPU, and Classic CPU may all run at the same time. The mining page has a short note that two GPU miners on one card may each keep about a third of the hashrate and the driver may reset (TDR). The wallet does not block that and does not ask for confirmation.

## CPU — zminer (pool)

`zpool/cmd/zminer` is the CPU miner. It speaks the pool's stratum protocol and prints a JSON status line:

```json
{"type":"status","hashrate":12.5,"accepted":3,"rejected":1,"connected":true,"blocks":0,"uptime_sec":15}
```

It exits on SIGINT, SIGTERM, stdin EOF, or a `stop` line. The wallet launches it with `windowsHide` (`CREATE_NO_WINDOW`) and a stdin pipe, and checks SHA256 before start. A saved CPU choice resumes as CPU.

```bash
bash scripts/build-zminer.sh
```

That needs network once (Go 1.12.7 and a shallow clone of SCDOLAB/go-scdo). Output:

- `miner-zpow/dist/zminer.exe`
- `miner-zpow/dist/zminer-linux-amd64`
- `miner-zpow/SHA256SUMS`

`scripts/build-zminer.sh` pins Go 1.12.7, go-scdo commit `7ad1df0778abad2e735b7bd4602d2acd8b641838`, and fixed `GOROOT` / `GOPATH` / output paths, so the hashes do not change between machines. The script exits if the binaries do not match `miner-zpow/SHA256SUMS`.

Published hashes:

- `zminer.exe` `f00ab73a384251a4b505bb41406975509299403057f60c6d807ff00b249a65fb`
- `zminer-linux-amd64` `121bf07195076d9fbf7234196169b6bc15b8dcc1002a462b05b482ddb6f187d8`

The `zminer` GitHub Actions workflow uploads artifact `zminer-windows-amd64` (`zminer.exe` and `SHA256SUMS`). `npm run dist:win` runs `scripts/stage-zminer.js` before electron-builder, and `beforePack` runs it again. That step builds this script, or downloads `ZMINER_URL` / that artifact, and copies the exe into `miner-bin/win32` only after the hash matches. A different file left in that git-ignored directory is not packed. Override a running wallet with `SCDO_ZMINER_EXE` and, if the sums file is not beside it, `SCDO_ZMINER_SHA256`.

Default pools (override with `SCDO_ZPOW_POOLS`, a JSON object keyed by shard):

| Shard | Stratum | HTTP stats |
| --- | --- | --- |
| 1 (live) | 82.223.19.88:3341 | 8341 `/api/miner/<address>` |
| 2–4 (not live yet) | same host, 3342–3344 | 8342–8344 |

## GPU — Classic node

The GPU miner is the go-scdo node (`node.exe` with `libcudart.dll` next to it), packed like Shard0 under `miner-bin/win32/classic/`. `libgoGpuDet.a` is linked into `node.exe`. The node does not load `goGpuDet.dll`; that name is not a second runtime library. One node per shard. The wallet writes `nodeN.json` under its own data directory, sets `basic.coinbase` to the user's Classic address, and generates a new P2P key there. It does not read `~/.scdo` or any other node key on the machine.

The graphics-card miner is the go-scdo node. When the local chain is synced it mines with the command below, and the row says the graphics card is mining. When the chain is behind, the same process syncs in the background and the row waits. It is not pool mining. The processor pool command is in [doc/mining-modes.md](../doc/mining-modes.md).

```text
node.exe start -c nodeN.json -m start --threads 1 --threadblocks 100 --blockthreads 100
```

`-m stop` would disable mining. The node does not print a hashrate. The wallet counts `found a new mined block` and estimates blocks per hour. `got download start event, stop miner` is shown as a sync pause.

`scripts/build-classic-node.sh` does not produce `node.exe` unless you build on Windows with the CUDA toolkit (see the script's message). Until that binary is installed, the GPU choice stays disabled and the CPU pool choice remains available.

Place the files in `miner-bin/win32/classic/` or set `SCDO_CLASSIC_NODE` (and `SCDO_CUDART_DIR` if the DLL is not beside the exe). If `SHA256SUMS` or `SCDO_CLASSIC_NODE_SHA256` is present, the hash is checked. If neither is present, the node still starts and the log says the hash was not checked.

## Another GPU binary

Set `SCDO_ZPOW_GPU_BIN` to an exe and `SCDO_ZPOW_GPU_ARGS` to a JSON array of arguments. Placeholders: `{pool}`, `{user}`, `{threads}`, `{worker}`, `{shard}`. Optional `SCDO_ZPOW_GPU_SHA256`. The mining page shows **Custom GPU miner** when that exe exists. `{pool}` for shard 1 is `82.223.19.88:3341`.
