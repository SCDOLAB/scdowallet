# Classic miners (shards 1–4)

Shard0 stays on Ethash (local geth, scdo-stratum, Rigel). Shards 1–4 use zpow and have two backends. Only one mining backend runs at a time. Shard0 GPU and Classic GPU together on the same card cause TDR resets and each side keeps about a third of its hashrate, so the wallet refuses that pair.

## CPU — zminer (pool)

`zpool/cmd/zminer` is the CPU miner. It speaks the pool's stratum protocol and prints a JSON status line:

```json
{"type":"status","hashrate":12.5,"accepted":3,"rejected":1,"connected":true,"blocks":0,"uptime_sec":15}
```

It exits on SIGINT, SIGTERM, stdin EOF, or a `stop` line. The wallet launches it with `windowsHide` (`CREATE_NO_WINDOW`) and a stdin pipe, and checks SHA256 before start.

```bash
bash scripts/build-zminer.sh
```

That needs network once (Go 1.12.7 and a shallow clone of SCDOLAB/go-scdo). Output:

- `miner-zpow/dist/zminer.exe`
- `miner-zpow/dist/zminer-linux-amd64`
- `miner-zpow/dist/SHA256SUMS`

Copy `zminer.exe` and `SHA256SUMS` to `miner-bin/win32/` before `npm run dist:win`. Override the path with `SCDO_ZMINER_EXE` and, if the sums file is not beside it, `SCDO_ZMINER_SHA256`.

Default pools (override with `SCDO_ZPOW_POOLS`, a JSON object keyed by shard):

| Shard | Stratum | HTTP stats |
| --- | --- | --- |
| 1 (live) | 82.223.19.88:3341 | 8341 `/api/miner/<address>` |
| 2–4 (not live yet) | same host, 3342–3344 | 8342–8344 |

## GPU — Classic node (solo)

The GPU miner in production is the go-scdo node (`node.exe`, CUDA `goGpuDet`, `libcudart.dll` next to the exe). One node per shard. The wallet writes `nodeN.json` under its own data directory, sets `basic.coinbase` to the user's Classic address, and generates a new P2P key there. It does not read `~/.scdo` or any other node key on the machine.

```text
node.exe start -c nodeN.json -m start --threads 1 --threadblocks 100 --blockthreads 100
```

`-m stop` would disable mining. The node does not print a hashrate. The wallet counts `found a new mined block` and estimates blocks per hour. `got download start event, stop miner` is shown as a sync pause.

`scripts/build-classic-node.sh` does not produce `node.exe` unless you build on Windows with the CUDA toolkit (see the script's message). Until that binary is installed, the mining page offers CPU only and leaves the GPU choice disabled.

Place the files in `miner-bin/win32/classic/` or set `SCDO_CLASSIC_NODE` (and `SCDO_CUDART_DIR` if the DLL is not beside the exe). If `SHA256SUMS` or `SCDO_CLASSIC_NODE_SHA256` is present, the hash is checked. If neither is present, the node still starts and the log says the hash was not checked.

## Another GPU binary later

Set `SCDO_ZPOW_GPU_BIN` to an exe and `SCDO_ZPOW_GPU_ARGS` to a JSON array of arguments. Placeholders: `{pool}`, `{user}`, `{threads}`, `{worker}`, `{shard}`. Optional `SCDO_ZPOW_GPU_SHA256`. The mining page shows **GPU custom** when that exe exists. Stdout JSON status lines use the same shape as zminer.
