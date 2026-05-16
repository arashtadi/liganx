# Deploy the dedicated FEP+ pod

**Status: code merged 2026-05-15, dedicated FEP pod NOT yet provisioned.**
The backend, frontend, DB schema, runner orchestration, and pod-side
Python code are all live in `main`. The remaining operator work is the
~1-day pod build documented here.

## Why a separate pod from the docking pod

Per `docs/fep_plus_design.md` §6 and the user memory `feedback_runpod_caution.md`:

- **Vina cells are ~5-15 seconds each; FEP edges are 8-12 GPU-hours.**
  Running both on the same GPU starves Vina (OpenMM holds GPU memory
  for the duration of the trajectory, hundreds of times longer than
  any single Vina call).
- **MIG GPU partitioning isn't available on consumer Blackwell SKUs.**
  Even if it were, OpenMM's mixed-precision kernels don't behave well
  across MIG instance boundaries.
- **Cost discipline.** A misconfigured pod that runs a 10-edge FEP
  study costs ~$100 of GPU time. We want that to be a deliberate
  decision, not a side effect of normal docking traffic.

The backend's `services/fep_runner.py` reads `POD_FEP_URL` (not
`POD_DOCK_URL`) — a separate Fly secret. Setting them to the same
URL would dispatch FEP work to the docking pod, which is supported
but discouraged.

## What you're deploying

1. **A second RunPod** — Blackwell-class (RTX 4090 or H100 community
   tier). 24 GB GPU memory is the minimum for kinase-sized systems
   with HREX 12 replicas; smaller cards will OOM.
2. **`runpod/dock_pod/fep_pod.py`** — the openfe + OpenMM alchemy.
3. **The `/fep_edge` route** that's already appended to
   `dock_server.py` — same file, just deployed to the FEP pod.
4. **Pinned scientific deps:** openfe, openmmtools, pymbar,
   openff-toolkit, openmmforcefields, openff-interchange, lomap2.
5. **A Fly secret** `POD_FEP_URL` pointing at the new pod.

## Steps (~1 day operator work, mostly waiting for the OpenMM build)

### 1. Provision the pod (~15 min)

Use RunPod's web UI or `runpodctl`:

```bash
# Pick the Blackwell community-cloud option for ~$0.95/hr. H100 if you
# need it faster — 4090-equivalent is enough for kinase systems.
runpodctl create pod \\
    --imageName runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04 \\
    --gpuType "RTX 4090" \\
    --containerDiskInGb 100 \\
    --volumeInGb 50 \\
    --ports "7861/http,22/tcp" \\
    --env POD_SHARED_SECRET=<same-secret-as-docking-pod>
```

### 2. Build OpenMM from source for sm_120 (~3-4 hours wall, mostly waiting)

This is the riskiest step per `docs/fep_plus_design.md` §1. OpenMM 8.2
shipped with sm_100/sm_120 PTX targets but the prebuilt wheel only
includes sm_70-90. Build from source so Blackwell doesn't fall back
to slow PTX-JIT:

```bash
ssh root@<POD_HOST>
cd /workspace && mkdir openmm_build && cd openmm_build
git clone --depth 1 --branch 8.2.0 https://github.com/openmm/openmm.git
cd openmm && mkdir build && cd build
cmake .. \\
    -DCMAKE_INSTALL_PREFIX=/opt/openmm \\
    -DCMAKE_BUILD_TYPE=Release \\
    -DOPENMM_BUILD_CUDA_LIB=ON \\
    -DCUDA_NVCC_FLAGS="-arch=sm_120;-O3" \\
    -DBUILD_TESTING=OFF
make -j$(nproc)
make install
# Wire the Python bindings into the system Python.
make PythonInstall
```

### 3. Install the FEP scientific stack (~15 min)

```bash
pip install --no-cache-dir \\
    'openfe==1.0.*' \\
    'openmmtools==0.23.*' \\
    'pymbar==4.0.*' \\
    'openff-toolkit==0.16.*' \\
    'openmmforcefields==0.14.*' \\
    'openff-interchange==0.4.*' \\
    'lomap2'

# Verify imports — easier to catch ModuleNotFoundError here than in
# the first /fep_edge response.
python -c "
import openfe
import openmmtools
import pymbar
from openff.toolkit import Molecule
from openfe.protocols.openmm_rfe import RelativeHybridTopologyProtocol
print('FEP deps OK')
"
```

### 4. Deploy `fep_pod.py` + updated `dock_server.py`

