#!/bin/bash
# Run as root on .88 from the unpacked bundle dir. Backs up first; aborts and restores if nginx -t fails.
set -euo pipefail
B=/root/backups/agent-ledger-20261012; CONF=${CONF:-/etc/nginx/conf.d/scan.conf}
mkdir -p $B; cp -a "$CONF" $B/scan.conf.orig; [ -d /usr/share/nginx/agent-ledger ] && cp -a /usr/share/nginx/agent-ledger $B/ || true
cp "$(dirname "$0")/rollback.sh" $B/rollback.sh; chmod 700 $B/rollback.sh
id scdoledger >/dev/null 2>&1 || useradd -r -s /usr/sbin/nologin scdoledger
install -d -o scdoledger -m 750 /var/lib/scdo-agent-ledger
install -d /opt/scdo-agent-ledger /usr/share/nginx/agent-ledger/zh
cp ../server.js ../store.js ../envelope.js ../package.json ../package-lock.json /opt/scdo-agent-ledger/ 2>/dev/null || cp ../server.js ../store.js ../envelope.js ../package.json /opt/scdo-agent-ledger/
(cd /opt/scdo-agent-ledger && npm install --omit=dev --no-audit --no-fund)
cp ../public/index.html /usr/share/nginx/agent-ledger/; cp ../public/zh/index.html /usr/share/nginx/agent-ledger/zh/
cp nginx-agent-ledger.conf /etc/nginx/staged/agent-ledger.locations.conf
cp scdo-agent-ledger.service /etc/systemd/system/; systemctl daemon-reload; systemctl enable --now scdo-agent-ledger
grep -q 'staged/agent-ledger.locations.conf' "$CONF" || sed -i 's#^\(\s*\)include /etc/nginx/staged/cat-ai.locations.conf;.*#&\n\1include /etc/nginx/staged/agent-ledger.locations.conf;   \# agent-ledger v1 2026-10-12#' "$CONF"
if ! nginx -t; then cp -a $B/scan.conf.orig "$CONF"; echo "nginx -t failed; restored"; exit 1; fi
systemctl reload nginx
curl -fsS http://127.0.0.1:8147/api/health && curl -fsS -H 'Host: scdoscan.io' http://127.0.0.1/agent-ledger/ | grep -q 'SCDO Laboratory' && echo APPLIED
