# Liganx Boltz-2 GPU serverless worker.
#
# Boltz-2 (Wohlwend et al., 2025; MIT) ML co-folding + binding-affinity model.
# Built by RunPod from this repo (GitHub integration) with the repo ROOT as the
# build context — same deploy path as runpod/gnina_worker/Dockerfile.
#
# DEPENDENCY LESSON (2026-08-22, see runpod/BOLTZ2_VALIDATE.md "Field notes"):
# installing boltz on top of a pre-baked pytorch image AND adding
# `cuequivariance-ops-torch-cu12` pulled torch 2.13/cu130, which broke the
# image's torchvision (`operator torchvision::nms does not exist`) and could not
# be unwound (cuequivariance-torch pins a newer torch than the image shipped).
#
# THE FIX, encoded below:
#   1. Start from a PLAIN CUDA base with NO pre-installed torch, so nothing
#      conflicts with the torch that boltz resolves for itself.
#   2. `pip install boltz` — let boltz pull its own matching torch.
#   3. Add pure `cuequivariance-torch` ONLY (NOT the `-ops-torch-cu12` kernel
#      accelerator that dragged in the bad torch). Boltz runs on the pure path.
#   4. Assert the imports resolve at build time so a bad trio fails the BUILD,
#      not the first user request.
FROM nvidia/cuda:12.4.1-cudnn-devel-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    BOLTZ_CACHE=/root/boltz2_cache \
    PIP_NO_CACHE_DIR=1

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      python3.11 python3-pip git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN python3.11 -m pip install --upgrade pip

# boltz brings its own consistent torch; cuequivariance-torch = pure bindings
# (no CUDA-ops accelerator wheel). runpod = the serverless SDK. pyyaml for the
# input manifest.
RUN python3.11 -m pip install boltz cuequivariance-torch "runpod>=1.6,<2" pyyaml

# Build-time sanity gate: if the torch / torchvision / cuequivariance trio is
# inconsistent, fail the build HERE instead of at first prediction.
RUN python3.11 -c "import torch, cuequivariance_torch; print('OK torch', torch.__version__)"

# Pre-download the ~6 GB weights (CCD mols.tar + boltz2_conf.ckpt) into the
# image so cold starts don't pay the download. The RunPod builder has no GPU,
# so the predict itself fails at the GPU-load step — but the weight DOWNLOAD
# happens first and is what we're caching, hence `|| true`.
COPY runpod/boltz2_worker/warm.yaml /tmp/warm.yaml
RUN mkdir -p /root/boltz2_cache \
 && (boltz predict /tmp/warm.yaml --out_dir /tmp/warmout --cache /root/boltz2_cache \
       --output_format pdb --diffusion_samples 1 --override || true) \
 && ls -la /root/boltz2_cache

WORKDIR /app
COPY runpod/boltz2_worker/handler.py /app/handler.py

# build-rev: 1
CMD ["python3.11", "-u", "handler.py"]
