# Liganx dock pod — bake-everything-in image

This directory contains the Docker image that runs the GPU pod the
Liganx backend talks to for docking (QuickVina2-GPU + GNINA) and
ADMET predictions (admet-ai). It replaces the live-install approach
that was causing repeated outages: every time we'd touch the running
pod (admet-ai install bumps torch, RunPod migrates the host, etc.) we
risked breaking QuickVina-GPU. With this image, the whole stack is
frozen — pinned versions, compiled-from-source where needed, no live
`pip install` ever.

## What's baked in

- **CUDA 12.4.1 / Ubuntu 22.04** base (matches torch 2.4.1+cu124's ABI)
- **QuickVina2-GPU** compiled from source for sm_86 + sm_89 (works on RTX 3090, A5000, A6000, RTX 4090, L40 — anything from RTX 30xx through Ada Lovelace)
- **GNINA v1.3** binary (CNN re-scoring enabled — the feature that was disabled on Blackwell because of sm_120 incompatibility)
- **admet-ai 1.x** (Chemprop ensemble, ~100 ADMET endpoints, CPU-forced inside the model load via the scoped CUDA_VISIBLE_DEVICES trick)
- **dock_server.py** — the FastAPI app exposing `/dock`, `/dock_batch`, `/dock_gnina`, `/dock_batch_gnina`, `/admet/predict`
- **admet_pod.py** — admet-ai wrapper with the env-leak fix
- **start_dock_server.sh** — entrypoint with GPU sanity log + uvicorn launch

## Build

The image needs a Linux build host with `docker buildx` (any cloud Linux box works; macOS Docker Desktop also fine). It does NOT need a GPU at build time — the GPU is only used at deploy time when QuickVina's OpenCL kernels JIT compile on first run.

### 0. Get dock_server.py off the existing pod first

The 500+-line FastAPI app on the current production pod isn't checked into git anywhere (it was added incrementally on the live pod over months). Pull it out once:

1. Open the existing pod's web terminal (RunPod console → pod → Open Web Terminal)
2. Run:
   ```
   cat /workspace/dock_server.py
   ```
3. Copy the full output into a new file at `runpod/dock_pod/dock_server.py` on your local repo clone

This is a one-time operation. Once it's in git, future image builds use the checked-in copy.

### 1. Build the image

```bash
cd runpod/dock_pod

docker buildx build \
    --platform linux/amd64 \
    -t ghcr.io/arashtadi/liganx-dock-pod:v1 \
    --push \
    .
```

Build takes about 10-15 min on a 4-vCPU box. The slow part is `make -j` for QuickVina-GPU (~5 min) plus the `pip install torch+admet-ai` step (~5 min, ~3 GB of wheels).

If you don't have GHCR auth set up locally:
```bash
echo "$GITHUB_PAT" | docker login ghcr.io -u arashtadi --password-stdin
```
The PAT needs `write:packages` scope.

### 2. Mark the image public on GHCR

GHCR images are private by default. RunPod can't pull a private image without credential setup, so the simplest path is to make the package public after the first push:

1. Go to https://github.com/users/arashtadi/packages/container/liganx-dock-pod/settings
2. Scroll to "Danger Zone" → "Change visibility" → Public

Public is fine: there's nothing sensitive in this image (no API keys, no DB creds — those come in via env vars at deploy time).

## Deploy on RunPod

1. **Console → Pods → + Deploy → GPU Pod**
2. Search **`4090`** → pick **Community Cloud** (cheaper) OR **Secure Cloud** (more reliable). RTX A5000 / RTX 3090 also work.
3. **Edit template** (click the pencil on the template card):
   - **Container image:** `ghcr.io/arashtadi/liganx-dock-pod:v1`
   - **Container disk:** 20 GB
   - **Volume mount path:** `/workspace`
   - **Expose HTTP ports:** `8888,7861` ← critical, must be HTTP not TCP
   - **Expose TCP ports:** `22`
4. **Network volume:** if you've already created the `liganx-workspace` 75 GB volume in the same datacenter, attach it. Otherwise the image is self-contained and works without a volume — admet cache rebuilds, dock kernel cache JITs on first call.
5. **Deploy On-Demand.**
6. Once the pod shows green (~2-3 min boot, kernel compile happens on first /dock so first dock is slow), grab the pod ID.

## Cut over the backend

Once the new pod's `/health` responds:

```bash
# Verify the new pod
curl https://<new-pod-id>-7861.proxy.runpod.net/health
# Expect: {"ok":true,"engine":"QuickVina2-GPU-2.1",...}

# Update Fly secrets
flyctl secrets set POD_DOCK_URL=https://<new-pod-id>-7861.proxy.runpod.net \
    RUNPOD_POD_ID=<new-pod-id> \
    --app liganx-api
```

The Fly secrets update triggers a backend deploy automatically (~2-3 min). After that, docks flow through the new pod.

## Verify

After the backend redeploys:
1. Run a real dock from liganx.com Studio — should complete in ~2-5s per cell (warm GPU).
2. Click the ⚕ ADMET pill — should return predictions in <500ms (cache miss) or <50ms (cache hit).
3. If GNINA was set to `cnn_mode=none` in the backend (it was, on the Blackwell pod), flip it back to `cnn_mode=rescore` in `pipeline/deltadock_pipeline/docking_gnina.py` — the new sm_89 GPU supports the TVM kernels.

## Roll back

If the new pod misbehaves, switch Fly secrets back to the old Blackwell pod ID and restart the old pod from the RunPod console. ~5 min downtime. The old pod's /workspace state is intact (never destroyed).

## When to rebuild this image

- A new GNINA release that fixes Blackwell support: rebuild with the new version, swap GPU back to a Blackwell SKU for the VRAM boost
- A new admet-ai release with significantly better predictions: bump pin in Dockerfile, rebuild
- A torch security advisory: bump torch pin, rebuild (check that admet-ai still resolves)
- You want to swap GPU SKU and a different compute capability is needed: edit the `--gpu-architecture` flag in the Dockerfile's `make` step, rebuild
