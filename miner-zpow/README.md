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

Published hashes in `miner-zpow/SHA256SUMS`:

- `zminer.exe` `39a161d5e7620c302994ae36b0cd0ba04e4acfc26b4844d86c88988bbb7adc32`
- `zminer-linux-amd64` `59679cd5e421be4c2194cdc851c869368847b3c55cd85dfa64b41983d5d3cbaf`

Copy `zminer.exe` and `SHA256SUMS` to `miner-bin/win32/` before `npm run dist:win`. The Windows extraResources copy that folder the same way as `geth.exe`. Override the path with `SCDO_ZMINER_EXE` and, if the sums file is not beside it, `SCDO_ZMINER_SHA256`.

Default pools (override with `SCDO_ZPOW_POOLS`, a JSON object keyed by shard):

| Shard | Stratum | HTTP stats |
| --- | --- | --- |
| 1 (live) | 82.223.19.88:3341 | 8341 `/api/miner/<address>` |
| 2–4 (not live yet) | same host, 3342–3344 | 8342–8344 |

## GPU — Classic node

The GPU miner is the go-scdo node (`node.exe`, CUDA `goGpuDet`, `libcudart.dll` next to the exe), packed like Shard0 under `miner-bin/win32/classic/`. One node per shard. The wallet writes `nodeN.json` under its own data directory, sets `basic.coinbase` to the user's Classic address, and generates a new P2P key there. It does not read `~/.scdo` or any other node key on the machine.

```text
node.exe start -c nodeN.json -m start --threads 1 --threadblocks 100 --blockthreads 100
```

`-m stop` would disable mining. The node does not print a hashrate. The wallet counts `found a new mined block` and estimates blocks per hour. `got download start event, stop miner` is shown as a sync pause.

`scripts/build-classic-node.sh` does not produce `node.exe` unless you build on Windows with the CUDA toolkit (see the script's message). Until that binary is installed, the GPU choice stays disabled and the CPU pool choice remains available.

Place the files in `miner-bin/win32/classic/` or set `SCDO_CLASSIC_NODE` (and `SCDO_CUDART_DIR` if the DLL is not beside the exe). If `SHA256SUMS` or `SCDO_CLASSIC_NODE_SHA256` is present, the hash is checked. If neither is present, the node still starts and the log says the hash was not checked.

## Another GPU binary

Set `SCDO_ZPOW_GPU_BIN` to an exe and `SCDO_ZPOW_GPU_ARGS` to a JSON array of arguments. Placeholders: `{pool}`, `{user}`, `{threads}`, `{worker}`, `{shard}`. Optional `SCDO_ZPOW_GPU_SHA256`. The mining page shows **Custom GPU miner** when that exe exists. `{pool}` for shard 1 is `82.223.19.88:3341`.
