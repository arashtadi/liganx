#!/usr/bin/env bash
# GNINA pod diagnostic + remediation script.
#
# Context: 2026-05-05 the editor's "🧠 GNINA" cross-validation button
# tried to dispatch GNINA with cnn_mode=rescore. The /dock_gnina endpoint
# accepted the request and ran gnina, but gnina's CNN inference SIGABRTed
# inside TVM-compiled CUDA kernels:
#
#   gnina rc=-6: float tweight_7_1 = __ldg(tweight_7 + ...)
#   ...batch_norm kernel offset arithmetic...
#
# The Vina-flavor docking part of gnina (cnn_mode=none) WORKS — confirmed
# by Fly-side curl. The crash is specifically in the CNN rescoring path.
# Most likely cause: GNINA v1.3's bundled TVM kernels weren't compiled
# for the pod's GPU architecture (RTX PRO 4500). This script discovers
# the actual GPU + compute capability, tries alternative CNN models that
# use simpler architectures (less TVM-aggressive), and if none work,
# rebuilds GNINA from source against the pod's local CUDA.
#
# Run this in the RunPod web terminal of the production pod
# (pod id 4cli33cxvf58lb on RunPod). Steps are idempotent — you can
# re-run from any point. Output is verbose so you can copy-paste back
# into a chat for diagnosis.

set -u  # die on unset variables
# NOT set -e — we want to keep going past failed steps to gather info

LOG="/tmp/gnina_diagnostic_$(date +%s).log"
exec > >(tee -a "$LOG") 2>&1
echo "==============================================================="
echo "GNINA POD DIAGNOSTIC — $(date)"
echo "Pod: $(hostname)  |  Log: $LOG"
echo "==============================================================="

# ── Step 1: GPU + CUDA info ────────────────────────────────────────────
echo
echo "── Step 1: GPU + CUDA discovery ──"
nvidia-smi --query-gpu=name,driver_version,memory.total,compute_cap --format=csv 2>&1 | head -5
echo
echo "Detected compute capability:"
COMPUTE_CAP=$(nvidia-smi --query-gpu=compute_cap --format=csv,noheader | head -1 | tr -d ' .')
echo "  sm_${COMPUTE_CAP}"
echo
echo "CUDA toolkit on PATH:"
nvcc --version 2>&1 | tail -3 || echo "  nvcc not on PATH (using runtime CUDA only)"

# ── Step 2: GNINA binary inspection ───────────────────────────────────
echo
echo "── Step 2: existing gnina binary ──"
GNINA_BIN=$(command -v gnina 2>/dev/null || echo "/usr/local/bin/gnina")
echo "Path: $GNINA_BIN"
ls -la "$GNINA_BIN" 2>&1 | head -2
echo
echo "Version + linkage:"
"$GNINA_BIN" --version 2>&1 | head -3
echo
echo "Compute capabilities baked into binary (cuobjdump, if available):"
cuobjdump --list-elf "$GNINA_BIN" 2>&1 | head -10 || echo "  (cuobjdump not installed — skip)"

# ── Step 3: Reproduce the failing CNN crash ───────────────────────────
echo
echo "── Step 3: reproduce the rc=-6 crash with default CNN ──"
# Build a minimal in-pocket test case using a cached kras receptor.
TEST_DIR=$(mktemp -d)
RECEPTOR="$TEST_DIR/receptor.pdbqt"
LIGAND="$TEST_DIR/ligand.pdbqt"
OUT="$TEST_DIR/out.pdbqt"

# Use any cached receptor — same path the runner writes to.
RECEPTOR_SRC=""
for candidate in /workspace/poses/cache/receptors/4OBE*.pdbqt /var/lib/liganx/poses/cache/receptors/4OBE*.pdbqt /tmp/4OBE*.pdbqt; do
  if [ -f "$candidate" ]; then RECEPTOR_SRC="$candidate"; break; fi
done
if [ -z "$RECEPTOR_SRC" ]; then
  # No cached receptor — generate a tiny synthetic receptor (one Cα atom).
  cat > "$RECEPTOR" <<'EOF'
ATOM      1  CA  GLY A   1      33.000   1.000  17.000  1.00  0.00           C
END
EOF
  echo "  Using synthetic 1-atom receptor (no cached production receptor found)"
else
  cp "$RECEPTOR_SRC" "$RECEPTOR"
  echo "  Using cached receptor: $RECEPTOR_SRC"
fi

# 2-atom test ligand.
cat > "$LIGAND" <<'EOF'
REMARK  Smoke test ligand
ROOT
ATOM      1  C   LIG     1      33.000   1.000  17.000  0.00  0.00     0.000 C
ATOM      2  C   LIG     1      34.000   1.000  17.000  0.00  0.00     0.000 C
ENDROOT
TORSDOF 0
EOF

run_gnina() {
  local label="$1"; shift
  echo
  echo "  -- $label --"
  timeout 60 "$GNINA_BIN" \
    --receptor "$RECEPTOR" --ligand "$LIGAND" --out "$OUT" \
    --center_x 33 --center_y 1 --center_z 17 \
    --size_x 22 --size_y 22 --size_z 22 \
    --seed 42 --num_modes 3 --exhaustiveness 4 \
    "$@" 2>&1 | tail -20
  echo "  rc=$?"
}

run_gnina "cnn_scoring=none (control)" --cnn_scoring none
run_gnina "cnn_scoring=rescore default model (FAILING CASE)" --cnn_scoring rescore

# ── Step 4: Try alternative CNN models ────────────────────────────────
echo
echo "── Step 4: try alternative CNN models ──"
echo "(If any of these succeed, we'll change the default in our endpoint patch.)"

# Built-in models that ship with gnina v1.3:
#   default              — ensemble of 5 fused models (most TVM-heavy)
#   crossdock_default2018, general_default2018, redock_default2018
#   dense, dense_3      — DenseNet-style, simpler kernels
#   fast                — minimal arch
for model in dense fast crossdock_default2018 general_default2018 redock_default2018; do
  run_gnina "cnn_scoring=rescore --cnn $model" --cnn_scoring rescore --cnn "$model"
done

# ── Step 5: rebuild from source (only if all above failed) ────────────
echo
echo "── Step 5: rebuild GNINA from source (skip if any model above worked) ──"
echo "Targeting compute capability sm_${COMPUTE_CAP}."
echo
echo "If you want to proceed with a from-source build, run:"
cat <<'EOF'
  apt-get update && apt-get install -y --no-install-recommends \
      git build-essential cmake libboost-all-dev libeigen3-dev \
      swig zlib1g-dev libatlas-base-dev wget
  # Pin CUDA arch from Step 1 — replace 86 below if compute_cap differs.
  export CMAKE_CUDA_ARCHITECTURES=89
  cd /workspace
  git clone --depth 1 --branch v1.3 https://github.com/gnina/gnina.git gnina-src
  cd gnina-src && mkdir build && cd build
  cmake -DCMAKE_BUILD_TYPE=Release ..
  make -j$(nproc)
  # Replace the system binary:
  cp gnina /usr/local/bin/gnina
  /usr/local/bin/gnina --version
EOF

echo
echo "==============================================================="
echo "DONE — Log written to $LOG"
echo "Paste the log back to triage. Key things to look for:"
echo "  - Step 3 'cnn_scoring=rescore default' — should reproduce rc=-6"
echo "  - Step 4 'cnn_scoring=rescore --cnn <model>' — any rc=0 wins"
echo "  - Step 1 compute_cap — confirms which sm_XX we need"
echo "==============================================================="
