# Classic miners (shards 1–4)

Shard0 stays on Ethash (local geth, scdo-stratum, Rigel). Shards 1–4 use the bundled go-scdo CUDA node, packed like the Shard0 miner under `miner-bin/win32/classic/`. Shard0 GPU and Classic GPU may run at the same time. The mining page has a short note that two GPU miners on one card may each keep about a third of the hashrate and the driver may reset (TDR). The wallet does not block that, and it does not start a CPU miner.

## GPU — Classic node

The GPU miner is the go-scdo node (`node.exe`, CUDA `goGpuDet`, `libcudart.dll` next to the exe). One node per shard. The wallet writes `nodeN.json` under its own data directory, sets `basic.coinbase` to the user's Classic address, and generates a new P2P key there. It does not read `~/.scdo` or any other node key on the machine.

```text
node.exe start -c nodeN.json -m start --threads 1 --threadblocks 100 --blockthreads 100
```

`-m stop` would disable mining. The node does not print a hashrate. The wallet counts `found a new mined block` and estimates blocks per hour. `got download start event, stop miner` is shown as a sync pause.

Shard 1's pool is `82.223.19.88:3341` (HTTP stats `8341` `/api/miner/<address>`). Shards 2–4 use the same host on `3342–3344` / `8342–8344` and are not live yet. Override with `SCDO_ZPOW_POOLS`, a JSON object keyed by shard. The mining page shows that pool. The node process itself is the production command above: rewards go to `basic.coinbase`.

`scripts/build-classic-node.sh` does not produce `node.exe` unless you build on Windows with the CUDA toolkit (see the script's message). Until that binary is installed, the GPU choice on the mining page stays disabled.

Place the files in `miner-bin/win32/classic/` or set `SCDO_CLASSIC_NODE` (and `SCDO_CUDART_DIR` if the DLL is not beside the exe). If `SHA256SUMS` or `SCDO_CLASSIC_NODE_SHA256` is present, the hash is checked. If neither is present, the node still starts and the log says the hash was not checked.

## Another GPU binary

Set `SCDO_ZPOW_GPU_BIN` to an exe and `SCDO_ZPOW_GPU_ARGS` to a JSON array of arguments. Placeholders: `{pool}`, `{user}`, `{threads}`, `{worker}`, `{shard}`. Optional `SCDO_ZPOW_GPU_SHA256`. The mining page shows **Custom GPU miner** when that exe exists. `{pool}` for shard 1 is `82.223.19.88:3341`.
