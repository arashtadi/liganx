#!/usr/bin/env bash
# (K2) Boot script for the Espaloma-tier FEP server. Sibling of
# start_fep_server.sh — same idempotent pattern, but targets:
#
#   conda env:  /workspace/miniconda3/envs/fep_espaloma/
#   uvicorn:    fep_espaloma_server:app on port 7863
#   log:        /workspace/fep_espaloma_server_boot.log
#
# ABSOLUTELY DOES NOT TOUCH the existing fep env, fep_server.py, or
# fep_pod.py. The Sage tier is unaffected by every line of this script.
#
# What this script does on each pod boot:
#   1. Ensure the Espaloma-tier _pod files exist on /workspace
#      (curl from GitHub raw if missing).
#   2. Verify the sibling conda env exists. If not — log a clear
#      message + exit 0 (this is a non-fatal warning; the Sage tier
#      keeps working).
#   3. Sanity-check antechamber inside the sibling env.
#   4. Start fep_espaloma_server uvicorn in the background.
#
# NOT YET wired into start_pod.sh — that comes in K4 after the env is
# verified end-to-end. For now the operator runs this manually after
# `conda create -n fep_espaloma ...`.

LOG=/workspace/fep_espaloma_server_boot.log
CONDA_ENV_DIR=/workspace/miniconda3/envs/fep_espaloma
CONDA_BIN=$CONDA_ENV_DIR/bin
GH_RAW=https://raw.githubusercontent.com/arashtadi/liganx/main/runpod/dock_pod

{
  echo "=== $(date -u) START fep_espaloma_server bootstrap ==="

  # ── 1. Ensure Espaloma-tier _pod files are present ─────────────
  for f in fep_pod_espaloma.py fep_espaloma_server.py; do
    if [ ! -f "/workspace/$f" ]; then
      echo "  /workspace/$f missing — fetching from GitHub"
      curl -sS -L -o "/workspace/$f" "$GH_RAW/$f"
    fi
  done

  # ── 2. Sibling conda env existence check ───────────────────────
  if [ ! -d "$CONDA_ENV_DIR" ]; then
    echo "  WARNING: $CONDA_ENV_DIR not found — Espaloma tier is unavailable."
    echo "  To install: run K2's conda create on the pod (see DEPLOY_FEP_ESPALOMA.md)."
    echo "  The Sage tier on port 7862 is unaffected."
    echo "=== fep_espaloma_server bootstrap done (skipped — env missing) ==="
    exit 0
  fi

  # ── 3. AmberTools sanity check inside the sibling env ──────────
  if [ ! -x "$CONDA_BIN/antechamber" ]; then
    echo "  antechamber not found in $CONDA_BIN — installing ambertools"
    source /workspace/miniconda3/etc/profile.d/conda.sh
    conda activate fep_espaloma
    conda install -y --override-channels -c conda-forge ambertools \
      2>&1 | tail -3
  else
    echo "  antechamber present at $CONDA_BIN/antechamber"
  fi

  # ── 4. Start fep_espaloma_server in the background ─────────────
  if pgrep -f 'fep_espaloma_server:app' >/dev/null; then
    echo "  fep_espaloma_server already running — skipping launch"
  else
    echo "  starting fep_espaloma_server on :7863"
    cd /workspace
    nohup "$CONDA_BIN/uvicorn" fep_espaloma_server:app \
      --host 0.0.0.0 --port 7863 \
      >> "$LOG" 2>&1 < /dev/null &
    disown
    sleep 2
    if pgrep -f 'fep_espaloma_server:app' >/dev/null; then
      echo "  fep_espaloma_server launched, pid=$(pgrep -f 'fep_espaloma_server:app')"
    else
      echo "  WARNING: fep_espaloma_server failed to start — see $LOG"
    fi
  fi

  echo "=== fep_espaloma_server bootstrap done ==="
} >> "$LOG" 2>&1
