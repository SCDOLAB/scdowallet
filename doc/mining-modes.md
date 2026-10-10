# Mining command lines

The wallet only launches binaries that the Windows pack places under `miner/bin` (from `miner-bin/win32`) and `miners/zminer-gpu` (from `resources/miners/zminer-gpu`). `scripts/before-pack-win.js` stops the Windows build if any of them is missing.

## Shard1–Shard4 Classic, graphics card, pool (default)

The default is `zminer-gpu` 0.1.3. The Windows pack downloads

`https://scdoscan.io/downloads/gpu-miner/zminer-gpu-0.1.3-win64.zip`

and refuses the build unless the zip sha256 is `6efc25597620e145a6de53aa3c8105d861a7ea44a5f419c7d6bb7a1b5a463a96`. It unpacks `zminer-gpu.exe`, `zpowdet.dll` and `cudart64_12.dll` into the same folder, `resources/miners/zminer-gpu/`. The program is Windows + NVIDIA only and needs a CUDA 12 driver (570 or newer). Shares are checked on the processor before they are sent. A 5060 Ti is about 175–210 kH/s.

Start runs one process per selected Shard1–Shard4 Classic chain. Every process uses device 0, so the speed is split across them. The local node does not have to be synced. The row says 「顯卡經礦池挖」. `N` is the shard, 1–4, and `-user` is that shard's Classic address.

```text
zminer-gpu.exe -pool 82.223.19.88:3341 -user 1S01… -worker %COMPUTERNAME% -device 0 -batch 8192
```

Shard2–Shard4 use ports `3342`, `3343` and `3344` and a `2S02…`, `3S03…` or `4S04…` address.

Every 15 seconds the program prints a line like `hashrate 248000 H/s | batch 8192 | … | accepted 12 rejected 0 …`. The row shows that speed only after the first accepted share. Until then the speed is 「—」.

If this computer has no NVIDIA graphics card, the driver is too old, or the program reports `CUDA driver version is insufficient`, `no CUDA device`, or a missing `zpowdet.dll`, the row shows 「這台電腦沒有可用的 NVIDIA 顯卡，已改用 CPU 經礦池挖」 and a 「改用 CPU」 button. The processor miner starts only when that button is pressed.

Stop, and quitting the wallet, closes every `zminer-gpu` process. Keep-mining still decides whether the next launch starts them again.

## Shard1–Shard4 Classic, graphics card, solo

Solo runs only when 進階 has saved solo and that shard's node is already synced (within 8 blocks). The program is `miner-bin/win32/classic/node.exe`, with `libcudart*.dll` beside it. It mines its own local chain. The row says 「顯卡挖礦中」.

```text
node.exe start -c nodeN.json -m start --threads 1 --threadblocks 100 --blockthreads 100
```

The wallet writes `nodeN.json` under its own data directory (`classic/shardN/nodeN.json`). The payout address is `basic.coinbase`. Defaults are `--threads 1`, `--threadblocks 100`, `--blockthreads 100`.

If solo is saved and the node is not synced, Start runs the same command so the node can catch up. The row is the amber line 「等待同步（Shard1 52%），同步完成後顯卡自動開始」. It has 「先用 CPU 經礦池挖」, which starts the processor miner on that shard's pool. Solo still starts only one of Shard1–Shard4 Classic at a time. Pool mode does not have that limit.

This node does not print a hashrate, so a solo row keeps a dash for speed. A syncing node shows neither a speed nor earnings.

## Shard1–Shard4 Classic, processor

The processor miner is `zminer.exe`. It speaks stratum. The row says 「經礦池挖」. Speed and earnings appear only after it is connected and reporting a speed. The processor still starts one Classic chain at a time.

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

On a Windows pack, `scripts/before-pack-win.js` fails the build when any of these is absent:

- `miner-bin/win32/zminer.exe`
- `miner-bin/win32/geth.exe`
- `miner-bin/win32/scdo-stratum.exe`
- `miner-bin/win32/classic/node.exe`
- `miner-bin/win32/classic/libcudart.dll` (the name may be `libcudart*.dll`)
- `resources/miners/zminer-gpu/zminer-gpu.exe`
- `resources/miners/zminer-gpu/zpowdet.dll`
- `resources/miners/zminer-gpu/cudart64_12.dll`
