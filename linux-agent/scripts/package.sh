#!/bin/sh
# Reproducible linux/amd64 and linux/arm64 packages.
#
# gnark-crypto assembly #include lines record an absolute path. -trimpath does
# not rewrite a file included from outside the package being compiled, so the
# module cache and GOROOT are fixed paths on every machine. The Go build id is
# empty and the GNU note is off. Tar and deb mtimes use SOURCE_DATE_EPOCH.
#
# Published SHA-256 values are the scdo-agent-linux artifact. CI builds this
# script on two runners and fails when the digests differ.
set -eu
cd "$(dirname "$0")/.."

if [ -z "${SOURCE_DATE_EPOCH:-}" ]; then
  SOURCE_DATE_EPOCH=0
fi
export SOURCE_DATE_EPOCH
export TZ=UTC
export LC_ALL=C
export CGO_ENABLED=0
export GOAMD64=v1
export GOARM64=v8.0
export GOFLAGS=-mod=readonly
export GOWORK=off
export GOENV=off
export GO111MODULE=on
export GOSUMDB=sum.golang.org
if [ -z "${GOPROXY:-}" ]; then
  GOPROXY=https://proxy.golang.org,direct
fi
export GOPROXY
# Fixed paths. A home directory or a runner user name must not appear in the binary.
export GOPATH=/tmp/scdo-gopath
export GOMODCACHE=/tmp/scdo-gopath/pkg/mod
export GOCACHE=/tmp/scdo-gocache
export GOTMPDIR=/tmp/scdo-gotmp
export GOROOT=/tmp/scdo-go
export GOROOT_FINAL=/tmp/scdo-go
export GOTOOLCHAIN=local
umask 022

case "$(uname -m)" in
  x86_64) gohost=amd64 ;;
  aarch64|arm64) gohost=arm64 ;;
  *)
    echo "unsupported host arch $(uname -m)" >&2
    exit 1
    ;;
esac

tarball="go1.24.1.linux-${gohost}.tar.gz"
want=$(awk -v f="$tarball" '$1 !~ /^#/ && $2 == f { print $1 }' scripts/toolchain.sum)
if [ -z "$want" ]; then
  echo "missing checksum for $tarball" >&2
  exit 1
fi
mkdir -p /tmp/scdo-dl
dl="/tmp/scdo-dl/$tarball"
if [ -f "$dl" ]; then
  got=$(sha256sum "$dl" | awk '{ print $1 }')
  if [ "$got" != "$want" ]; then
    rm -f "$dl"
  fi
fi
if [ ! -f "$dl" ]; then
  if ! command -v curl >/dev/null 2>&1; then
    echo "curl is required to fetch $tarball" >&2
    exit 1
  fi
  curl -fsSL --retry 3 --retry-delay 2 -o "$dl.partial" "https://go.dev/dl/$tarball"
  mv "$dl.partial" "$dl"
fi
got=$(sha256sum "$dl" | awk '{ print $1 }')
if [ "$got" != "$want" ]; then
  echo "toolchain checksum mismatch for $tarball" >&2
  echo "got  $got" >&2
  echo "want $want" >&2
  exit 1
fi
echo "toolchain $tarball $got"
rm -rf /tmp/scdo-go
mkdir -p /tmp/scdo-go
tar -C /tmp/scdo-go --strip-components=1 -xf "$dl"
export PATH="/tmp/scdo-go/bin:${GOPATH}/bin:${PATH}"

# Drop objects compiled against any other module path.
rm -rf "$GOCACHE" "$GOTMPDIR"
mkdir -p "$GOPATH" "$GOMODCACHE" "$GOCACHE" "$GOTMPDIR"

goversion=$(go env GOVERSION)
if [ "$goversion" != "go1.24.1" ]; then
  echo "toolchain is ${goversion}, want go1.24.1" >&2
  exit 1
fi

VER=$(sed -n 's/^var Version = "\(.*\)"/\1/p' internal/buildinfo/version.go)
if [ -z "$VER" ]; then
  echo "version missing" >&2
  exit 1
fi
if ! grep -q "VERSION=\"$VER\"" packaging/install.sh; then
  echo "install.sh VERSION does not match $VER" >&2
  exit 1
fi

go mod download
go mod verify

# nfpm is a packager, not a module of this repo. An empty GOFLAGS avoids
# -mod=readonly rejecting the versioned install. The agent build below keeps it.
GOFLAGS= go install github.com/goreleaser/nfpm/v2/cmd/nfpm@v2.35.3
NFPM="${GOPATH}/bin/nfpm"
if [ ! -x "$NFPM" ]; then
  echo "nfpm install failed" >&2
  exit 1
