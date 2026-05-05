#!/bin/bash
# Auto-start dock_server on the production GPU pod.
#
# This script lives at /workspace/start_dock_server.sh on the pod (survives
# container restarts because /workspace is the persistent volume) and is
# wired in via RunPod's "dockerStartCmd" (see Edit Pod in the RunPod console:
# `bash /workspace/start_dock_server.sh`). The committed copy in this repo
# is the source of truth; if you edit it here, mirror to the pod with
# `pod/sync_start_script.sh` (or a manual `cat > /workspace/start_dock_server.sh`).
#
# History
# -------
# 2026-05-05a: rewritten to use uvicorn directly. Was using `python
#   dock_server.py` which did nothing (no __main__ block); only worked
#   previously because mambaforge had a custom entrypoint, but mambaforge
#   didn't survive the pod migration to a Blackwell host. System python
#   with `pip install fastapi uvicorn pydantic` is enough.
#
# 2026-05-05b: added idempotent system-dep install. After the migration,
#   the new container was missing libboost_{program_options,filesystem,
#   thread}.so.1.74.0 — QuickVina2-GPU links against those — so the
#   binary failed at load with rc=127 and Quick Dock returned a misleading
#   "compound too large" error. apt installs run on every boot, but
#   they're skipped when the package is already present (dpkg pre-check),
#   so a hot restart is still <1s extra. A cold container rebuild self-
#   heals in ~30s instead of paging on-call.

set -u

LOG=/workspace/dock_server_boot.log
echo "==== $(date -Is) start_dock_server.sh boot ====" >> "$LOG"

# ---- 1. System libraries QuickVina2-GPU links against ------------------
NEED_BOOST=0
for pkg in libboost-program-options1.74.0 libboost-filesystem1.74.0 libboost-thread1.74.0; do
    if ! dpkg -s "$pkg" >/dev/null 2>&1; then
        NEED_BOOST=1
    fi
done
if [ "$NEED_BOOST" = "1" ]; then
    echo "  [boost] installing missing libboost runtime libraries..." >> "$LOG"
    apt-get update >> "$LOG" 2>&1
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        libboost-program-options1.74.0 \
        libboost-filesystem1.74.0 \
        libboost-thread1.74.0 \
        >> "$LOG" 2>&1
fi

# ---- 2. Python deps for the FastAPI dock_server ------------------------
# pip install is fast (1-2s) when the wheel is already cached. Catches
# the case where the container was rebuilt and lost the system-python
# site-packages.
python3 -m pip install --quiet --no-warn-script-location \
    fastapi uvicorn pydantic >> "$LOG" 2>&1 || true

# ---- 3. Sanity check the QuickVina binary can actually load ------------
VINA=/workspace/Vina-GPU-2.1/QuickVina2-GPU-2.1/QuickVina2-GPU-2-1
if [ -x "$VINA" ]; then
    if ! "$VINA" --help >/dev/null 2>&1; then
        echo "  [vina] WARNING: $VINA failed --help (rc=$?)" >> "$LOG"
        ldd "$VINA" 2>&1 | grep -E "boost|not found" >> "$LOG"
    fi
fi

# ---- 4. Launch the FastAPI dock_server ---------------------------------
cd /workspace || exit 1
echo "  [boot] exec uvicorn dock_server:app on :7861" >> "$LOG"
exec uvicorn dock_server:app --host 0.0.0.0 --port 7861 \
    >> /workspace/dock_server.log 2>&1
