# Liganx GNINA GPU serverless worker

Real GNINA (Vina pose search + CNN rescoring) on a pay-per-use RunPod **GPU**
serverless endpoint. Companion to the CPU QuickVina worker in `../` — same
request/response shape, plus `cnn_mode` in and `cnn_score` / `cnn_affinity` out.

## Why a separate GPU endpoint
GNINA's CNN scoring needs a GPU to be fast. The existing `liganx-docking-burst`
endpoint is a cheap CPU worker (great for Vina, useless for GNINA's CNN). So
GNINA gets its own GPU endpoint; the backend routes `engine=gnina` here.

## One-time setup (RunPod dashboard — ~5 min + build wait)
1. RunPod Console → **Serverless** → **New Endpoint**.
2. Source: **GitHub repo** (same repo the Vina worker builds from) →
   Dockerfile path: **`runpod/gnina_worker/Dockerfile`**.
3. **GPU**: pick a small/cheap one — 16 GB (RTX A4000 / RTX 4000 Ada) is plenty
   for CNN rescoring. (24 GB 4090 also fine if that's what's available.)
4. **Container disk**: ~20 GB (the gnina image is large).
5. **Idle timeout**: 5 s. **Max workers**: 1–3. **Name**: `liganx-gnina`.
6. Create, then wait for the first build/pull to finish (the gnina image is big —
   first build can take several minutes).
7. Copy the **Endpoint ID** and hand it to Claude, or set it yourself:
   `flyctl secrets set GNINA_RUNPOD_ENDPOINT_ID=<id> -a liganx-api`

After that, Claude wires the backend (`engine=gnina` → this endpoint), removes
the old pod requirement for GNINA, and tests a live job until it returns real
CNN score + CNN affinity columns.

## Notes / risks
- gnina can be picky about GPU compute capability. If the first endpoint build
  runs but a test job errors on the GPU, we may need to pin a specific gnina
  image tag or GPU type — budget a test-and-fix cycle.
- `cnn_mode=rescore` is the fast default; `refine` is slower/more accurate.
