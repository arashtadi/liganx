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
