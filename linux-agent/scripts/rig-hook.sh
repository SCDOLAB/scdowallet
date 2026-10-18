#!/bin/sh
# Install scdo-agent when the binary is missing, then run upgrade-now.
# The Classic node upgrader lives outside this repository and is not modified.
# Point that upgrader, or an rtty push, at this script after its own work.
set -eu

if [ "$(id -u)" -ne 0 ]; then
  if command -v sudo >/dev/null 2>&1; then
    exec sudo "$0" "$@"
  fi
  echo "Run this script as root." >&2
  exit 1
fi

if ! command -v scdo-agent >/dev/null 2>&1; then
  tmp=$(mktemp)
  url="https://scdo.com.au/downloads/wallet/linux/install.sh"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL -o "$tmp" "$url"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O "$tmp" "$url"
  else
    echo "curl or wget is required." >&2
    exit 1
  fi
  sh "$tmp"
  rm -f "$tmp"
fi

exec scdo-agent upgrade-now
