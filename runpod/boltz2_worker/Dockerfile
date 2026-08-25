# Boltz-2 serverless worker image.
#
# Boltz + torch (CUDA wheel) are baked in at BUILD time (GitHub Actions, no
# GPU needed for `pip install`), which sidesteps the on-demand-pod capacity
# wall entirely — the only GPU used is the serverless worker's, drawn from
# RunPod's serverless pool at request time. Model weights (~5 GB) are NOT in
# the image; they download once to the mounted network volume
# (/runpod-volume/boltz2_cache) and are cached there for every later request.
#
# The torch CUDA wheel bundles its own CUDA runtime libs; RunPod's serverless
# GPU runtime bind-mounts the NVIDIA driver (libcuda) into the container, so a
# plain python base is sufficient — no CUDA base image required.
#
# Built by .github/workflows/build-boltz2-worker.yml
#   -> ghcr.io/arashtadi/liganx-boltz2-slim:latest
FROM python:3.11-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    BOLTZ_CACHE=/runpod-volume/boltz2_cache

# git: some boltz deps resolve from VCS / need it at runtime.
# build-essential: fallback for any dep without a prebuilt wheel.
# libgomp1: OpenMP runtime torch links against.
RUN apt-get update && apt-get install -y --no-install-recommends \
      git build-essential ca-certificates libgomp1 \
 && rm -rf /var/lib/apt/lists/*

# Pin torch to a CUDA 12.1 build FIRST. The default `pip install torch` (pulled
# in transitively by boltz) grabs a cu12.9 build that fails at runtime on RunPod
# serverless workers with older drivers:
#   "RuntimeError: The NVIDIA driver on your system is too old (found version
#    12080)" — i.e. torch was compiled for a newer CUDA than the GPU driver.
# cu121 runs on essentially every RunPod GPU (driver 12.1+). boltz only needs
# torch>=2.2, so 2.5.1+cu121 satisfies it and pip won't replace it below.
RUN pip install --no-cache-dir torch==2.5.1 --index-url https://download.pytorch.org/whl/cu121

# boltz pulls rdkit, numpy, pytorch-lightning, etc. runpod = the serverless SDK.
# pyyaml for the input-spec serialisation in the handler.
RUN pip install --no-cache-dir boltz runpod pyyaml

COPY runpod/boltz2_worker/handler.py /handler.py

CMD ["python", "-u", "/handler.py"]
