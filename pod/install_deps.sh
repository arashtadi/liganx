#!/bin/bash
# Idempotent system + Python deps for the dock_server.
# Sourced from start_dock_server.sh on every boot. Self-heals after
# a container rebuild. Skips if already installed (~1s on warm boot).
set -u
LOG=/workspace/dock_server_boot.log
echo "==== $(date -Is) install_deps.sh ====" >> "$LOG"
NEED=0
for pkg in libboost-program-options1.74.0 libboost-filesystem1.74.0 libboost-thread1.74.0; do
    dpkg -s "$pkg" >/dev/null 2>&1 || NEED=1
done
if [ "$NEED" = "1" ]; then
    apt-get update >> "$LOG" 2>&1
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        libboost-program-options1.74.0 \
        libboost-filesystem1.74.0 \
        libboost-thread1.74.0 >> "$LOG" 2>&1
fi
python3 -m pip install --quiet --no-warn-script-location \
    fastapi uvicorn pydantic >> "$LOG" 2>&1 || true
