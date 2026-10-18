#!/bin/sh
# Build static linux/amd64 and linux/arm64 binaries, a tarball and a .deb for each, and SHA256SUMS.
set -eu
cd "$(dirname "$0")/.."
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
for arch in amd64 arm64; do
  mkdir -p "dist/build/$arch" "dist/stage-$arch/systemd"
  CGO_ENABLED=0 GOOS=linux GOARCH="$arch" go build -trimpath -buildvcs=false \
    -ldflags "-s -w -X github.com/SCDOLAB/scdowallet/linux-agent/internal/buildinfo.Version=${VER}" \
    -o "dist/build/$arch/scdo-agent" ./cmd/scdo-agent
  cp "dist/build/$arch/scdo-agent" "dist/stage-$arch/scdo-agent"
  for unit in scdo-agent@.service scdo-agent-update.service scdo-agent-update.timer scdo-agent-boot.service; do
    cp "packaging/$unit" "dist/stage-$arch/systemd/$unit"
  done
  cp README.md "dist/stage-$arch/README.md"
  cp third_party/x402/LICENSE "dist/stage-$arch/x402-LICENSE"
  cp third_party/x402/NOTICE "dist/stage-$arch/x402-NOTICE"
  tar -C "dist/stage-$arch" -czf "dist/scdo-agent_${VER}_linux_${arch}.tar.gz" scdo-agent systemd README.md x402-LICENSE x402-NOTICE

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
