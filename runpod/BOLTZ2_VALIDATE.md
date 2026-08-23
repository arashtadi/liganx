# Boltz-2 validation runbook

**Goal:** prove Boltz-2 is *fast* (per-prediction latency) and *accurate*
(gets the WT-vs-mutant Δ direction right) before enabling it for anyone.
Companion to `BOLTZ2_INSTALL.md` (pod-side install) and
`docs/boltz2_integration_plan.md` (design + open questions).

**Status as of 2026-08-22:** the whole Boltz-2 stack is code-complete —
pod server (`boltz2_server_async.py`), client (`boltz2_dock.py`), runner
path (`runner.py`), API gating (`jobs.py`, admin-only + `BOLTZ2_ENABLED`),
results badge. It has **never been run**. This runbook is the one remaining
step. Access stays **admin-only until this passes** (owner's decision).

Blocker at time of writing: RunPod had no free RTX 4090 to start either pod
(`dxz4w27vtkdv2i`, `y1vc9la4mvzw6p`) — "not enough free GPUs on the host
machine". The steps below run the moment a GPU frees.

---

## One-time prerequisites

- **Admin bearer token.** The suite submits real jobs via `POST /jobs`, and
  non-Vina engines are admin-gated. Get a Supabase JWT from a signed-in
  admin browser session (DevTools → Application → Cookies → `sb-*-auth-token`,
  or `supabase.auth.getSession()` in the console). JWTs expire (~1h), so
  grab it right before running.
- **runpodctl** authed on the machine that starts the pod (already is, on
  Arash's Mac).

---

## Step 1 — get a GPU

```bash
runpodctl pod start dxz4w27vtkdv2i   # primary; try y1vc9la4mvzw6p if this is full
runpodctl pod list                   # confirm STATUS flips EXITED → RUNNING
```

If both return "not enough free GPUs on the host machine", the host is at
capacity — wait and retry (a cron/scheduled retry watches for this window).
Cost note: an RTX 4090 pod bills while RUNNING (~$0.3–0.7/hr). **Stop it after
validation** (`runpodctl pod stop <id>`) to respect the cost budget.

## Step 2 — make sure Boltz-2 is actually installed on the pod

The May work wrote all the repo code but it is **not confirmed** that the pod
itself has the `boltz2` conda env + weights + async server running. SSH in and
check:

```bash
# whichever SSH flow the pod uses
source /workspace/mambaforge/etc/profile.d/conda.sh && conda activate boltz2 \
  && boltz --help >/dev/null 2>&1 && echo "boltz env OK" || echo "NEEDS INSTALL"
ls -la /workspace/boltz2_cache   # ~5GB of weights expected
```

If it prints `NEEDS INSTALL` or the cache is missing, follow
`runpod/BOLTZ2_INSTALL.md` Phase 1 first (mamba env + `pip install boltz` +
first-run weight download, ~5–10 min).

## Step 3 — start the async server + health-check

```bash
# on the pod (port 7862 by convention; match BOLTZ2_POD_URL)
source /workspace/mambaforge/etc/profile.d/conda.sh && conda activate boltz2
POD_SHARED_SECRET=$POD_SHARED_SECRET \
  nohup uvicorn boltz2_server_async:app --host 0.0.0.0 --port 7862 \
  > /workspace/boltz2_server.log 2>&1 &

# from anywhere:
curl -s https://<pod-proxy>-7862.proxy.runpod.net/health   # -> {"ok":true,"engine":"boltz-2"}
```

Confirm `BOLTZ2_POD_URL` (Fly secret) matches this proxy URL.

## Step 4 — enable the engine on the API

```bash
fly secrets set BOLTZ2_ENABLED=1 -a liganx-api   # triggers a rolling restart
curl -s https://api.liganx.com/health/full | jq '{boltz2_enabled, boltz2_status}'
# want: {"boltz2_enabled": true, "boltz2_status": "ok"}
```

## Step 5 — run the validation suite against Boltz-2

```bash
cd backend
export LIGANX_BEARER_TOKEN="<admin JWT from Step 0>"
export LIGANX_VALIDATE_ENGINE=boltz2
# JSON_OUT optional; omit to avoid overwriting the public Vina snapshot
python scripts/validate_positive_controls.py
```

The suite submits the 8 positive-control cases (T315I/imatinib,
T790M/gefitinib, V600E/vemurafenib, D816V, C481S/ibrutinib, the KRAS
G12C selectivity case, etc.), times each end-to-end, and checks the
Δ(mutant − WT) direction against the literature.

**Reading the result:**
- **Exit 0** — every case agrees with literature direction → Boltz-2 is
  accurate on the suite. Note wall-clock per case for the "fast" claim
  (~20 s/prediction warm is the target from the plan).
- **Exit 1** — one or more cases point the wrong way. This is the open
  question from the plan (ML models can be insensitive to single-residue
  changes). Investigate the failing case before enabling. A single
  wrong-direction case ≠ ship.
- **Exit 2** — transient network/auth error; re-run.

**Accuracy caveat:** `NOISE_FLOOR_KCAL = 1.0` in the script is Vina-kcal
calibrated. Boltz-2's score is `affinity_pred_value` = log10(IC50 µM), a
different unit, so the *direction* verdict is the trustworthy signal here;
the magnitude/noise-floor gate should be re-calibrated for Boltz-2 before
being used as a hard pass/fail on magnitude.

## Step 6 — decide, then control cost

- **Passed:** you can leave `BOLTZ2_ENABLED=1` (admin-only still gates it),
  add the Boltz-2 option to the engine picker in `NewJobPage.tsx` /
  `StudioPage.tsx` (the only remaining UI gap), and later decide the
  user-access model (Pro vs capped-free).
- **Failed / not ready:** `fly secrets set BOLTZ2_ENABLED=0 -a liganx-api`
  to put it back to dark.
- **Always:** `runpodctl pod stop <id>` when done so the 4090 stops billing.

---

## Field notes — first attempt 2026-08-22 (what worked, what bit)

**On-demand GPU works and bypasses the capacity block.** When the existing
pods can't start ("not enough free GPUs on the host machine"), create a fresh
one — it schedules onto any free host:

```bash
runpodctl pod create --name liganx-boltz2-test \
  --gpu-id "NVIDIA GeForce RTX 4090" --cloud-type SECURE \
  --image runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04 \
  --container-disk-in-gb 45 --ports "22/tcp,7862/http" --ssh
```

- **Use `--cloud-type SECURE`**, and **expose `22/tcp`** (a community-cloud pod
  got stuck at `uptimeSeconds: 0`; and without a TCP port, `runpodctl ssh info`
  never leaves "pod not ready"). Secure cloud provisioned + SSH-ready in ~90 s.
  Connect: `runpodctl ssh info <podId>` prints the `ssh -i ... root@IP -p PORT`.
- `pip install boltz` (installs boltz 2.2.1) works, and the weights
  (~6 GB: CCD `mols.tar` + `boltz2_conf.ckpt`) download to `--cache` in ~4 min.

**The dependency trap (unresolved — do this differently next time).** Installing
into the image's base env fails at predict time:

1. Bare boltz → `ModuleNotFoundError: No module named 'cuequivariance_torch'`.
2. `pip install cuequivariance-torch cuequivariance-ops-torch-cu12` fixes the
   import but the **ops** wheel drags in `torch 2.13.0+cu130`, which breaks the
   image's torchvision → `RuntimeError: operator torchvision::nms does not exist`.
3. Forcing torch back to 2.4.0+cu124 conflicts because `cuequivariance-torch`
   pins a newer torch. Circular.

**Fix for the next run** (either):
- **Isolated env with pinned versions** (as this runbook's Step 2 always said —
  do NOT install into the base env): a mamba/conda env with a torch that
  satisfies *both* boltz 2.2.1 and `cuequivariance-torch`, the *matching*
  torchvision, and **do not install `cuequivariance-ops-torch-cu12`** (the
  kernel accelerator that pulled the bad torch) — boltz runs on pure
  `cuequivariance-torch`. Verify with
  `python -c "import torch, torchvision, cuequivariance_torch"` before predicting.
- **Bake a serverless worker image** (mirror `runpod/gnina_worker/`) so the deps
  are pinned once and this never recurs; also gives the scale-to-zero backing
  for the user-facing engine button.

**Also:** weights re-download on every fresh pod. Attach a **network volume**
(`--network-volume-id`) mounted at the cache path so `boltz2_conf.ckpt` persists.

The validation driver `runpod/bz_validate_direct.py` is ready — it self-fetches
each case PDB, builds the pocket + mutant sequence, and runs WT/mutant Boltz-2
with no API/token. It just needs a pod where `boltz predict` actually runs.


---

## Field notes — second attempt 2026-08-23 (RESOLVED — it runs on GPU)

**Root cause of every prior failure: boltz's kernel path wants CUDA 13.**
`pip install "boltz[cuda]"` (rev3) installs `torch 2.13.0+cu130` plus the
cuequivariance CUDA-kernel trio. But there is **no cu12 build of torch 2.13**
(cu128 tops out at 2.11.0, cu124 at 2.6.0), and RunPod's GPUs run **driver 550
(CUDA 12.4)**, which cannot run a CUDA-13 build → `torch.cuda.is_available()`
returns **False**. That would have failed on serverless too; a raw pod caught it.

**The fix: don't use the kernels.** boltz's `TriangleMultiplicationOutgoing/
Incoming.forward(..., use_kernels=False)` has a **pure-PyTorch fallback**; the
cuequivariance import only happens on the `use_kernels=True` branch. The
`boltz predict --no_kernels` flag (main.py: `use_kernels = not no_kernels`)
forces the fallback. So we install **plain `boltz`** (no `[cuda]`) on a **cu12
torch** and never touch cuequivariance:

```bash
python3.11 -m venv /workspace/bz2 && source /workspace/bz2/bin/activate
pip install torch==2.11.0 --index-url https://download.pytorch.org/whl/cu128
printf 'torch==2.11.0\n' > con.txt && pip install -c con.txt boltz
boltz predict in.yaml --accelerator gpu --no_kernels --cache /workspace/boltz_cache
```

- `torch 2.11.0+cu128` → `cuda_available True` on driver 550 (CUDA 12.x runs via
  minor-version compat). boltz 2.2.1 installs clean with the `-c` constraint.
- boltz auto-disables kernels only when CUDA is absent OR GPU compute-cap < 8.0;
  a 4090 is 8.9 so it does NOT auto-disable — you must pass `--no_kernels`.
- A 60-aa structure-only predict ran in **~8 s** (warm model). Do NOT `kill` a
  run mid weight-download — it corrupts `boltz2_conf.ckpt` (miniz "failed
  finding central directory"); wipe the cache and re-download.

**Accuracy (positive-control suite, --no_kernels, msa=empty, pocket-constrained,
diffusion_samples=1):**

| Case | WT | MUT | Δ(mut−wt) | dir | expect | |
|---|---|---|---|---|---|---|
| ABL T315I / Imatinib | −1.685 | −0.634 | +1.05 | resistance | resistance | PASS |

(Full table lands when the run finishes.) Score = affinity_pred_value =
log10(IC50 µM); Δ>0 = mutant weaker binder = resistance.

**Production recipe locked into the worker (Dockerfile rev4 + handler.py) and
the persistent-pod server (boltz2_server_async.py): plain boltz, cu12 torch,
`--no_kernels`.** Deployment note: RunPod auto-build-on-push does not fire on
this account, and there is no cu12/cu13 host toggle needed — the image is
CUDA-12 and runs on the default fleet.
