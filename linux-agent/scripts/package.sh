#!/bin/sh
# Build static linux/amd64 and linux/arm64 binaries, a tarball and a .deb for each, and SHA256SUMS.
# -trimpath, a fixed build id, and SOURCE_DATE_EPOCH keep the SHA-256 stable
# across a second local build and CI.
set -eu
cd "$(dirname "$0")/.."
if [ -z "${SOURCE_DATE_EPOCH:-}" ]; then
  SOURCE_DATE_EPOCH=0
fi
export SOURCE_DATE_EPOCH
export TZ=UTC
export LC_ALL=C
# Pin the toolchain so a local build matches GitHub Actions (setup-go 1.24.1).
export GOTOOLCHAIN=go1.24.1
umask 022
VER=$(sed -n 's/^var Version = "\(.*\)"/\1/p' internal/buildinfo/version.go)
if [ -z "$VER" ]; then
  echo "version missing" >&2
  exit 1
fi
if ! grep -q "VERSION=\"$VER\"" packaging/install.sh; then
  echo "install.sh VERSION does not match $VER" >&2
  exit 1
fi

if ! command -v nfpm >/dev/null 2>&1; then
  go install github.com/goreleaser/nfpm/v2/cmd/nfpm@v2.35.3
  export PATH="$(go env GOPATH)/bin:$PATH"
fi

rm -rf dist
mkdir -p dist
BUILDID="scdo-agent"
MTIME=$(date -u -d "@${SOURCE_DATE_EPOCH}" +%Y-%m-%dT%H:%M:%SZ)
for arch in amd64 arm64; do
  mkdir -p "dist/build/$arch" "dist/stage-$arch/systemd" "dist/stage-$arch/systemd-user"
  CGO_ENABLED=0 GOOS=linux GOARCH="$arch" go build -trimpath -buildvcs=false \
    -ldflags "-s -w -buildid=${BUILDID} -B gobuildid -X github.com/SCDOLAB/scdowallet/linux-agent/internal/buildinfo.Version=${VER}" \
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
  nfpm package -f "dist/nfpm-$arch.yaml" -p deb -t "dist/scdo-agent_${VER}_linux_${arch}.deb"
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
