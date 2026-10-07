#!/bin/bash
# Classic GPU miner = go-scdo node with the CUDA zpow engine (goGpuDet + libcudart).
# A wallet build does not require this script. If nvcc is missing it prints the
# Windows steps and exits 0. Set REQUIRE_CUDA=1 to fail instead.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="$ROOT/miner-zpow/dist/classic"
if ! command -v nvcc >/dev/null 2>&1; then
  cat <<'EOF'
Classic GPU miner was not built (no nvcc on this machine).

The production miner is the go-scdo node, not a separate GPU binary.
Source: https://github.com/SCDOLAB/go-scdo
Use a tree that still has the binary-only consensus/scdorand package
(restored 2026-09-26, commit cd53b3783c; current master includes it)
and the CUDA archive consensus/zpow/libgoGpuDet.a.

On a Windows machine with the CUDA toolkit and a Go that can cgo-link that tree:

  go build -o node.exe ./cmd/node
  copy node.exe and libcudart.dll (from the CUDA toolkit) into:
    miner-bin\win32\classic\
  or set SCDO_CLASSIC_NODE to the exe and SCDO_CUDART_DIR to the DLL folder.

Optional: put SHA256SUMS next to node.exe. The wallet checks it when present.

The wallet then runs, per selected shard:

  node.exe start -c nodeN.json -m start --threads 1 --threadblocks 100 --blockthreads 100

Shard 1's CPU pool is 82.223.19.88:3341 (zminer). This script builds the GPU node only.
It writes nodeN.json itself (coinbase = the Classic address, fresh P2P key).
Do not point it at an existing node key.
EOF
  if [[ "${REQUIRE_CUDA:-}" == 1 ]]; then exit 1; fi
  exit 0
fi
echo "nvcc found, but this script does not cross-compile the cgo CUDA node."
echo "Build node.exe on Windows (see the message above) and copy it to miner-bin/win32/classic/."
mkdir -p "$OUT"
exit 0