```bash
# From your laptop:
scp runpod/dock_pod/fep_pod.py     root@<POD_HOST>:/workspace/
scp runpod/dock_pod/dock_server.py root@<POD_HOST>:/workspace/

# On the pod, restart uvicorn:
ssh root@<POD_HOST> '
    pkill -f "uvicorn dock_server"
    cd /workspace && nohup /usr/bin/python /usr/local/bin/uvicorn \\
        dock_server:app --host 0.0.0.0 --port 7861 \\
        > /workspace/dock_server_boot.log 2>&1 &
    sleep 3 && tail -20 /workspace/dock_server_boot.log
'
```

### 5. Smoke-test the /fep_edge route (~5 min for the empty-input check)

```bash
POD_FEP_URL=https://<pod-id>-7861.proxy.runpod.net
curl -sS -X POST "$POD_FEP_URL/fep_edge" \\
    -H "Content-Type: application/json" \\
    -H "X-Pod-Secret: $POD_SHARED_SECRET" \\
    -d '{"receptor_pdb": "", "ligand_a_sdf": "", "ligand_b_sdf": ""}' | jq .
# Expected: {"ok": false, "error": "Empty receptor/ligand SDF input", ...}
```

That response confirms the route is up and openfe imports succeed.
If you get `"kind": "missing_deps"` instead, step 3 didn't fully
land — repeat the pip install inside the pod.

### 6. Wire `POD_FEP_URL` on the backend

```bash
# From your laptop, in the project root:
fly secrets set POD_FEP_URL=https://<pod-id>-7861.proxy.runpod.net \\
    --app deltadock-prod
```

The backend redeploys automatically. Verify with:

```bash
# Should return: {"fep_pod_configured": true, ...}
curl https://api.liganx.bio/health/full | jq
```

### 7. End-to-end published-reference smoke test (~10 GPU-hours = ~$10)

Use the included script that submits one published EGFR-T790M
osimertinib analog edge and checks the result against the published
ΔΔG range:

```bash
ssh root@<POD_HOST>
cd /workspace
python smoke_fep_osimertinib.py
```

Expected output:

```
✓ Loaded cleaned receptor from /workspace/receptor_cache/1M17_A_T790M.clean.pdb
✓ Embedded both ligands (osimertinib + analog)
→ POST .../fep_edge (this will take ~8-12 hours on Blackwell sm_120)…
✓ Pod returned in 9.84 hours
✓ ΔΔG_binding(osi → analog) = +0.32 ± 0.18 kcal/mol
  hysteresis = 0.21 kcal/mol, convergence=ok
✓ ΔΔG within published range [0.0, 0.8] kcal/mol
✓ Convergence flag = ok
```

### 8. Grant your own user account FEP access via admin

From the admin page (`https://liganx.bio/admin`), click the **🔒 FEP locked**
chip on your own row to flip it to **✨ FEP unlocked**. The admin email is
unconditionally allowed by the auth helper, but the toggle is the audit-
trail mechanism — flip it explicitly so a future operator can see "this
user has FEP access" in the panel.

### 9. Run a real 5-analog study from the UI

Go to `/fep/new`, paste the osimertinib + 5 analogs from
`docs/fep_plus_design.md` §10 (the Cross 2014 / Jia 2016 set), and
submit. Expected total wall time: ~3-5 days for 5 analogs (7-8 edges).

## Roll-back

If the FEP pod is misbehaving:

```bash
# Unset the secret on the backend — endpoints will return 503 instead
# of failing weird.
fly secrets unset POD_FEP_URL --app deltadock-prod

# The pod itself can be paused (not stopped — pause preserves the
# OpenMM build).
runpodctl stop <fep-pod-id>
```

## Known failure modes

- **First call after pod boot is slow.** OpenMM JIT-compiles CUDA
  kernels on the first lambda window. Subsequent calls reuse the
  compiled kernels. Add 5-10 minutes to the first edge of any study.
- **"Steric clash in input pose"** — Vina's rigid-receptor pose has a
  heavy-atom overlap that OpenMM can't relax inside the equilibration
  window. Re-dock with ensemble docking enabled, then resubmit.
- **`kind: "charge_change"`** — A and B have different net charges.
  Not supported in v1; reject at submit time. Use a neutral analog.
- **Pod proxy timeout at 10 hours** — RunPod's HTTP proxy has a
  10-hour idle timeout. If an edge takes longer (HREX on a large
  system), the backend will see a `transport` error even though the
  pod completes. Phase B.1 fix: switch to an async pod-side worker
  + result-polling pattern.

## Cost monitor

Each successful FEP study:
- 10-analog (1.5× n = 15 edges): ~150 GPU-hours = ~$142
- 5-analog (radial+MST, ~7 edges): ~70 GPU-hours = ~$66
- 3-analog (radial only): ~30 GPU-hours = ~$28

Set up a RunPod billing alert at $500/month while the feature is in
beta. Pro-tier per-user gate (`fep_enabled` in `user_profile`) is the
primary cost control — only admin-granted users can submit.
