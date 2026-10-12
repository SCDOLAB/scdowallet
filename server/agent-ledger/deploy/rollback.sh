#!/bin/bash
set -e; B=/root/backups/agent-ledger-20261012; CONF=${CONF:-/etc/nginx/conf.d/scan.conf}
cp -a $B/scan.conf.orig "$CONF"; nginx -t && systemctl reload nginx
systemctl disable --now scdo-agent-ledger || true; rm -f /etc/systemd/system/scdo-agent-ledger.service /etc/nginx/staged/agent-ledger.locations.conf; systemctl daemon-reload
rm -rf /usr/share/nginx/agent-ledger; [ -d $B/agent-ledger ] && cp -a $B/agent-ledger /usr/share/nginx/ || true
echo "rolled back (data kept in /var/lib/scdo-agent-ledger)"
