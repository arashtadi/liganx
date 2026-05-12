# Deploy `/esm2/fitness` to the production pod

The backend side ships automatically via Fly. The pod side is **one
SCP + one process restart**.

## What you're deploying

- `runpod/dock_pod/esm2_pod.py` — the inference module (lazy model
  load, UniProt fetch + cache, sqlite per-mutation cache)
- A small patch already applied to `runpod/dock_pod/dock_server.py` —
  adds the `POST /esm2/fitness` route alongside the existing `/admet/predict`

## Steps (single session, ~5 minutes)

```bash
# 1. SSH to the pod. POD_ID is the same Fly secret used everywhere else.
ssh root@<POD_HOST>           # or `runpodctl ssh <pod-id>` if you have runpodctl

# 2. Make sure transformers is installed (was installed already for
#    the spike #6 ESM2 work; this is just an idempotent check).
pip install --quiet transformers

# 3. From your laptop, scp the two files into the pod's working dir.
#    The path /workspace/dock_pod matches where admet_pod.py already
#    lives, so the existing `from admet_pod import predict_smiles`
#    pattern just works for the new `from esm2_pod import …` import.
scp runpod/dock_pod/esm2_pod.py root@<POD_HOST>:/workspace/dock_pod/
scp runpod/dock_pod/dock_server.py root@<POD_HOST>:/workspace/dock_pod/

# 4. Restart the FastAPI process on the pod. Same pattern as the
#    admet-ai install — find the running dock_server.py PID and HUP it.
#    (On the current pod a `tmux` or `supervisord` is wrapping it;
#    `supervisorctl restart dock_server` is the canonical command if
#    supervisord is in front, otherwise `pkill -HUP -f dock_server.py`
#    works.)
supervisorctl restart dock_server   # or: pkill -HUP -f dock_server.py

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
