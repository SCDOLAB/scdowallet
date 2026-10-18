#!/bin/sh
# Install scdo-agent from https://scdo.com.au/downloads/wallet/linux/
# Detects the CPU, checks SHA256SUMS, then installs the binary and the systemd units.
set -eu

BASE_URL="https://scdo.com.au/downloads/wallet/linux"
VERSION="0.5.0"

lang=en
case "${LC_ALL:-${LANG:-}}" in
  zh*|ZH*) lang=zh ;;
esac

say() {
  if [ "$lang" = "zh" ]; then
    printf '%s\n' "$2"
  else
    printf '%s\n' "$1"
  fi
}

die() {
  say "$1" "$2" >&2
  exit 1
}

if [ "$(id -u)" -ne 0 ]; then
  if command -v sudo >/dev/null 2>&1; then
    exec sudo "$0" "$@"
  fi
  die "Run this installer as root." "請以 root 執行這個安裝程式。"
fi

arch_raw=$(uname -m)
case "$arch_raw" in
  x86_64|amd64) arch=amd64 ;;
  aarch64|arm64) arch=arm64 ;;
  *) die "This CPU is not supported: $arch_raw" "不支援這個處理器：$arch_raw" ;;
esac

if ! command -v sha256sum >/dev/null 2>&1; then
  die "sha256sum is required." "需要 sha256sum。"
fi

fetch() {
  url=$1
  dest=$2
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$dest"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O "$dest" "$url"
  else
    die "curl or wget is required." "需要 curl 或 wget。"
  fi
}

tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT

fetch "$BASE_URL/SHA256SUMS" "$tmpdir/SHA256SUMS"

if command -v dpkg >/dev/null 2>&1; then
  file="scdo-agent_${VERSION}_linux_${arch}.deb"
else
  file="scdo-agent_${VERSION}_linux_${arch}.tar.gz"
fi

fetch "$BASE_URL/$file" "$tmpdir/$file"
hash=$(awk -v f="$file" '$2 == f { print $1; exit }' "$tmpdir/SHA256SUMS")
if [ -z "$hash" ]; then
  die "SHA256SUMS has no entry for $file" "SHA256SUMS 沒有 $file 的紀錄"
fi
cd "$tmpdir"
printf '%s  %s\n' "$hash" "$file" | sha256sum -c -

if [ "${file%.deb}" != "$file" ]; then
  dpkg -i "$tmpdir/$file"
else
  unpack="$tmpdir/unpacked"
  mkdir -p "$unpack"
  tar -xzf "$tmpdir/$file" -C "$unpack"
  install -m 0755 "$unpack/scdo-agent" /usr/bin/scdo-agent
  install -d /lib/systemd/system
  install -m 0644 "$unpack/systemd/scdo-agent@.service" /lib/systemd/system/scdo-agent@.service
  install -m 0644 "$unpack/systemd/scdo-agent-update.service" /lib/systemd/system/scdo-agent-update.service
  install -m 0644 "$unpack/systemd/scdo-agent-update.timer" /lib/systemd/system/scdo-agent-update.timer
  install -m 0644 "$unpack/systemd/scdo-agent-boot.service" /lib/systemd/system/scdo-agent-boot.service
  if ! id scdo-agent >/dev/null 2>&1; then
    useradd --system --home-dir /var/lib/scdo-agent --shell /usr/sbin/nologin --comment "SCDO bookkeeping agent" scdo-agent
  fi
  mkdir -p /var/lib/scdo-agent
  chown scdo-agent:scdo-agent /var/lib/scdo-agent
  chmod 0755 /var/lib/scdo-agent
  if command -v systemctl >/dev/null 2>&1; then
    systemctl daemon-reload || true
    systemctl enable --now scdo-agent-update.timer || true
    systemctl enable scdo-agent-boot.service || true
  fi
fi

say "Installed scdo-agent ${VERSION} (${arch})." "已安裝 scdo-agent ${VERSION}（${arch}）。"
say "" ""
say "Next:" "下一步："
say "  sudo scdo-agent init --name <name> --payout 0x<address>" "  sudo scdo-agent init --name <名稱> --payout 0x<地址>"
say "  sudo systemctl enable --now scdo-agent@<name>.service" "  sudo systemctl enable --now scdo-agent@<名稱>.service"
say "  scdo-agent status --name <name>" "  scdo-agent status --name <名稱>"
say "  scdo-agent logs --name <name>" "  scdo-agent logs --name <名稱>"
say "  sudo scdo-agent upgrade-now" "  sudo scdo-agent upgrade-now"
say "" ""
say "Several agents: repeat init with another --name and enable scdo-agent@<that-name>.service." "多個代理：用另一個 --name 再執行 init，並啟用 scdo-agent@<該名稱>.service。"
say "Each agent keeps its own ledger record." "每個代理維護自己的帳本紀錄。"
say "A daily timer checks the signed release feed. upgrade-now is the same command." "每日計時器會檢查簽章後的發布檔。upgrade-now 是同一條命令。"
