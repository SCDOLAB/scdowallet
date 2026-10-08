#!/bin/bash
# Build zminer-gpu, the Classic pool miner that computes the zpow 30x30
# determinant on an NVIDIA GPU. CPU zminer is a separate binary; this script
# does not rebuild it and does not touch miner-zpow/SHA256SUMS.
#
# Go 1.12.7 is required (consensus/scdorand is a binary-only package).
# The CUDA library is built only when nvcc is on PATH. Without nvcc the Go
# loader still compiles, the CPU determinant tests still run, and the script
# prints the Windows steps and exits 0. Set REQUIRE_CUDA=1 to fail instead.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
GO_SCDO_REF=7ad1df0778abad2e735b7bd4602d2acd8b641838
GO_TGZ_SHA256=66d83bfb5a9ede000e33c6579a91a29e6b101829ad41fffb5c5bb6c900e109d9
GO_SCDO=${GO_SCDO:-/tmp/go-scdo}
GO_TGZ=/tmp/toolchain/go1.12.7.tgz
GO_ROOT=/tmp/toolchain/go1.12.7/go
GOPATH_UNIX=/tmp/zminer-gopath
OUT="$ROOT/miner-zpow/dist"

is_windows=0
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) is_windows=1 ;;
esac

to_native() {
  if [[ "$is_windows" == 1 ]] && command -v cygpath >/dev/null 2>&1; then
    cygpath -w "$1"
  else
    printf '%s\n' "$1"
  fi
}

cuda_missing_message() {
  cat <<'EOF'
zminer-gpu CUDA library was not built (no nvcc on this machine).

The pool GPU miner is zminer-gpu plus zpowdet.dll (Windows) or libzpowdet.so
(Linux). It is not the solo node, and it does not link go-scdo's
libgoGpuDet.a (that archive is Linux ELF, sm_30 SASS only, legacy CUDA
launch API). CPU zminer is unchanged.

Build on Windows (RTX 5060 Ti needs CUDA 12.8 or newer) from an
"x64 Native Tools Command Prompt for VS" so nvcc can see cl.exe, with
Go 1.12.7 and Git Bash:

  set PATH=C:\Go112\bin;C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.8\bin;%PATH%
  "C:\Program Files\Git\bin\bash.exe" scripts/build-zminer-gpu.sh

The script writes miner-zpow/dist/zminer-gpu.exe, zpowdet.dll, and the
cudart64_*.dll that nvcc linked. Exact run steps: miner-zpow/GPU.md

  miner-zpow\dist\zminer-gpu.exe -check 32
  miner-zpow\dist\zminer-gpu.exe -pool 82.223.19.88:3341 -user 1S01<your Classic shard1 address> -worker rtx5060ti -batch 8192

Shard1 is 82.223.19.88:3341. Use your own Classic address. The address in
the CPU self-test fixture is not a payout address.
EOF
}

setup_linux_go() {
  if [[ ! -x "$GO_ROOT/bin/go" ]]; then
    mkdir -p /tmp/toolchain/go1.12.7
    if [[ ! -f "$GO_TGZ" ]]; then
      curl -fsSL -o "$GO_TGZ" https://dl.google.com/go/go1.12.7.linux-amd64.tar.gz
    fi
    echo "$GO_TGZ_SHA256  $GO_TGZ" | sha256sum -c -
    tar -xzf "$GO_TGZ" -C /tmp/toolchain/go1.12.7
  fi
  echo "$GO_TGZ_SHA256  $GO_TGZ" | sha256sum -c -
  export GOROOT="$GO_ROOT"
  export PATH="$GOROOT/bin:$PATH"
  go version | grep -q 'go1.12.7 '
}

setup_windows_go() {
  if ! command -v go >/dev/null 2>&1 || ! go version | grep -q 'go1.12.7 '; then
    echo "Windows build needs Go 1.12.7 on PATH (go version must contain go1.12.7)." >&2
    echo "Install https://dl.google.com/go/go1.12.7.windows-amd64.zip and put its bin directory first." >&2
    cuda_missing_message
    if [[ "${REQUIRE_CUDA:-}" == 1 ]]; then exit 1; fi
    exit 0
  fi
  export GOROOT="$(go env GOROOT)"
  go version | grep -q 'go1.12.7 '
}

fetch_go_scdo() {
  have_pin=0
  if [[ -f "$GO_SCDO/consensus/scdorand/scdorand_windows_amd64.a" && -f "$GO_SCDO/consensus/scdorand/scdorand_linux_amd64.a" ]]; then
    if git -C "$GO_SCDO" rev-parse HEAD 2>/dev/null | grep -q "^${GO_SCDO_REF}$"; then
      have_pin=1
    fi
  fi
  if [[ "$have_pin" != 1 ]]; then
    rm -rf "$GO_SCDO"
    mkdir -p "$GO_SCDO"
    git -C "$GO_SCDO" init
    git -C "$GO_SCDO" remote add origin https://github.com/SCDOLAB/go-scdo.git
    git -C "$GO_SCDO" fetch --depth 1 origin "$GO_SCDO_REF"
    git -C "$GO_SCDO" checkout --detach FETCH_HEAD
  fi
  git -C "$GO_SCDO" rev-parse HEAD | grep -q "^${GO_SCDO_REF}$"
  grep -q 'go:binary-only-package' "$GO_SCDO/consensus/scdorand/scdorand.go"
}

