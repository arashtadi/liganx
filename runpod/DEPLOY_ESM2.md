# Deploy `/esm2/fitness` to the production pod

**Status: deployed and verified end-to-end 2026-05-12.** Live at
production pod `476f8acb407d` (sm_120 Blackwell, ~5s CPU inference on
cold call, ~60ms cache hit). Both Fly's `/tmp/liganx_esm2_local_cache.json`
and the pod's `/workspace/esm2_cache.sqlite` are warmed up.

This doc is kept for reference / future re-deploys. The backend side
ships automatically via Fly. The pod side is **one SCP + one process
restart**, *but* note the lessons learned at the bottom.

## What you're deploying

- `runpod/dock_pod/esm2_pod.py` — the inference module (lazy model
  load, UniProt fetch + cache, sqlite per-mutation cache)
- A small patch already applied to `runpod/dock_pod/dock_server.py` —
  adds the `POST /esm2/fitness` route alongside the existing `/admet/predict`

## Lessons learned from the 2026-05-12 deploy

Two surprises that made the first deploy fail and would catch the next
person too:

1. **Files live at `/workspace/`, not `/workspace/dock_pod/`.** The pod
   layout is flat. `dock_server.py`, `admet_pod.py`, and now `esm2_pod.py`
   all live directly under `/workspace/`. The uvicorn process is started
   from `/workspace/` so the imports resolve at the top level.

2. **There's no supervisord on this pod.** The container ENTRYPOINT is
   `docker-init` running `start_dock_server.sh` which `nohup`s uvicorn.
   Restart pattern: `pkill -f 'uvicorn dock_server'; cd /workspace &&
   nohup /usr/bin/python /usr/local/bin/uvicorn dock_server:app --host 0.0.0.0
   --port 7861 > /workspace/dock_server_boot.log 2>&1 &`.

3. **transformers 5.x is broken on torch 2.4.1.** It registers a
   `linear_cross_entropy` custom op that uses `torch.library.infer_schema`
   features not in this torch. Symptom: HTTP 400 with
   `"infer_schema(func): Parameter input has unsupported type torch.Tensor"`.
   Fix: `pip install --break-system-packages "transformers==4.46.3"`.

4. **GPU is Blackwell (sm_120) and torch 2.4.1 has no kernels for it.**
   Symptom: HTTP 500 with `"no kernel image is available for execution on
   the device"`. Same gotcha as `admet_pod.py`. `esm2_pod.py` is now
   hardcoded to `_DEVICE = "cpu"` for that reason. Cold call is ~5s,
   warm is sqlite-cache fast.

## Steps (single session, ~5 minutes)

```bash
# 1. SSH to the pod. POD_ID is the same Fly secret used everywhere else.
ssh root@<POD_HOST>           # or `runpodctl ssh <pod-id>` if you have runpodctl

# 2. Make sure transformers 4.46.x is installed. 5.x is INCOMPATIBLE
#    with this pod's torch 2.4.1.
pip install --break-system-packages "transformers==4.46.3"

# 3. From your laptop, scp the two files into /workspace/ (flat layout).
scp runpod/dock_pod/esm2_pod.py     root@<POD_HOST>:/workspace/
scp runpod/dock_pod/dock_server.py  root@<POD_HOST>:/workspace/

# 4. Restart the FastAPI process. No supervisord on this pod — kill and
#    relaunch uvicorn directly.
pkill -f 'uvicorn dock_server'
sleep 3
cd /workspace && nohup /usr/bin/python /usr/local/bin/uvicorn dock_server:app \
  --host 0.0.0.0 --port 7861 > /workspace/dock_server_boot.log 2>&1 &

# 5. Smoke-test the new endpoint from the pod itself first (cheap):
curl -X POST http://localhost:7861/esm2/fitness \
  -H 'Content-Type: application/json' \
  -d '{"gene":"ABL1","position":315,"wt":"T","mut":"I"}'

# Expected output (first call ~5-10s while model loads, then ~1s after):
# {
#   "fitness": -2.90,
#   "log_p_wt": -1.22,
#   "log_p_mut": -4.12,
#   "seq_len": 1130,
#   "windowed": true,
#   "cache_hit": false,
#   "uniprot_id": "P00519",
#   "gene": "ABL1"
# }

# 6. Smoke-test from the Liganx backend (proves the proxy works
#    end-to-end). The Fly backend already knows POD_DOCK_URL.
curl -X POST https://api.liganx.com/calibrate/score \
  -H 'Content-Type: application/json' \
  -d '{"rows":[{"gene":"PIK3CA","position":1047,"wt_residue":"H","mutant":"R","drug_name":"Alpelisib","expected_direction":"selectivity"}]}'

# Expected: response should now include `score_source: live_esm2_pod`
# for this row (PIK3CA H1047R is NOT in the 49-event cache, so this
# would have hit BLOSUM62 before; now it goes through the pod).
```

## What happens on success

- First /esm2/fitness call per (gene, position, mut) → ~1s GPU on the
  4090. Result cached in `/workspace/esm2_cache.sqlite`.
- Every subsequent call for the same (gene, position, mut) →
  sqlite-cache hit, ~5ms.
- Liganx backend has its own `/tmp` cache too, so the same (gene,
  position, mut) only ever hits the pod once per Fly machine
  lifetime.

## What happens on failure (graceful)

If the pod is asleep, the endpoint times out, or anything else goes
wrong, the backend's `fetch_pod_fitness` returns `None` and
`/calibrate/score` falls back to BLOSUM62 — exactly the current
free-tier behaviour. So if you don't deploy the pod side, nothing
breaks; users just keep getting the BLOSUM proxy.

## Cost

- Cold-start model load on first call: ~5 seconds GPU
- Per-mutation cache miss: ~1 second GPU = ~$0.0001 on the 4090
- Per-mutation cache hit: $0
- After ~1000 distinct mutations have been scored, the cache covers
  most everyday queries and pod-side load is negligible.

## Future tighter integration

When this proves stable, the next move is to compute the local
49-event cache from the pod's sqlite too — that way the calibration
data is sourced from a single source of truth (the pod sqlite), and
adding a new event to the calibration set is a one-line database
insert rather than a re-curate-and-redeploy cycle.
