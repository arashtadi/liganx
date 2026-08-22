# Boltz-2 serverless worker

Scale-to-zero RunPod GPU endpoint for Boltz-2 ML pose+affinity prediction.
This is the durable backing for the (admin + request-gated) Boltz-2 engine:
idle cost is $0, GPUs spin up per request. Mirrors `../gnina_worker/`.

## Files
- `Dockerfile` — plain-CUDA base + `pip install boltz cuequivariance-torch`
  (NO `cuequivariance-ops-torch-cu12`; that wheel pulls a bad torch — see the
  dependency lesson in the Dockerfile header and `../BOLTZ2_VALIDATE.md`).
  Bakes the ~6 GB weights into the image so cold starts skip the download.
- `handler.py` — `runpod.serverless` handler; input/output contract in its
  docstring. Same prediction logic as `../boltz2_server_async.py`.
- `warm.yaml` — tiny manifest used at build time to trigger the weight download.

## Deploy (RunPod console — needs GitHub, one-time)
1. Push this repo/branch to GitHub (done: branch `warmup-keepalive`).
2. RunPod console → Serverless → New Endpoint → **Import from GitHub**
   (authorize the repo if first time).
3. Config:
   - **Dockerfile path:** `runpod/boltz2_worker/Dockerfile`
   - **Build context:** repo root
   - **Branch:** `warmup-keepalive` (or main once merged)
   - **GPU:** RTX 4090 (24 GB is enough for kinase-domain proteins)
   - **Max workers:** 1–2 to start; **Min workers: 0** (scale to zero = the point)
   - **Container disk:** ~20 GB (weights are in the image)
4. RunPod builds the image (the `import torch, cuequivariance_torch` line in the
   Dockerfile makes a bad dependency trio fail the build early). First build is
   slow (weights bake in).
5. Copy the **Endpoint ID** and set it on the API:
   `fly secrets set BOLTZ2_RUNPOD_ENDPOINT_ID=<id> BOLTZ2_ENABLED=1 -a liganx-api`

## Test the endpoint directly (no app needed)
```bash
curl -s -X POST https://api.runpod.ai/v2/<ENDPOINT_ID>/runsync \
  -H "Authorization: Bearer $RUNPOD_API_KEY" -H "Content-Type: application/json" \
  -d '{"input":{"receptor_sequence":"<KINASE_DOMAIN_SEQ>","ligand_smiles":"<SMILES>","chain_id":"A"}}' \
  | jq '.output | {affinity_pred_value, affinity_probability_binary, engine}'
```
Then run the positive-control suite end-to-end:
`LIGANX_VALIDATE_ENGINE=boltz2 LIGANX_BEARER_TOKEN=<admin JWT> python3 backend/scripts/validate_positive_controls.py`

## Remaining backend wiring (TODO after the endpoint is up)
The runner currently calls the persistent-pod client
`pipeline/deltadock_pipeline/boltz2_dock.py` (HTTP `/predict_boltz2_async`).
For serverless, add a client that POSTs to `https://api.runpod.ai/v2/<id>/run`
and polls `/status/<jobId>` (mirror the existing `dock_one_runpod` serverless
path used by `screening_runner.py`), and have `runner.py` prefer it when
`settings.boltz2_runpod_endpoint_id` is set. Until then, point
`BOLTZ2_POD_URL` at a running pod OR use the direct-endpoint curl / driver above
to validate the model.
