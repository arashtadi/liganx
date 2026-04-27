# DeltaDock × RunPod serverless

Run molecular dockings on RunPod's serverless GPU/CPU cloud instead of the
local Mac. The backend transparently dispatches each `(compound × variant)`
docking to a remote worker when env vars are set; otherwise everything runs
locally as before.

## When to use this

- **Burst capacity** — your job has 50+ dockings and you don't want them
  serialized on a laptop.
- **No local install** — deploy the backend to a tiny VPS that doesn't have
  Vina / Meeko / FoldX / Open Babel installed.
- **Throughput experiments** — running parameter sweeps where wall-clock
  matters more than per-call cost.

For a single 9-pair selectivity matrix, local Vina is faster (no cold-start
penalty) and free. Don't over-engineer this.

## Cost estimate

RunPod CPU-only serverless workers run roughly **\$0.0002/sec** at the time
of writing. A typical Vina docking at `exhaustiveness=8` takes 25–60 s, so
budget **\$0.005–\$0.012 per docking** plus a one-off cold-start (~3–10 s)
when the first request hits an idle endpoint.

A 100-compound × 5-mutant matrix (500 dockings) → roughly **\$2.50–\$6**.

## Setup

### 1. Build + push the worker image

```bash
cd /path/to/DockingOnline/runpod
docker build -t <your-registry>/deltadock-worker:latest .
docker push    <your-registry>/deltadock-worker:latest
```

The image is small (~250 MB) — basically Python 3.12 + AutoDock Vina 1.2.7 +
Open Babel + the `runpod` Python harness.

### 2. Create a serverless endpoint on RunPod

1. Sign in at <https://runpod.io>
2. Serverless → New Endpoint
3. Container image: `<your-registry>/deltadock-worker:latest`
4. Worker type: **CPU-only** (Vina doesn't use GPU; saves ~70 % cost)
5. Min workers: `0` (scales to zero between bursts)
6. Max workers: `5` (or whatever your throughput needs are)
7. Container disk: `5 GB` is plenty
8. Container start command: leave default (`python -u handler.py`)

Save and copy the **Endpoint ID** from the dashboard.

### 3. Get an API key

Account → Settings → API Keys → New Key (read+write scope).

### 4. Tell the backend about it

Add to `backend/.env`:

```bash
RUNPOD_API_KEY=<your key>
RUNPOD_ENDPOINT_ID=<endpoint id from step 2>
RUNPOD_TIMEOUT_S=240        # optional, defaults to 240s
```

Restart the backend. You should see this line in the log on the next job:

```
INFO:deltadock.services.runner:RunPod dispatch enabled → endpoint <id>
```

## How dispatch works

`pipeline/deltadock_pipeline/runpod_dock.py` POSTs to
`https://api.runpod.ai/v2/<endpoint_id>/runsync` with a JSON body:

```json
{
  "input": {
    "receptor_pdbqt_b64": "...",
    "ligand_pdbqt_b64": "...",
    "box": { "center_x": -50.5, "size_x": 22.0, ... },
    "exhaustiveness": 8,
    "num_modes": 9
  }
}
```

`/runsync` blocks until the worker finishes (max 5 min), then returns the
parsed mode table + base64 pose PDBQT.

The runner records `engine=runpod` (or `engine=local` / `engine=local_after_runpod_fail`)
in each result's `extra` field, so the UI / CSV export can show which engine
actually ran the docking.

## Failure handling

Any RunPod error — network blip, auth issue, cold-start timeout, malformed
worker output — falls back to running the same docking locally. One bad
RunPod call never takes down a job. Look for these warnings in the backend
log to diagnose:

```
WARNING:deltadock.services.runner:RunPod failed for c12 × T790M: HTTP 401 ... — falling back to local
```

## Going async (Phase B)

`/runsync` is fine for sub-5-min calls. For longer pipelines (high
exhaustiveness, ML-based engines), switch to `/run` + a polling loop and
move dispatch into Celery. See task #33 in the project tracker.
