#!/bin/bash
# Copies the shard0 miner binaries (core-geth + scdo-stratum) and genesis into miner-bin/.
# Source: the GPU-miner package build dir (latest fixes from the gpu-mining worker).
set -euo pipefail
SRC=${MINER_PKG:-/workspace/gpu/pkg}
cd "$(dirname "$0")/.."
mkdir -p miner-bin/win32 miner-bin/linux
cp "$SRC/win/scdo-shard0-gpu-miner/bin/geth.exe" "$SRC/win/scdo-shard0-gpu-miner/bin/scdo-stratum.exe" miner-bin/win32/
cp "$SRC/linux/scdo-shard0-gpu-miner/bin/geth" "$SRC/linux/scdo-shard0-gpu-miner/bin/scdo-stratum" miner-bin/linux/
cp "$SRC/win/scdo-shard0-gpu-miner/scdo-shard0-genesis.json" miner-bin/
chmod +x miner-bin/linux/*
( cd miner-bin && sha256sum win32/* linux/* scdo-shard0-genesis.json > SHA256SUMS && cat SHA256SUMS )
