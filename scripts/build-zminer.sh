#!/bin/bash
# Cross-build zminer (Classic CPU pool miner) for Windows and Linux.
# zpow links the go1.12 binary-only package consensus/scdorand from SCDOLAB/go-scdo,
# so this script uses Go 1.12.7 even if a newer Go is on PATH.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
GO_SCDO=${GO_SCDO:-/tmp/go-scdo}
GO_TGZ=${GO_TGZ:-/tmp/toolchain/go1.12.7.tgz}
GO_ROOT=${GO_ROOT:-/tmp/toolchain/go1.12.7/go}

if [[ ! -x "$GO_ROOT/bin/go" ]]; then
  mkdir -p "$(dirname "$GO_TGZ")" /tmp/toolchain/go1.12.7
  if [[ ! -f "$GO_TGZ" ]]; then
    curl -fsSL -o "$GO_TGZ" https://dl.google.com/go/go1.12.7.linux-amd64.tar.gz
  fi
  tar -xzf "$GO_TGZ" -C /tmp/toolchain/go1.12.7
fi
if [[ ! -f "$GO_SCDO/consensus/scdorand/scdorand.go" ]]; then
  git clone --depth 1 https://github.com/SCDOLAB/go-scdo.git "$GO_SCDO"
fi
grep -q 'go:binary-only-package' "$GO_SCDO/consensus/scdorand/scdorand.go"

export GOROOT="$GO_ROOT"
export PATH="$GOROOT/bin:$PATH"
export GO111MODULE=off
export GOCACHE=${GOCACHE:-/tmp/go112cache}
GOPATH=$(mktemp -d)
export GOPATH
G="$GOPATH/src/github.com/scdoproject/go-scdo"
mkdir -p "$(dirname "$G")"
cp -a "$GO_SCDO" "$G"
rm -rf "$G/zpool"
mkdir -p "$G/zpool"
cp -a "$ROOT/miner-zpow/zpool/." "$G/zpool/"
for os in linux windows; do
  d="$GOPATH/pkg/${os}_amd64/github.com/scdoproject/go-scdo/consensus"
  mkdir -p "$d"
  cp "$G/consensus/scdorand/scdorand_${os}_amd64.a" "$d/scdorand.a"
done

cd "$G"
go test -vet=off ./zpool/zp
OUT="$ROOT/miner-zpow/dist"
mkdir -p "$OUT"
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags '-s -w' -o "$OUT/zminer-linux-amd64" ./zpool/cmd/zminer
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -ldflags '-s -w' -o "$OUT/zminer.exe" ./zpool/cmd/zminer
(
  cd "$OUT"
  sha256sum zminer-linux-amd64 zminer.exe > SHA256SUMS
  cp SHA256SUMS "$ROOT/miner-zpow/SHA256SUMS"
  cat SHA256SUMS
)
# stdin "stop" must end the process (Windows launch uses CREATE_NO_WINDOW and closes stdin).
printf 'stop\n' | "$OUT/zminer-linux-amd64" -pool 127.0.0.1:9 -user 1S01dfdbe4d921d507032cb83ee04bb7efc4fd9a51 -threads 1
# Proves the Linux binary is the real zpow build (refuses a scdorand stub).
"$OUT/zminer-linux-amd64" -bench 1
echo "zminer binaries: $OUT"
echo "Copy zminer.exe and SHA256SUMS to miner-bin/win32/ before a Windows wallet build."
