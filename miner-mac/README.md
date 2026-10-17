# scdo-clminer (macOS)

Ethash miner for SCDO Shard0 on the Apple graphics chip (OpenCL), with a built-in ethproxy pool client.
It is a separate program, licensed GPL-3.0-or-later (see `LICENSE`). SCDO Wallet only starts it and reads its
local API, in the same way the wallet uses rigel on Windows and Linux.

- `ethash.cl` is the OpenCL kernel from ethminer 0.19 (Gateless Gate Sharp, GPL-3).
- CPU verification of every result uses chfast/ethash 0.4.3 (Apache-2.0), downloaded by `build.sh`.
- Build: `./build.sh` (Xcode command line tools and cmake). Output: `scdo-clminer`.
- Pool: `scdo-clminer -a ethash -o ethproxy+tcp://139.84.196.31:3333 -u 0xYOURADDRESS -w mac --api-bind 127.0.0.1:5055`
- Thermal guard: mining pauses while macOS reports the thermal state as serious or critical.