prepare_tree() {
  export GO111MODULE=off
  export GOPATH="$(to_native "$GOPATH_UNIX")"
  export GOCACHE="$(to_native /tmp/zminer-gocache)"
  export TZ=UTC
  unset GOFLAGS || true
  rm -rf "$GOPATH_UNIX"
  mkdir -p "$GOPATH_UNIX/src/github.com/scdoproject"
  cp -a "$GO_SCDO" "$GOPATH_UNIX/src/github.com/scdoproject/go-scdo"
  G="$GOPATH_UNIX/src/github.com/scdoproject/go-scdo"
  rm -rf "$G/zpool" "$G/.git"
  mkdir -p "$G/zpool"
  cp -a "$ROOT/miner-zpow/zpool/." "$G/zpool/"
  local os
  for os in linux windows; do
    local d="$GOPATH_UNIX/pkg/${os}_amd64/github.com/scdoproject/go-scdo/consensus"
    mkdir -p "$d"
    cp "$G/consensus/scdorand/scdorand_${os}_amd64.a" "$d/scdorand.a"
  done
}

check_sources() {
  local dirty
  dirty=$(gofmt -l "$ROOT/miner-zpow/zpool/gpu" "$ROOT/miner-zpow/zpool/cmd/zminer-gpu")
  if [[ -n "$dirty" ]]; then
    echo "gofmt would change:" >&2
    echo "$dirty" >&2
    exit 1
  fi
  COOKED_GO="$ROOT/miner-zpow/zpool/gpu/cooked.go" \
  COOKED_CU="$ROOT/miner-zpow/zpool/cuda/cooked.cuh" \
  python3 - <<'PY'
import os, re
def body(path):
    text = open(path).read()
    a = text.index("{")
    b = text.rindex("}")
    return [int(x) for x in re.findall(r"-?\d+", text[a:b])]
g = body(os.environ["COOKED_GO"])
c = body(os.environ["COOKED_CU"])
if g != c:
    raise SystemExit("cooked.go and cooked.cuh differ (%d vs %d ints)" % (len(g), len(c)))
if len(g) != 607:
    raise SystemExit("cooked table length %d, want 607" % len(g))
print("cooked tables match (607)")
PY
}

