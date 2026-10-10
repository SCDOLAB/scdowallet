# Mining command lines

The wallet only launches binaries that the Windows pack places under `miner/bin` (from `miner-bin/win32`). `scripts/before-pack-win.js` stops the Windows build if any of them is missing.

## Shard1–Shard4 Classic, graphics card

3.0.10 and 3.1.0 use the same program. It is the go-scdo node with the CUDA zpow engine, `miner-bin/win32/classic/node.exe`, with `libcudart.dll` (any `libcudart*.dll`) beside it. This is the program that mined on the RTX 4060.

Solo, and the 3.1.0 path that starts as soon as that shard's pool is up, both run:

```text
node.exe start -c nodeN.json -m start --threads 1 --threadblocks 100 --blockthreads 100
```

`N` is the shard, 1–4. The wallet writes `nodeN.json` under its own data directory (`classic/shardN/nodeN.json`). The selected payout address is `basic.coinbase` in that file (`1S01…` on Shard1, `2S02…` on Shard2, `3S03…` on Shard3, `4S04…` on Shard4). Defaults are `--threads 1`, `--threadblocks 100`, `--blockthreads 100`.

`node.exe` cannot be pointed at `82.223.19.88:3341`–`3344`. Its `start` flags are `-c`, `-m start|stop`, `--threads`, `--threadblocks`, `--blockthreads`, and a boolean `--pool` that only rotates a local coinbase list from `--poolaccounts`. That boolean does not open a stratum connection. The packed `scdo-stratum.exe` is the Shard0 Ethash proxy (`-rpc` to local geth, `-listen` on a local port). It does not speak Classic zpow and is not started in front of `82.223.19.88`.

So a graphics-card start, including while the local node is still syncing, is the command above. The node syncs, then mines to the coinbase. The row says 「本機顯卡挖（本機節點同步 …%）」 while that sync percent is known and the node is not caught up.

## Shard1–Shard4 Classic, processor

The processor miner is `zminer.exe`. It does speak stratum. Shard ports are 3341, 3342, 3343, 3344. The payout address is `-user`.

```text
zminer.exe -pool 82.223.19.88:3341 -user 1S01… -worker wallet -threads 4
```

Replace the port and the address for Shard2–Shard4 (`3342` / `2S02…`, `3343` / `3S03…`, `3344` / `4S04…`).

## Shard0 EVM, graphics card

Solo is three packed programs. `geth.exe` mines to `--miner.etherbase`. `scdo-stratum.exe` exposes local Ethash work. Rigel (downloaded, not in `miner-bin`) connects to that local proxy.

```text
geth.exe --datadir <data> --networkid 5680 --syncmode full --gcmode archive --port <p2p> --bootnodes <bootnode> --http --http.addr 127.0.0.1 --http.port <http> --http.api eth,net,web3,miner --authrpc.addr 127.0.0.1 --authrpc.port <auth> --ipcdisable --miner.etherbase 0x… --miner.gaslimit 30000000 --miner.gasprice 1000000 --txpool.pricelimit 1000000 --ethash.dagdir <data>/ethash-dag --ethash.cachedir <data>/ethash-cache --verbosity 3
scdo-stratum.exe -rpc http://127.0.0.1:<http> -listen 127.0.0.1:<stratum> -autostart -ref-rpc https://scdoscan.io/rpc/0
rigel.exe -a ethash -o ethproxy+tcp://127.0.0.1:<stratum> -u 0x… -w <worker> --api-bind 127.0.0.1:<api> --no-tui --no-colour --log-file <log>
```

Pool mode does not use `scdo-stratum.exe`. Rigel connects to the pool URL directly:

```text
rigel.exe -a ethash -o ethproxy+tcp://82.223.19.88:3333 -u 0x… -w <worker> --api-bind 127.0.0.1:<api> --no-tui --no-colour --log-file <log>
```

## Pack check

On a Windows pack, `scripts/before-pack-win.js` fails the build when any of these is absent from `miner-bin/win32`:

- `zminer.exe`
- `geth.exe`
- `scdo-stratum.exe`
- `classic/node.exe`
- `classic/libcudart.dll` (the name may be `libcudart*.dll`)
