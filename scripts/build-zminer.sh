#!/bin/bash
# Cross-build zminer (Classic CPU pool miner) for Windows and Linux.
# zpow links the go1.12 binary-only package consensus/scdorand from SCDOLAB/go-scdo,
# so this script uses Go 1.12.7 even if a newer Go is on PATH.
#
# The windows and linux hashes are reproducible. Go 1.12 records GOROOT, GOPATH
# and the -o path in the binary, so those three directories are fixed. Do not
# point them somewhere else. go-scdo is pinned by commit, not by moving master.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
GO_SCDO_REF=7ad1df0778abad2e735b7bd4602d2acd8b641838
GO_TGZ_SHA256=66d83bfb5a9ede000e33c6579a91a29e6b101829ad41fffb5c5bb6c900e109d9
GO_SCDO=${GO_SCDO:-/tmp/go-scdo}
GO_TGZ=/tmp/toolchain/go1.12.7.tgz
GO_ROOT=/tmp/toolchain/go1.12.7/go
GOPATH=/tmp/zminer-gopath
FIXED_OUT=/tmp/zminer-out

if [[ ! -x "$GO_ROOT/bin/go" ]]; then
  mkdir -p /tmp/toolchain/go1.12.7
  if [[ ! -f "$GO_TGZ" ]]; then
    curl -fsSL -o "$GO_TGZ" https://dl.google.com/go/go1.12.7.linux-amd64.tar.gz
  fi
  echo "$GO_TGZ_SHA256  $GO_TGZ" | sha256sum -c -
  tar -xzf "$GO_TGZ" -C /tmp/toolchain/go1.12.7
fi
echo "$GO_TGZ_SHA256  $GO_TGZ" | sha256sum -c -
"$GO_ROOT/bin/go" version | grep -q 'go1.12.7 '

have_pin=0
if [[ -f "$GO_SCDO/consensus/scdorand/scdorand_windows_amd64.a" ]]; then
  if git -C "$GO_SCDO" rev-parse HEAD | grep -q "^${GO_SCDO_REF}$"; then
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
test -f "$GO_SCDO/consensus/scdorand/scdorand_windows_amd64.a"
test -f "$GO_SCDO/consensus/scdorand/scdorand_linux_amd64.a"

export GOROOT="$GO_ROOT"
export PATH="$GOROOT/bin:$PATH"
export GO111MODULE=off
export GOPATH
export GOCACHE=/tmp/zminer-gocache
export TZ=UTC
unset GOFLAGS || true

rm -rf "$GOPATH"
mkdir -p "$GOPATH/src/github.com/scdoproject"
cp -a "$GO_SCDO" "$GOPATH/src/github.com/scdoproject/go-scdo"
G="$GOPATH/src/github.com/scdoproject/go-scdo"
rm -rf "$G/zpool" "$G/.git"
mkdir -p "$G/zpool"
cp -a "$ROOT/miner-zpow/zpool/." "$G/zpool/"
for os in linux windows; do
  d="$GOPATH/pkg/${os}_amd64/github.com/scdoproject/go-scdo/consensus"
  mkdir -p "$d"
  cp "$G/consensus/scdorand/scdorand_${os}_amd64.a" "$d/scdorand.a"
done

cd "$G"
go test -vet=off ./zpool/zp
rm -rf "$FIXED_OUT"
mkdir -p "$FIXED_OUT"
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags '-s -w -buildid=zminer' -o "$FIXED_OUT/zminer-linux-amd64" ./zpool/cmd/zminer
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -ldflags '-s -w -buildid=zminer' -o "$FIXED_OUT/zminer.exe" ./zpool/cmd/zminer

OUT="$ROOT/miner-zpow/dist"
mkdir -p "$OUT"
cp "$FIXED_OUT/zminer-linux-amd64" "$FIXED_OUT/zminer.exe" "$OUT/"
(
  cd "$FIXED_OUT"
  sha256sum zminer-linux-amd64 zminer.exe > SHA256SUMS
  cp SHA256SUMS "$OUT/SHA256SUMS"
  cat SHA256SUMS
)
committed="$ROOT/miner-zpow/SHA256SUMS"
if [[ "${ZMINER_UPDATE_SUMS:-}" == 1 ]]; then
  cp "$OUT/SHA256SUMS" "$committed"
fi
if ! cmp -s "$OUT/SHA256SUMS" "$committed"; then
  echo "zminer SHA256 does not match miner-zpow/SHA256SUMS" >&2
  echo "built:" >&2
  cat "$OUT/SHA256SUMS" >&2
  echo "committed:" >&2
  cat "$committed" >&2
  exit 1
fi
# stdin "stop" must end the process (Windows launch uses CREATE_NO_WINDOW and closes stdin).
printf 'stop\n' | "$OUT/zminer-linux-amd64" -pool 127.0.0.1:9 -user 1S01dfdbe4d921d507032cb83ee04bb7efc4fd9a51 -threads 1
# Proves the Linux binary is the real zpow build (refuses a scdorand stub).
"$OUT/zminer-linux-amd64" -bench 1
echo "zminer binaries: $OUT"
echo "go-scdo $GO_SCDO_REF"
echo "Windows installer build verifies this hash before packing. It does not use a hand-placed miner-bin file."
