# GNINA install + endpoint runbook for the Pod

GNINA is a Vina fork from the Koes lab (Pittsburgh) that adds a CNN-based
pose-rescoring head trained on PDBbind. Same input/output shape as Vina,
runs on the same NVIDIA GPU we already have for QuickVina2-GPU, sits
side-by-side as a second engine option for users.

This is the **Pod-side install runbook**. The backend, pipeline, and
frontend changes are already in main and ship behind the `GNINA_ENABLED`
Fly secret — flipping that to `1` (after running the steps below) makes
the engine picker on NewJobPage offer GNINA as a choice.

## What you'll do

1. Open the RunPod Pod's **web terminal** (or SSH if enabled).
2. Download the GNINA binary into the Pod's `/usr/local/bin`.
3. Append the `/dock_gnina` and `/dock_batch_gnina` endpoints to the
   running `dock_server.py`.
4. Restart the FastAPI service so the new endpoints come live.
5. Set the `GNINA_ENABLED=1` Fly secret.

Total time: 10–15 min. Reversible by deleting the binary and removing the
two endpoints if it doesn't work out.

## Step 1 — Install the GNINA binary on the Pod

In the Pod's terminal:

```bash
# Download the latest static CUDA build. Pinned to v1.3 because that's
# what we tested against. Newer versions usually work but flag if the
# CLI changes.
cd /usr/local/bin
wget -q https://github.com/gnina/gnina/releases/download/v1.3/gnina -O gnina
chmod +x gnina

# Verify it loads + sees the GPU. Should print version + the CUDA device.
./gnina --version
./gnina --help | head -20
nvidia-smi | head -10   # confirm CUDA is visible to processes
```

Expected: `gnina v1.3` and the NVIDIA driver showing a GPU. If the
`--version` call hangs or segfaults, the most common cause is a CUDA/driver
mismatch — drop a note and we'll try the alternate static build.

## Step 2 — Add the endpoints to dock_server.py

The Pod's `dock_server.py` lives at `/workspace/dock_server.py` (or wherever
the Pod's auto-start script points). Append the contents of
`pod/gnina_endpoints_patch.py` from this repo to it:

```bash
# From the Pod, fetch the patch directly:
curl -sL https://raw.githubusercontent.com/arashtadi/liganx/main/pod/gnina_endpoints_patch.py \
  >> /workspace/dock_server.py
```

Or copy-paste the contents of `pod/gnina_endpoints_patch.py` if you'd
rather review before applying. The patch only **appends** — it doesn't
modify any existing routes.

## Step 3 — Restart the Pod's FastAPI service

```bash
# Find the running uvicorn process:
pgrep -af uvicorn | head

# Kill it; the auto-start script (or systemd, depending on Pod
# template) will respawn with the new file.
pkill -f "uvicorn.*dock_server" && sleep 2 && pgrep -af uvicorn

# Quick sanity check from outside:
curl -s https://4cli33cxvf58lb-7861.proxy.runpod.net/health
curl -s -X POST https://4cli33cxvf58lb-7861.proxy.runpod.net/dock_gnina \
  -H 'Content-Type: application/json' \
  -d '{}'   # expect 422 Unprocessable Entity (validation error) — proves the route exists
```

If the health check still works AND the gnina route returns 422 (instead
of 404), you're good.

## Step 4 — Flip the feature flag

From your laptop:

```bash
flyctl secrets set GNINA_ENABLED=1 -a liganx-api
```

That triggers a rolling restart of the backend with GNINA dispatch
enabled. The NewJobPage's engine picker will start showing
"GNINA (CNN-rescored)" as an option for the next job.

## Verifying it works

1. Go to https://liganx.com, start a new job.
2. Pick any small target (e.g. EGFR + Imatinib).
3. Open the **Scoring engine** dropdown — should show
   *QuickVina2-GPU* and *GNINA*. Pick GNINA.
4. Submit the job. Per-cell `extra` should include `engine=gnina`
   instead of `engine=pod_gpu`.
5. Open the pose detail — there should be a `cnn_score=` field
   shown alongside Vina/Vinardo (GNINA exposes both Vina-style affinity
   *and* a 0-1 CNN confidence; both are populated).

## Rollback

If anything breaks after the flag flip:

```bash
flyctl secrets unset GNINA_ENABLED -a liganx-api
```

That falls back to QuickVina2-GPU-only behaviour for everyone. The
Pod-side endpoints remain installed but unused — harmless.

To fully remove from the Pod:

```bash
# Truncate the appended block — manually edit /workspace/dock_server.py
# and delete everything below the line:
#   # ── GNINA endpoints (added <date>) ──────────────────────
# Then restart uvicorn as in Step 3.
rm /usr/local/bin/gnina
```

## Why GNINA specifically (not other engines)

This is the canonical "modern Vina" fork. Same authors, same input format,
genuinely different ranking on benchmarks because of the CNN head trained
on PDBbind. AutoDock-GPU and DiffDock are good follow-ons but each adds
its own prep pipeline complexity (AutoDock-GPU needs autogrid maps;
DiffDock needs PyTorch + 5GB model weights). GNINA is the highest-leverage
single binary we can drop in.
