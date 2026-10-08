# zminer-gpu (Classic pool, NVIDIA)

`zminer-gpu` is a second miner next to CPU `zminer`. It speaks the same pool protocol (TCP JSON-RPC login / getjob / submit, or HTTP getWork) and submits shares the same way. The 30×30 zpow matrix is filled and factored on the GPU. Go then finishes `exp(sum(log|diag|)) * sign` with the same sum `zp.Det` uses, and every share is checked again with `zp.Check` before it is sent. A share the CPU reference rejects is not submitted.

CPU `zminer` is unchanged. `scripts/build-zminer.sh` and `miner-zpow/SHA256SUMS` still describe only that binary. You can run either miner, or both.

This binary does not link `consensus/zpow/libgoGpuDet.a`. That archive is a Linux ELF static library, its cubin is sm_30 machine code with no PTX, and its host code calls the removed `cudaConfigureCall` / `cudaLaunch` API. It cannot be linked into a Windows exe, and an RTX 5060 Ti (sm_120) cannot run it. Solo GPU mining with `node.exe` is a separate path (`scripts/build-classic-node.sh`). `zminer-gpu` ships its own `zpowdet.dll` / `libzpowdet.so`, compiled by the CUDA toolkit on the machine that will mine.

The GPU result for a header hash must be bit-identical to `zp.Det`. `-check` compares them and exits before any pool traffic. `gpu/cuda_test.go` (`TestDeviceMatchesCPU`) does the same when a library and a GPU are present, and skips otherwise.

## Windows build (RTX 5060 Ti)

Install:

- Go **1.12.7** for windows/amd64: https://dl.google.com/go/go1.12.7.windows-amd64.zip  
  Unzip so `C:\Go112\bin\go.exe` exists. `go version` must print `go1.12.7`. A newer Go cannot link `scdorand`.
- CUDA Toolkit **12.8 or newer** (sm_120). Older toolkits build PTX for an older architecture; a 5060 Ti will fail `-check` or fail to load the module.
- Visual Studio Build Tools with the MSVC x64 toolset (`cl.exe`). nvcc uses it.
- Git for Windows.

From **x64 Native Tools Command Prompt for VS** (so `cl.exe` is on `PATH`):

```bat
set PATH=C:\Go112\bin;C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.8\bin;%PATH%
cd \path\to\scdowallet
"C:\Program Files\Git\bin\bash.exe" scripts/build-zminer-gpu.sh
```

Adjust the CUDA directory if the installer used a versioned path other than `v12.8`. The script clones go-scdo commit `7ad1df0778abad2e735b7bd4602d2acd8b641838`, runs the CPU determinant tests, and runs:

```text
nvcc -shared -O3 -fmad=false --prec-div=true --prec-sqrt=true --ftz=false -gencode ... -o zpowdet.dll zpowdet.cu
go build -tags cuda -o zminer-gpu.exe
```

`-fmad=false` is required. A contracted multiply-add does not match the CPU determinant.

Output (git-ignored):

- `miner-zpow\dist\zminer-gpu.exe`
- `miner-zpow\dist\zpowdet.dll`
- `miner-zpow\dist\cudart64_*.dll` (copied from the CUDA `bin` directory next to `nvcc`)

Leave those three beside each other. The exe loads `zpowdet.dll` from its own directory, and Windows then loads `cudart64_*.dll` from that same directory.

## Check the GPU, then mine Shard1

Use your own Classic shard-1 address (`1S01...`). Do not use the address embedded in the CPU self-test fixture; that block is only a hash check.

```bat
cd \path\to\scdowallet\miner-zpow\dist
zminer-gpu.exe -check 32
zminer-gpu.exe -pool 82.223.19.88:3341 -user 1S01<your Classic shard1 address> -worker rtx5060ti -batch 8192
```

`-check 32` must print `GPU/CPU cross-check OK` and exit 0. That is 32 nonces at a post-EmeryFork height and 32 at height 1, compared as float64 bits with `zp.Det`. Exit 5 means the GPU disagreed: do not point it at the pool. Exit 4 means the DLL or the driver did not come up (missing `zpowdet.dll`, missing cudart DLL, or no device). Pass `-lib C:\full\path\zpowdet.dll` if the DLL is not next to the exe. `ZPOW_GPU_LIB` is the same override.

`-device N` selects a CUDA device. One process uses one device. `-batch` is the number of header hashes per launch (default 8192, maximum 262144). `-threads` is accepted and ignored so a wallet launch that still passes `-threads` does not fail flag parsing.

On a good run the log shows `logged in to 82.223.19.88:3341`, then lines of the form:

```json
{"type":"status","hashrate":0,"accepted":0,"rejected":0,"connected":true,"blocks":0,"uptime_sec":15}
```

`accepted` should increase and `rejected` should stay at or very near 0. The human log also shows `dropped`: shares this process threw away because the height changed, the connection dropped, the pool raised the share target, or the pool confirmed block:true for that height. Those are not pool rejects. A height closes only after the pool replies block:true; a block candidate without that reply does not stop work, and a new job at the same height resumes immediately. One non-block share is queued behind the one on the wire. The banner line is `zminer-gpu 0.1.3`. A rejection still means the pool disagreed: stop, and re-run `-check 32`. The process exits on Ctrl+C, SIGTERM, stdin EOF, or a line `stop`.

Shards 2–4 (`:3342`–`:3344`) are the same miner and are not live yet. HTTP getWork, if you use it, is `-http http://82.223.19.88:8341`.

## Wallet hook

The mining page starts an external GPU binary when `SCDO_ZPOW_GPU_BIN` is set. Set the arguments too; the default list includes `-threads`, which this miner ignores, and it does not set `-batch`.

```bat
set SCDO_ZPOW_GPU_BIN=C:\path\to\scdowallet\miner-zpow\dist\zminer-gpu.exe
set SCDO_ZPOW_GPU_ARGS=["-pool","{pool}","-user","{user}","-worker","{worker}","-batch","8192"]
```

`{pool}` for shard 1 is `82.223.19.88:3341`. No hash pin is required for this binary. Do not set `SCDO_ZPOW_GPU_SHA256` unless you intend to pin a file you built yourself.

## Linux

`bash scripts/build-zminer-gpu.sh` with Go 1.12.7 (the script downloads it on Linux) and, when `nvcc` is installed, writes `miner-zpow/dist/zminer-gpu` and `libzpowdet.so`. The same `-check` and `-pool` commands apply. Without `nvcc` the script still tests the CPU port and compiles the loader, prints these Windows steps, and exits 0. `REQUIRE_CUDA=1` makes a missing `nvcc` a failure.

```bash
./zminer-gpu -check 32
./zminer-gpu -pool 82.223.19.88:3341 -user 1S01<your Classic shard1 address> -worker gpu0 -batch 8192
```
