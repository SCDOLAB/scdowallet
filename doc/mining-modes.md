# Mining command lines

The wallet only launches binaries that the Windows pack places under `miner/bin` (from `miner-bin/win32`). `scripts/before-pack-win.js` stops the Windows build if any of them is missing.

## Shard1–Shard4 Classic, graphics card

3.0.10 and 3.1.0 use the same program: `miner-bin/win32/classic/node.exe`, with `libcudart.dll` (any `libcudart*.dll`) beside it. This is the program that mined on the RTX 4060. It mines its own local chain. It does not speak stratum.

When that shard's node is already synced (within 8 blocks of the tip), Start runs:

```text
node.exe start -c nodeN.json -m start --threads 1 --threadblocks 100 --blockthreads 100
```

`N` is the shard, 1–4. The wallet writes `nodeN.json` under its own data directory (`classic/shardN/nodeN.json`). The selected payout address is `basic.coinbase`. Defaults are `--threads 1`, `--threadblocks 100`, `--blockthreads 100`. The row says 「顯卡挖礦中」.

When the node is not synced, Start runs the same command so the node can catch up in the background. The node pauses mining while it downloads (`got download start event, stop miner`) and mines on its own once it is caught up. The row is not pool mining. It is the amber line 「等待同步（Shard1 52%），同步完成後顯卡自動開始」 (the shard and percent change). The same row has 「先用 CPU 經礦池挖」, which starts the processor miner below on that shard's pool, paid to the same address.

Speed and earnings stay blank until the miner is producing valid work. This node does not print a hashrate, so the graphics-card speed stays a dash even while 「顯卡挖礦中」. A syncing node shows neither a speed nor earnings.

## Shard1–Shard4 Classic, processor

The processor miner is `zminer.exe`. It speaks stratum. Shard ports are 3341, 3342, 3343, 3344. The payout address is `-user`. The row says 「經礦池挖」. Speed and earnings appear only after it is connected and reporting a speed.

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
