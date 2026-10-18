#!/bin/sh
# Install scdo-agent from https://scdo.com.au/downloads/wallet/linux/
# Detects the CPU, checks SHA256SUMS, then installs the binary and the systemd units.
# sh install.sh          system install (root): /usr/bin and /var/lib/scdo-agent
# sh install.sh --user   rootless install: ~/.local/bin and ~/.local/share/scdo-agent
set -eu

BASE_URL="https://scdo.com.au/downloads/wallet/linux"
VERSION="0.5.4"

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

user_unit_hint() {
  unit=$1
  say "User unit ${unit} is not active." "使用者單元 ${unit} 沒有處於執行中。" >&2
  systemctl --user status "$unit" --no-pager -l >&2 || true
  say "If systemctl status shows status=218/CAPABILITIES, this kernel blocks unprivileged user namespaces (kernel.apparmor_restrict_unprivileged_userns=1). The user unit must not set PrivateTmp, ProtectSystem, ProtectKernelTunables, ProtectKernelModules, or ProtectControlGroups. Those options need a user namespace or capabilities. Reinstall this package so the user unit drops them. The system unit keeps that hardening." "若 systemctl status 顯示 status=218/CAPABILITIES，這個核心不允許未授權的使用者命名空間（kernel.apparmor_restrict_unprivileged_userns=1）。使用者單元不能設定 PrivateTmp、ProtectSystem、ProtectKernelTunables、ProtectKernelModules、ProtectControlGroups。這些選項需要使用者命名空間或權限。請重新安裝這個套件，讓使用者單元拿掉它們。系統單元仍保留這些限制。" >&2
}

user_mode=0
for arg in "$@"; do
  case "$arg" in
    --user) user_mode=1 ;;
    -h|--help)
      say "Usage: sh install.sh [--user]" "用法：sh install.sh [--user]"
      say "  (no flag)  system install, needs root" "  （無旗標）系統安裝，需要 root"
      say "  --user     home install: ~/.local/bin and ~/.local/share/scdo-agent" "  --user     家目錄安裝：~/.local/bin 與 ~/.local/share/scdo-agent"
      exit 0
      ;;
    *)
      die "Unknown argument: $arg" "未知參數：$arg"
      ;;
  esac
done

if [ "$user_mode" -eq 0 ] && [ "$(id -u)" -ne 0 ]; then
  if command -v sudo >/dev/null 2>&1; then
    exec sudo "$0" "$@"
  fi
  die "Run this installer as root, or use --user for a home-directory install." "請以 root 執行這個安裝程式，或用 --user 安裝到家目錄。"
fi

if [ "$user_mode" -eq 1 ] && [ -z "${HOME:-}" ]; then
  die "HOME is not set." "沒有設定 HOME。"
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

# A rootless install always uses the tarball. dpkg needs root and writes /usr.
if [ "$user_mode" -eq 0 ] && command -v dpkg >/dev/null 2>&1; then
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

