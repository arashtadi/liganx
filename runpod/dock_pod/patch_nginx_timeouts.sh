#!/usr/bin/env bash
# (J9) Persistently patch nginx's port-7861 server block to allow
# 14-hour proxy reads.
#
# Why: nginx ships with proxy_read_timeout 60s. A single FEP edge
# can take 10+ minutes (longer in production protocols), so the
# default trips a 504 Gateway Timeout long before the pod returns
# the ΔΔG result. We live-patched this during the J8 debug session;
# this script makes the patch idempotent + automatic on every boot.
#
# Targets /etc/nginx/nginx.conf which is the RunPod image's main
# config. We grep for the marker phrase 'proxy_read_timeout 14h'
# to detect a prior patch — if present, the script is a no-op.
# Otherwise we use a sed insertion right after the
# 'proxy_pass http://localhost:7860;' line that fronts dock_server.
#
# This script is safe to run multiple times. It backs up the current
# nginx.conf to /etc/nginx/nginx.conf.bak_$(timestamp) before any
# mutation.

set -u
NGINX_CONF=/etc/nginx/nginx.conf

if [ ! -w "$NGINX_CONF" ]; then
  echo "patch_nginx_timeouts: $NGINX_CONF not writable — skipping"
  exit 0
fi

if grep -q 'proxy_read_timeout 14h' "$NGINX_CONF"; then
  echo "patch_nginx_timeouts: nginx already has proxy_read_timeout 14h — no-op"
  exit 0
fi

BAK="${NGINX_CONF}.bak_$(date +%Y%m%d_%H%M%S)"
cp "$NGINX_CONF" "$BAK"
echo "patch_nginx_timeouts: backed up to $BAK"

# Use the same Python approach as the live patch — sed alone struggles
# with the multi-line server { ... location / { ... proxy_pass } }
# match. Python's re.sub with DOTALL is more reliable.
python3 - <<'PY'
import re
p = "/etc/nginx/nginx.conf"
txt = open(p).read()
new = re.sub(
    r'(listen 7861;\s*\n\s*location / \{[^}]*?proxy_pass http://localhost:7860;)',
    r'\1\n            proxy_read_timeout 14h;\n            proxy_send_timeout 14h;\n            proxy_connect_timeout 60s;',
    txt,
    count=1,
    flags=re.DOTALL,
)
if new == txt:
    print("patch_nginx_timeouts: NO MATCH — listen 7861 block not found")
else:
    open(p, "w").write(new)
    print("patch_nginx_timeouts: patched")
PY

if nginx -t 2>&1 | grep -q 'syntax is ok'; then
    nginx -s reload && echo "patch_nginx_timeouts: nginx reloaded"
else
    echo "patch_nginx_timeouts: nginx -t FAILED — rolling back"
    cp "$BAK" "$NGINX_CONF"
    nginx -t
fi
