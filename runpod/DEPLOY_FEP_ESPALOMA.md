# Deploy the Espaloma FEP tier (Tier 2 / Standard)

**Status: code prepared 2026-05-16. Sibling conda env NOT yet built on
the pod.** This runbook covers what's left: provisioning a sibling
conda env on the existing dock pod, dropping the new server in, and
verifying it without touching the running Sage (Tier 1) stack.

## Why a sibling env rather than upgrading the existing one

K1's dry-run (2026-05-16) showed that adding `espaloma` to the existing
`/workspace/miniconda3/envs/fep/` env would force:

- **pytorch 2.8.0-cuda129 → 2.3.1-cpu_mkl** (loses CUDA entirely)
- **libtorch 2.8.0-cuda129 → 2.3.1-cpu_mkl** (loses CUDA)
- **numpy 2.4.5 → 1.26.4** (major version downgrade — ABI risk for
  openmm / openff-toolkit compiled extensions)
- **jaxlib 0.9.0-cuda129 → 0.4.31-cuda120** (older CUDA jaxlib)
- mkl 2025.3.1 → 2023.2.0, plus 11 supporting library downgrades

A live FEP study (`Qiwf3Y12Sso`, FEP #16) was running in that env at
investigation time, and the user constraint is "don't break docking /
existing FEP". So the safer path is:

- Sage tier stays in `/workspace/miniconda3/envs/fep/` untouched
- Espaloma tier gets its own `/workspace/miniconda3/envs/fep_espaloma/`
- Two separate uvicorn servers on different ports (Sage 7862, Espaloma 7863)
- Backend dispatcher (K4) picks which one based on `force_field_engine`

Both servers share the same GPU. They never run simultaneously because
each FEP edge takes the whole GPU; the backend serializes dispatch.

## What this runbook gets you

1. A sibling conda env on the existing dock pod (no new pod needed).
2. A second uvicorn server on port 7863 serving the Espaloma tier.
3. End-to-end smoke verification that the Sage tier still works
   afterwards.

Estimated operator time: ~45 minutes (conda solve + install is the bulk).

## Prerequisites

- SSH or web-terminal access to the existing dock pod (the one with the
  Sage env at `/workspace/miniconda3/envs/fep/`).
- `POD_SHARED_SECRET` already set in the pod's environment.
- `start_fep_server.sh` (Sage tier boot) already in `/workspace/`.
- Disk: this adds ~6 GB to `/workspace/miniconda3/envs/`. Verify with
  `df -h /workspace` first.

## Steps

### 1. Pull the new pod files from GitHub

```bash
cd /workspace
GH_RAW=https://raw.githubusercontent.com/arashtadi/liganx/main/runpod/dock_pod
curl -sS -L -o fep_pod_espaloma.py        "$GH_RAW/fep_pod_espaloma.py"
curl -sS -L -o fep_espaloma_server.py     "$GH_RAW/fep_espaloma_server.py"
curl -sS -L -o start_fep_espaloma_server.sh "$GH_RAW/start_fep_espaloma_server.sh"
chmod +x start_fep_espaloma_server.sh
ls -la fep_pod_espaloma.py fep_espaloma_server.py start_fep_espaloma_server.sh
```

### 2. Snapshot the existing Sage env (rollback insurance)

Already done by K1 — verify the snapshot file exists:

```bash
ls -la /workspace/fep_env_snapshot_*.txt
```

If it's missing for some reason, capture a fresh one:

```bash
source /workspace/miniconda3/etc/profile.d/conda.sh
conda list -n fep --explicit > /workspace/fep_env_snapshot_$(date +%Y%m%d_%H%M%S).txt
```

### 3. Create the sibling env (~20–30 min)

```bash
source /workspace/miniconda3/etc/profile.d/conda.sh
conda create -n fep_espaloma -y --override-channels -c conda-forge \
    python=3.11 \
    openfe openmm openmmtools openff-toolkit \
    openff-interchange openmmforcefields \
    espaloma \
    ambertools pdbfixer pymbar lomap2 \
    fastapi uvicorn pydantic \
    2>&1 | tee /workspace/fep_espaloma_install.log
```

Note: conda may take 5–10 min just to solve the env, then 15–20 min
to download + extract packages. Total ~30 min is normal.

**If the solver fails** with an UnsatisfiableError mentioning espaloma:
try forcing the older pinned versions known to coexist:

```bash
conda create -n fep_espaloma -y --override-channels -c conda-forge \
    python=3.11 \
    "openfe>=1.0,<1.12" "openmm>=8.0,<8.5" openmmtools \
    "openff-toolkit>=0.16,<0.17" \
    openff-interchange "openmmforcefields>=0.14" \
    "espaloma=0.3.2" \
    ambertools pdbfixer pymbar lomap2 \
    fastapi uvicorn pydantic
```

### 4. Smoke-test the sibling env (no real edge yet)

```bash
source /workspace/miniconda3/etc/profile.d/conda.sh
conda activate fep_espaloma
python -c "
import openfe, openmm, openmmtools, pymbar, espaloma, openmmforcefields
from openff.toolkit import Molecule
print('openfe', openfe.__version__)
print('openmm', openmm.__version__)
print('espaloma', espaloma.__version__)
print('openmmforcefields imported OK')
print('all imports OK')
"
```

All five lines should print. If anything errors, fix that import before
moving on — don't try to launch the server with a broken env.

### 5. Confirm the Sage tier still works

This is the load-bearing safety check. The whole point of the sibling
approach is that this step is trivially true.

```bash
source /workspace/miniconda3/etc/profile.d/conda.sh
conda activate fep
python -c "
import openfe
from openff.toolkit import Molecule
print('Sage env still has openfe', openfe.__version__)
"
curl -s http://localhost:7862/health | python -c "import sys,json;print(json.load(sys.stdin))"
```

Expected: openfe version matches what it was before, `/health` returns
`{"ok": true, "deps_ok": true}`. If either differs, stop and roll back
the sibling env (`conda env remove -n fep_espaloma`).

### 6. Launch the Espaloma server

```bash
bash /workspace/start_fep_espaloma_server.sh
sleep 3
cat /workspace/fep_espaloma_server_boot.log | tail -30
curl -s http://localhost:7863/health | python -c "import sys,json;print(json.load(sys.stdin))"
```

Expected `/health` response:

```json
{"ok": true, "service": "fep_espaloma_server",
 "version": "0.1", "engine": "espaloma", "deps_ok": true}
```

If `deps_ok` is false, re-run the import smoke test in step 4 against
`fep_espaloma` to see which package failed.

### 7. Quick ligand-parameterization test (no full edge)

This confirms espaloma's GNN parameterizer is wired into openmmforcefields:

```bash
source /workspace/miniconda3/etc/profile.d/conda.sh
conda activate fep_espaloma
python -c "
from openff.toolkit import Molecule
from openmmforcefields.generators import EspalomaTemplateGenerator
mol = Molecule.from_smiles('COc1cc(N(C)CCN(C)C)c(NC(=O)C=C)cc1Nc1nccc(-c2cn(C)c3ccccc23)n1')
mol.assign_partial_charges('zeros')  # placeholder; espaloma assigns its own
gen = EspalomaTemplateGenerator(molecules=[mol], forcefield='espaloma-0.3.2')
print('EspalomaTemplateGenerator built for osimertinib OK')
print('atoms:', mol.n_atoms)
"
```

First run downloads the Espaloma 0.3.2 torchscript model (~50 MB) into
`~/.cache/openmm-forcefields/`. Subsequent runs use the cache.

### 8. Tiny end-to-end edge (~30 min — OPTIONAL but recommended)

A 4-window × 0.5 ns mock-physics edge to verify the full pipeline:

```bash
# Get a published osimertinib + EGFR T790M test pair from the repo
GH_RAW=https://raw.githubusercontent.com/arashtadi/liganx/main/runpod/dock_pod
curl -sS -L -o /tmp/test_receptor.pdb     "$GH_RAW/test_receptor_kras.pdb"
# Inline minimal SDFs for the smoke test
python -c "
from openff.toolkit import Molecule
m = Molecule.from_smiles('CCO')
m.generate_conformers(n_conformers=1)
m.to_file('/tmp/lig_a.sdf', file_format='sdf')
m = Molecule.from_smiles('CCC')
m.generate_conformers(n_conformers=1)
m.to_file('/tmp/lig_b.sdf', file_format='sdf')
"
# Build the request
python <<'PY'
import json, urllib.request
body = {
  "receptor_pdb": open("/tmp/test_receptor.pdb").read(),
  "ligand_a_sdf": open("/tmp/lig_a.sdf").read(),
  "ligand_b_sdf": open("/tmp/lig_b.sdf").read(),
  "n_lambda_windows": 4,
  "ns_per_window": 0.5,
  "ns_equilibration": 0.1,
}
req = urllib.request.Request(
  "http://localhost:7863/fep_edge_start",
  data=json.dumps(body).encode(),
  headers={"Content-Type": "application/json"},
)
print(urllib.request.urlopen(req).read().decode())
PY
```

Poll status every minute:

```bash
JOB_ID=<copy from previous output>
while true; do
  curl -s "http://localhost:7863/fep_edge_status/$JOB_ID" | python -m json.tool | head -10
  echo '---'
  sleep 60
done
```

Stop the poll loop with Ctrl-C once `status: "done"` appears.

### 9. (Future / K4) Wire into `start_pod.sh`

NOT IN K2 — leave `start_pod.sh` unchanged until the manual test above
passes. K4 will append `bash /workspace/start_fep_espaloma_server.sh`
between the existing Sage launch and the dock-server exec.

## Rollback

If anything regresses or the sibling env behaves badly:

```bash
# Stop the Espaloma server (Sage is unaffected)
pkill -f 'fep_espaloma_server:app'

# Remove the sibling env
conda env remove -n fep_espaloma -y

# Optionally remove the pod files (they're harmless if left)
rm /workspace/fep_pod_espaloma.py /workspace/fep_espaloma_server.py
rm /workspace/start_fep_espaloma_server.sh
```

The Sage tier on port 7862 is unaffected by every operation here.

## Verification checklist

After completing the runbook:

- [ ] `df -h /workspace` shows the env consumed ~6 GB (sanity check)
- [ ] `curl http://localhost:7862/health` still reports `deps_ok: true`
      (Sage unaffected)
- [ ] `curl http://localhost:7863/health` reports `deps_ok: true`
      (Espaloma alive)
- [ ] `pgrep -f fep_server:app` returns one pid (Sage)
- [ ] `pgrep -f fep_espaloma_server:app` returns one pid (Espaloma)
- [ ] The running Sage FEP study (`Qiwf3Y12Sso` at K2 start) is still
      making progress — check `/workspace/fep_jobs/<job_id>.json`