nvcc_gencode() {
  local ver maj min archs ptx a
  ver=$(nvcc --version | sed -n 's/.*release \([0-9][0-9]*\)\.\([0-9][0-9]*\).*/\1 \2/p' | head -1)
  if [[ -z "$ver" ]]; then
    echo "could not parse nvcc --version" >&2
    return 1
  fi
  maj=${ver% *}
  min=${ver#* }
  if (( maj > 12 || (maj == 12 && min >= 8) )); then
    archs="70 75 80 86 89 90 100 120"
    ptx=120
  elif (( maj >= 12 )); then
    archs="70 75 80 86 89 90"
    ptx=90
  elif (( maj > 11 || (maj == 11 && min >= 8) )); then
    archs="70 75 80 86 89"
    ptx=89
  elif (( maj > 11 || (maj == 11 && min >= 1) )); then
    archs="70 75 80 86"
    ptx=86
  elif (( maj >= 11 )); then
    archs="70 75 80"
    ptx=80
  elif (( maj >= 10 )); then
    archs="70 75"
    ptx=75
  else
    echo "nvcc ${maj}.${min} is too old; CUDA 10 or newer is required" >&2
    return 1
  fi
  GENCODES=()
  for a in $archs; do
    GENCODES+=(-gencode "arch=compute_${a},code=sm_${a}")
  done
  GENCODES+=(-gencode "arch=compute_${ptx},code=compute_${ptx}")
  echo "nvcc ${maj}.${min}: sm_${archs// /, sm_} + PTX compute_${ptx}"
  if (( ptx < 120 )); then
    echo "NOTE: an RTX 5060 Ti (sm_120) needs CUDA 12.8 or newer. This toolkit's newest PTX is compute_${ptx}, which that GPU cannot load." >&2
  fi
}

build_cuda_lib() {
  local src="$ROOT/miner-zpow/zpool/cuda/zpowdet.cu"
  nvcc_gencode
  local common=(-shared -O3 -fmad=false --prec-div=true --prec-sqrt=true --ftz=false "${GENCODES[@]}")
  if [[ "$is_windows" == 1 ]]; then
    if ! command -v cl >/dev/null 2>&1 && ! command -v cl.exe >/dev/null 2>&1; then
      echo "cl.exe is not on PATH. Run this script from the x64 Native Tools Command Prompt so nvcc can find the MSVC compiler." >&2
      exit 1
    fi
    nvcc "${common[@]}" -o "$(to_native "$OUT/zpowdet.dll")" "$(to_native "$src")"
    local bindir
    bindir=$(dirname "$(command -v nvcc)")
    local copied=0 dll
    for dll in "$bindir"/cudart64_*.dll; do
      if [[ -f "$dll" ]]; then
        cp -f "$dll" "$OUT/"
        copied=1
      fi
    done
    if [[ "$copied" != 1 ]]; then
      echo "built zpowdet.dll but did not find cudart64_*.dll next to nvcc; copy that DLL beside zminer-gpu.exe before running" >&2
    fi
  else
    nvcc "${common[@]}" -Xcompiler -fPIC -o "$(to_native "$OUT/libzpowdet.so")" "$(to_native "$src")" \
      -Xlinker -rpath -Xlinker '$ORIGIN' \
      -Xlinker -rpath -Xlinker /usr/local/cuda/lib64
    local cuda_home lib
    cuda_home=$(cd "$(dirname "$(command -v nvcc)")/.." && pwd)
    for lib in "$cuda_home/lib64"/libcudart.so "$cuda_home/lib64"/libcudart.so.* /usr/local/cuda/lib64/libcudart.so /usr/local/cuda/lib64/libcudart.so.*; do
      if [[ -f "$lib" ]]; then
        cp -a "$lib" "$OUT/" || true
      fi
    done
  fi
}

run_check() {
  local bin="$1"
  set +e
  "$bin" -check 4
  local rc=$?
  set -e
  if [[ "$rc" == 0 ]]; then
    echo "GPU/CPU cross-check passed ($bin -check 4)"
  elif [[ "$rc" == 4 ]]; then
    echo "zminer-gpu ran its CPU self-test. No CUDA library or no GPU here, so the device cross-check did not run (exit 4)."
  elif [[ "$rc" == 5 ]]; then
    echo "GPU/CPU cross-check failed" >&2
    exit 5
  else
    echo "zminer-gpu -check 4 exited $rc" >&2
    exit "$rc"
  fi
}

if [[ "$is_windows" == 1 ]]; then
  setup_windows_go
else
  setup_linux_go
fi
fetch_go_scdo
prepare_tree
check_sources

G="$GOPATH_UNIX/src/github.com/scdoproject/go-scdo"
cd "$G"
CGO_ENABLED=0 go test -vet=off -count=1 github.com/scdoproject/go-scdo/zpool/gpu
CGO_ENABLED=0 go test -vet=off -count=1 github.com/scdoproject/go-scdo/zpool/cmd/zminer-gpu

mkdir -p "$OUT"
if [[ "$is_windows" == 1 ]]; then
  CGO_ENABLED=0 go test -vet=off -count=1 -tags cuda -run TestDeviceMatchesCPU github.com/scdoproject/go-scdo/zpool/gpu
  CGO_ENABLED=0 go build -tags cuda -o "$(to_native "$OUT/zminer-gpu.exe")" ./zpool/cmd/zminer-gpu
else
  CGO_ENABLED=1 go test -vet=off -count=1 -tags cuda -run TestDeviceMatchesCPU github.com/scdoproject/go-scdo/zpool/gpu
  CGO_ENABLED=1 go build -tags cuda -o "$OUT/zminer-gpu" ./zpool/cmd/zminer-gpu
  CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -tags cuda -o "$OUT/zminer-gpu.exe" ./zpool/cmd/zminer-gpu
fi

if command -v nvcc >/dev/null 2>&1; then
  build_cuda_lib
  if [[ "$is_windows" == 1 ]]; then
    ZPOW_GPU_LIB="$(to_native "$OUT/zpowdet.dll")" CGO_ENABLED=0 go test -vet=off -count=1 -tags cuda -run TestDeviceMatchesCPU github.com/scdoproject/go-scdo/zpool/gpu
    run_check "$OUT/zminer-gpu.exe"
  else
    ZPOW_GPU_LIB="$OUT/libzpowdet.so" CGO_ENABLED=1 go test -vet=off -count=1 -tags cuda -run TestDeviceMatchesCPU github.com/scdoproject/go-scdo/zpool/gpu
    run_check "$OUT/zminer-gpu"
  fi
else
  cuda_missing_message
  if [[ "$is_windows" == 1 ]]; then
    run_check "$OUT/zminer-gpu.exe"
  else
    run_check "$OUT/zminer-gpu"
  fi
  if [[ "${REQUIRE_CUDA:-}" == 1 ]]; then
    exit 1
  fi
fi

echo "zminer-gpu output: $OUT"
echo "go-scdo $GO_SCDO_REF"
if command -v sha256sum >/dev/null 2>&1; then
  (
    cd "$OUT"
    for f in zminer-gpu zminer-gpu.exe libzpowdet.so zpowdet.dll cudart64_*.dll libcudart.so libcudart.so.*; do
      if [[ -f "$f" ]]; then sha256sum "$f"; fi
    done
  )
fi
echo "These GPU binaries are not hash-pinned. CPU zminer hashes stay in miner-zpow/SHA256SUMS."
