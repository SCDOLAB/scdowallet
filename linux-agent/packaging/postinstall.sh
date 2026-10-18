#!/bin/sh
# Create the service user and the data root. Never remove keys on upgrade.
set -eu
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
