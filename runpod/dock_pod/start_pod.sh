#!/usr/bin/env bash
# (J9) Single entry-point that boots the entire pod-side stack on
# container start: fep_server in the background, then dock_server
# in the foreground. Configure this as the pod's "Container start
# command" in RunPod so a reboot (planned or otherwise) brings
# everything back without manual intervention.
#
# Order matters:
#   1. start_fep_server.sh handles its own nginx patch + dep checks
#      + spawns fep_server in the background (returns immediately).
#   2. start_dock_server.sh execs uvicorn dock_server in the
#      foreground — this is the pod's main process; if it exits,
#      the container restarts.
#
# Don't `set -e` here: fep_server failures shouldn't kill dock_server.
# Each layer logs to its own file so failures are diagnosable
# without coupling.

LOG=/workspace/start_pod.log
{
  echo "=== $(date -u) START start_pod.sh ==="

  # ── 1. fep_server (background, returns immediately) ────────────
  if [ -x /workspace/start_fep_server.sh ]; then
    echo "  -> bash /workspace/start_fep_server.sh"
    bash /workspace/start_fep_server.sh
  else
    echo "  WARNING: /workspace/start_fep_server.sh missing — FEP+ will be unavailable"
  fi

  # ── 2. dock_server (foreground, blocks) ────────────────────────
  if [ -x /workspace/start_dock_server.sh ]; then
    echo "  -> exec bash /workspace/start_dock_server.sh"
    exec bash /workspace/start_dock_server.sh
  else
    echo "  FATAL: /workspace/start_dock_server.sh missing — pod cannot serve docking"
    exit 1
  fi
} >> "$LOG" 2>&1