if [ "$user_mode" -eq 1 ]; then
  unpack="$tmpdir/unpacked"
  mkdir -p "$unpack"
  tar -xzf "$tmpdir/$file" -C "$unpack"
  if [ ! -d "$unpack/systemd-user" ]; then
    die "This package has no user units." "這個套件沒有使用者單元。"
  fi
  bindir="$HOME/.local/bin"
  datadir="$HOME/.local/share/scdo-agent"
  confdir="$HOME/.config/scdo-agent"
  unitdir="$HOME/.config/systemd/user"
  mkdir -p "$bindir" "$datadir" "$confdir" "$unitdir"
  chmod 0700 "$datadir" "$confdir"
  install -m 0755 "$unpack/scdo-agent" "$bindir/scdo-agent"
  for unit in scdo-agent@.service scdo-agent-update.service scdo-agent-update.timer scdo-agent-boot.service; do
    install -m 0644 "$unpack/systemd-user/$unit" "$unitdir/$unit"
  done
  printf 'user\n' > "$datadir/install-scope"
  chmod 0644 "$datadir/install-scope"
  unit_failed=0
  if ! command -v systemctl >/dev/null 2>&1; then
    say "systemctl is not installed. The user units were copied but not started." "未安裝 systemctl。使用者單元已複製，但沒有啟動。" >&2
  elif ! systemctl --user show-environment >/dev/null 2>&1; then
    say "systemctl --user cannot reach the user service manager, so the units were not started." "systemctl --user 連不到使用者服務管理員，所以沒有啟動單元。" >&2
    unit_failed=1
  elif ! systemctl --user daemon-reload; then
    user_unit_hint scdo-agent-update.timer
    unit_failed=1
  else
    if ! systemctl --user enable --now scdo-agent-update.timer || ! systemctl --user is-active --quiet scdo-agent-update.timer; then
      user_unit_hint scdo-agent-update.timer
      unit_failed=1
    fi
    if ! systemctl --user enable scdo-agent-boot.service; then
      user_unit_hint scdo-agent-boot.service
      unit_failed=1
    fi
    # status=218/CAPABILITIES is decided before ExecStart. A missing agent
    # name is a later process exit, so only the capabilities result is a
    # failed probe. Stop the probe so it is not left restarting.
    probe=scdo-agent@install-check.service
    systemctl --user reset-failed "$probe" 2>/dev/null || true
    if ! systemctl --user start "$probe"; then
      probe_result=$(systemctl --user show -p Result --value "$probe" 2>/dev/null || true)
      probe_code=$(systemctl --user show -p ExecMainStatus --value "$probe" 2>/dev/null || true)
      if [ "$probe_result" = "capabilities" ] || [ "$probe_code" = "218" ]; then
        user_unit_hint "$probe"
        unit_failed=1
      fi
    fi
    systemctl --user stop "$probe" 2>/dev/null || true
    systemctl --user reset-failed "$probe" 2>/dev/null || true
    for meta in "$datadir"/*/meta.json; do
      [ -f "$meta" ] || continue
      name=$(basename "$(dirname "$meta")")
      agent_unit="scdo-agent@${name}.service"
      if ! systemctl --user enable --now "$agent_unit" || ! systemctl --user is-active --quiet "$agent_unit"; then
        user_unit_hint "$agent_unit"
        unit_failed=1
      fi
    done
  fi
  if [ -x /usr/bin/scdo-agent ] || [ -f /lib/systemd/system/scdo-agent@.service ] || [ -f /usr/lib/systemd/system/scdo-agent@.service ]; then
    say "A system install is present. An agent name enabled there is not started again by this user install." "已經有系統安裝。在那邊啟用的代理名稱，這個使用者安裝不會再啟動一次。"
  fi
  say "Installed scdo-agent ${VERSION} (${arch}) for ${USER:-the current user}." "已為 ${USER:-目前的使用者} 安裝 scdo-agent ${VERSION}（${arch}）。"
  say "Binary: $bindir/scdo-agent" "執行檔：$bindir/scdo-agent"
  say "Data: $datadir" "資料：$datadir"
  say "" ""
  say "Next:" "下一步："
  say "  scdo-agent --data-dir $datadir init --name <name> --payout 0x<address>" "  scdo-agent --data-dir $datadir init --name <名稱> --payout 0x<地址>"
  say "  systemctl --user enable --now scdo-agent@<name>.service" "  systemctl --user enable --now scdo-agent@<名稱>.service"
  say "  scdo-agent --data-dir $datadir status --name <name>" "  scdo-agent --data-dir $datadir status --name <名稱>"
  say "  scdo-agent upgrade-now" "  scdo-agent upgrade-now"
  say "" ""
  linger_user=${USER:-$(id -un)}
  say "To keep the user services running after logout:" "登出後若要讓使用者服務繼續執行："
  say "  loginctl enable-linger ${linger_user}" "  loginctl enable-linger ${linger_user}"
  say "Several agents: repeat init with another --name and enable the matching user unit." "多個代理：用另一個 --name 再執行 init，並啟用對應的使用者單元。"
  say "A daily user timer checks the signed release feed. upgrade-now is the same command and does not need root." "每日使用者計時器會檢查簽章後的發布檔。upgrade-now 是同一條命令，不需要 root。"
  exit "$unit_failed"
fi

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
  printf 'system\n' > /var/lib/scdo-agent/install-scope
  chown scdo-agent:scdo-agent /var/lib/scdo-agent/install-scope
  if command -v systemctl >/dev/null 2>&1; then
    systemctl daemon-reload || true
    if ! systemctl enable --now scdo-agent-update.timer || ! systemctl is-active --quiet scdo-agent-update.timer; then
      say "The update timer is not active. Check: systemctl status scdo-agent-update.timer" "更新計時器沒有處於執行中。請檢查：systemctl status scdo-agent-update.timer" >&2
      systemctl status scdo-agent-update.timer --no-pager -l >&2 || true
    fi
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
say "Without root, run: sh install.sh --user" "沒有 root 時，請執行：sh install.sh --user"