fi

rm -rf dist
mkdir -p dist
MTIME=$(date -u -d "@${SOURCE_DATE_EPOCH}" +%Y-%m-%dT%H:%M:%SZ)
for arch in amd64 arm64; do
  mkdir -p "dist/build/$arch" "dist/stage-$arch/systemd" "dist/stage-$arch/systemd-user"
  CGO_ENABLED=0 GOOS=linux GOARCH="$arch" GOAMD64=v1 GOARM64=v8.0 \
    go build -trimpath -buildvcs=false \
    -ldflags "-s -w -buildid= -B none -X github.com/SCDOLAB/scdowallet/linux-agent/internal/buildinfo.Version=${VER}" \
    -o "dist/build/$arch/scdo-agent" ./cmd/scdo-agent
  cp "dist/build/$arch/scdo-agent" "dist/stage-$arch/scdo-agent"
  chmod 0755 "dist/stage-$arch/scdo-agent"
  for unit in scdo-agent@.service scdo-agent-update.service scdo-agent-update.timer scdo-agent-boot.service; do
    cp "packaging/$unit" "dist/stage-$arch/systemd/$unit"
    cp "packaging/user/$unit" "dist/stage-$arch/systemd-user/$unit"
    chmod 0644 "dist/stage-$arch/systemd/$unit" "dist/stage-$arch/systemd-user/$unit"
  done
  cp README.md "dist/stage-$arch/README.md"
  cp third_party/x402/LICENSE "dist/stage-$arch/x402-LICENSE"
  cp third_party/x402/NOTICE "dist/stage-$arch/x402-NOTICE"
  chmod 0644 "dist/stage-$arch/README.md" "dist/stage-$arch/x402-LICENSE" "dist/stage-$arch/x402-NOTICE"
  tar --sort=name --mtime="@${SOURCE_DATE_EPOCH}" --owner=0 --group=0 --numeric-owner --format=ustar \
    -C "dist/stage-$arch" -cf - scdo-agent systemd systemd-user README.md x402-LICENSE x402-NOTICE \
    | gzip -n > "dist/scdo-agent_${VER}_linux_${arch}.tar.gz"

  cat > "dist/nfpm-$arch.yaml" <<EOF
name: scdo-agent
arch: ${arch}
platform: linux
version: ${VER}
section: utils
priority: optional
maintainer: SCDO Laboratory <dev@scdo.com.au>
description: Headless bookkeeping agent for the SCDO Agent Ledger
homepage: https://scdo.com.au
license: CC0-1.0
mtime: ${MTIME}
contents:
  - src: dist/build/${arch}/scdo-agent
    dst: /usr/bin/scdo-agent
    file_info:
      mode: 0755
  - src: packaging/scdo-agent@.service
    dst: /lib/systemd/system/scdo-agent@.service
    file_info:
      mode: 0644
  - src: packaging/scdo-agent-update.service
    dst: /lib/systemd/system/scdo-agent-update.service
    file_info:
      mode: 0644
  - src: packaging/scdo-agent-update.timer
    dst: /lib/systemd/system/scdo-agent-update.timer
    file_info:
      mode: 0644
  - src: packaging/scdo-agent-boot.service
    dst: /lib/systemd/system/scdo-agent-boot.service
    file_info:
      mode: 0644
  - src: third_party/x402/LICENSE
    dst: /usr/share/doc/scdo-agent/x402-LICENSE
    file_info:
      mode: 0644
  - src: third_party/x402/NOTICE
    dst: /usr/share/doc/scdo-agent/x402-NOTICE
    file_info:
      mode: 0644
scripts:
  postinstall: packaging/postinstall.sh
EOF
  "$NFPM" package -f "dist/nfpm-$arch.yaml" -p deb -t "dist/scdo-agent_${VER}_linux_${arch}.deb"
done

cp packaging/install.sh dist/install.sh
chmod 0755 dist/install.sh packaging/postinstall.sh
(
  cd dist
  sha256sum scdo-agent_"${VER}"_linux_amd64.tar.gz \
    scdo-agent_"${VER}"_linux_arm64.tar.gz \
    scdo-agent_"${VER}"_linux_amd64.deb \
    scdo-agent_"${VER}"_linux_arm64.deb \
    install.sh > SHA256SUMS
)
echo "wrote dist/SHA256SUMS"
cat dist/SHA256SUMS
