# Deploy `/mmgbsa/rescore` to the production pod

**Status: Phase A code merged 2026-05-15, NOT YET DEPLOYED to the pod.**
The endpoint returns a clear `ok: false` with a "dependencies missing"
error until openff-toolkit + openmmforcefields are installed on the
pod. The backend maps that to HTTP 503 with the actionable pip line so
the user sees what's needed.

This doc is the runbook for the operator deploying the pod side.

## What you're deploying

- `runpod/dock_pod/mmgbsa_pod.py` — the new module. Single-snapshot
  one-trajectory MM-GBSA via OpenMM. Amber14SB + OpenFF Sage 2.2 +
  OBC2 implicit solvent. ε=2 dielectric (single-snapshot consensus),
  0.15 M salt screening, receptor heavy-atom positional restraint
  during minimisation, pre-min steric-clash detector. See module
  docstring for the protocol + the audit caveats in
  `docs/mmgbsa_phase_a_audit.md`.
- A small append to `runpod/dock_pod/dock_server.py` — adds the
  `POST /mmgbsa/rescore` route alongside the existing
  `/relax_ensemble`. The append IS guarded by deferred imports inside
  the module, so dock_server.py loads fine on a pod missing the new
  deps; the route returns `{ok: false, error: "deps missing"}` until
  the install lands.

## Lessons learned from the prior pod deploys

Carrying over from `DEPLOY_ESM2.md`:

1. **Files live at `/workspace/`, not `/workspace/dock_pod/`.** The
   pod layout is flat. Drop `mmgbsa_pod.py` and the updated
   `dock_server.py` directly under `/workspace/`.
2. **There's no supervisord.** Restart pattern:
   ```bash
   pkill -f 'uvicorn dock_server'
   cd /workspace && nohup /usr/bin/python /usr/local/bin/uvicorn \
       dock_server:app --host 0.0.0.0 --port 7861 \
       > /workspace/dock_server_boot.log 2>&1 &
   ```
3. **Blackwell sm_120 caveat (carry-forward from ESM2/GNINA).**
   Pre-built OpenMM CUDA kernels target sm_70-90. On Blackwell
   OpenMM falls back to JIT-compiling PTX, which works after a
   ~30 s first-launch warmup. Pod has OpenCL as a fallback path
   that's reliable but slower. If MM-GBSA throughput becomes an
   issue, the long-term fix is building OpenMM 8.2 from source for
   sm_120 — same approach the FEP+ pod will need (see
   `docs/fep_plus_design.md` §1).

## Steps (single session, ~10 minutes)

```bash
# 1. SSH to the pod.
ssh root@<POD_HOST>      # or runpodctl ssh <pod-id>

# 2. Install the new deps. These pin to the versions the Phase A
#    code was developed against. Newer 0.x releases may work but
#    have not been tested.
pip install --break-system-packages \
    'openff-toolkit==0.16.*' \
    'openmmforcefields==0.14.*' \
    'openff-interchange==0.4.*'

# 3. Verify the imports work BEFORE restarting uvicorn — easier to
#    see traceback now than to hunt it in dock_server_boot.log.
python -c "from openff.toolkit import Molecule; \
           from openmm.app import OBC2; \
           from openmmforcefields.generators import SMIRNOFFTemplateGenerator; \
           print('mmgbsa deps OK')"
# Expected: "mmgbsa deps OK"

# 4. From your laptop, scp the two files into /workspace/ (flat layout).
scp runpod/dock_pod/mmgbsa_pod.py    root@<POD_HOST>:/workspace/
scp runpod/dock_pod/dock_server.py   root@<POD_HOST>:/workspace/

# 5. On the pod, restart uvicorn.
ssh root@<POD_HOST> '\
    pkill -f "uvicorn dock_server"; \
    cd /workspace && nohup /usr/bin/python /usr/local/bin/uvicorn \
        dock_server:app --host 0.0.0.0 --port 7861 \
        > /workspace/dock_server_boot.log 2>&1 & \
    sleep 3 && tail -20 /workspace/dock_server_boot.log'

# 6. Verify the new route returns ok=False (not 404). A minimal
#    body — empty strings — should produce the "Empty receptor_pdb
#    or ligand_sdf" branch in mmgbsa_pod.py.
POD_URL=https://<pod-id>-7861.proxy.runpod.net
curl -sS -X POST "$POD_URL/mmgbsa/rescore" \
    -H "Content-Type: application/json" \
    -H "X-Pod-Secret: $POD_SHARED_SECRET" \
    -d '{"receptor_pdb": "", "ligand_sdf": ""}' | jq .
# Expected: {"ok": false, "error": "Empty receptor_pdb or ligand_sdf", ...}

# 7. (Optional) End-to-end smoke test from the backend side. Fire
#    /jobs/{share_id}/results/{cid}/{variant}/mmgbsa on a real
#    completed job and watch the response. First call on a cold
#    pod is ~60-90 s while OpenMM PTX-JITs the kernels.
```

## Verifying success

After step 6 returns `{"ok": false, "error": "Empty receptor_pdb ..."}`
the route is live. The next step is an end-to-end test from the
production backend:

1. Open a completed job in the UI.
2. Click any cell with a real docked pose to open the PoseDetail panel.
3. Click **"Rescore with MM-GBSA"**.
4. Wait ~30-90 s on the first call (PTX JIT + parameterisation).
5. Confirm the panel updates to show the "rank-only" chip and the
   E_complex / E_protein / E_ligand breakdown.

If the request returns HTTP 503 with "dependencies missing", the
pip install in step 2 didn't land — re-run it inside the pod with
`--break-system-packages`.

## Failure modes you'll hit in production

- **"Steric clash in input pose — pre-minimisation energy 1.5e6
  kcal/mol is non-physical"** — Vina's rigid-receptor pose has a
  heavy-atom overlap. Return value `ok: false`, kind=`runtime`.
  Recoverable by re-docking with a different receptor conformer
  (ensemble docking helps here).
- **"Failed to parameterise ligand: unknown SMARTS atom type"** —
  the ligand contains a chemotype outside OpenFF Sage 2.2's
  coverage. Currently no fallback — Phase A.1 will add GAFF2 as a
  toggle. Surfaced as HTTP 422 with the actionable message.
- **First-call latency >120 s** — PTX JIT under OpenCL fallback path
  is slow. Repeated calls drop to ~30-60 s as OpenMM caches the
  kernel. Long-term fix: OpenMM 8.2 source-build for sm_120.

## Roll-back

The append in `dock_server.py` is at the END of the file, so a
roll-back is:

```bash
# Restore the pre-MM-GBSA dock_server.py from your laptop.
scp runpod/dock_pod/dock_server.py.pre-mmgbsa.bak \
    root@<POD_HOST>:/workspace/dock_server.py
# Restart uvicorn (same pattern as step 5 above).
```

The new pip-installed packages can stay — they don't conflict with
anything else on the pod.
