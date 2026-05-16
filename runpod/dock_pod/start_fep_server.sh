#!/usr/bin/env bash
# (J9) Boot script for fep_server (the conda-isolated FEP+ runtime
# running on localhost:7862). Idempotent — safe to re-run on each
# pod boot. The pod's persistent /workspace volume survives reboots,
# so most files are already there; this script's job is to:
#
#   1. Make sure all heavy _pod.py files exist on /workspace (curl
#      latest from GitHub raw if missing).
#   2. Verify ambertools is installed in the conda env; install if
#      not (covers the case where a pod is rebuilt from a thinner
#      base image).
#   3. Patch nginx's proxy_read_timeout to 14 h so long FEP edges
#      don't trip the default 60s gateway timeout (J9 follow-up to
#      the live patch we applied during the J8 debug session).
#   4. Spawn fep_server uvicorn in the background, writing its log
#      to /workspace/fep_server_boot.log. Returns immediately so
#      start_dock_server.sh can take over in the foreground.
#
# Deploy: this script lives at /workspace/start_fep_server.sh on
# the pod (curl from github.com/arashtadi/liganx).
#
# Why no `set -e`: we WANT to push through individual failures —
# if one curl fails or ambertools is already installed, we still
# want to launch fep_server. Each step logs its own outcome.

LOG=/workspace/fep_server_boot.log
CONDA_BIN=/workspace/miniconda3/envs/fep/bin
GH_RAW=https://raw.githubusercontent.com/arashtadi/liganx/main/runpod/dock_pod

{
  echo "=== $(date -u) START fep_server bootstrap ==="

  # ── 1. Ensure all _pod.py files are present ────────────────────
  # If any are missing (e.g. fresh pod, thinner image), curl from
  # the public GitHub raw URL. Idempotent — only touches files that
  # don't exist OR are older than 1 hour (so we pick up hot fixes
  # without forcing a full re-pull every boot).
  for f in fep_pod.py fep_server.py admet_pod.py esm2_pod.py \
           ensemble_pod.py mmgbsa_pod.py dock_server.py; do
    if [ ! -f "/workspace/$f" ]; then
      echo "  /workspace/$f missing — fetching from GitHub"
      curl -sS -L -o "/workspace/$f" "$GH_RAW/$f"
    fi
  done

  # ── 2. AmberTools sanity check ─────────────────────────────────
  # openff-toolkit's AmberToolsToolkitWrapper does a runtime which-
  # antechamber check. If antechamber binary isn't in the conda env's
  # bin/, install ambertools (idempotent — conda is fast to no-op).
  if [ ! -x "$CONDA_BIN/antechamber" ]; then
    echo "  antechamber not found — installing ambertools via conda"
    source /workspace/miniconda3/etc/profile.d/conda.sh
    conda activate fep
    conda install -y --override-channels -c conda-forge ambertools \
      2>&1 | tail -3
  else
    echo "  antechamber present at $CONDA_BIN/antechamber"
  fi

  # ── 3. Patch nginx for long FEP edges (J9 follow-up) ────────────
  # Run the bundled patch script. It's idempotent: bails if the
  # 14h timeout is already in place.
  if [ -x /workspace/patch_nginx_timeouts.sh ]; then
    bash /workspace/patch_nginx_timeouts.sh 2>&1 | sed 's/^/  /'
  fi

  # ── 4. Start fep_server in the background ──────────────────────
  if pgrep -f 'fep_server:app' >/dev/null; then
    echo "  fep_server already running — skipping launch"
  else
    echo "  starting fep_server on :7862"
    cd /workspace
    nohup "$CONDA_BIN/uvicorn" fep_server:app \
      --host 0.0.0.0 --port 7862 \
      >> "$LOG" 2>&1 < /dev/null &
    disown
    sleep 2
    if pgrep -f 'fep_server:app' >/dev/null; then
      echo "  fep_server launched, pid=$(pgrep -f 'fep_server:app')"
    else
      echo "  WARNING: fep_server failed to start — see $LOG"
    fi
  fi

  echo "=== fep_server bootstrap done ==="
} >> "$LOG" 2>&1
