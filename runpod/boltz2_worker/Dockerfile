# Liganx Boltz-2 GPU serverless worker.
#
# Boltz-2 (Wohlwend et al., 2025; MIT) ML co-folding + binding-affinity model.
# Built by RunPod from this repo (GitHub integration), repo ROOT as build
# context — same deploy path as runpod/gnina_worker/Dockerfile.
#
# DEPENDENCY LESSONS (see runpod/BOLTZ2_VALIDATE.md "Field notes"):
#   rev1: installing boltz on a pre-baked pytorch image + cuequivariance-ops-
#         torch-cu12 pulled a broken torch. Fix: plain CUDA base, let boltz pull
#         its own torch, add pure cuequivariance-torch only (no ops wheel).
#   rev2: Ubuntu 22.04's OWN `python3.11` apt package is a release candidate that
#         LACKS `sys.get_int_max_str_digits` (a 3.11 CVE backport). Newer
#         torch._dynamo requires it, so boltz crashed at RUNTIME importing
#         lightning_fabric ("module 'sys' has no attribute get_int_max_str_digits")
#         even though `import torch` succeeded at build time. Fix: install a REAL
#         python 3.11 point release from deadsnakes, and add hard build gates that
#         exercise the full boltz import chain (below) so this fails the BUILD.
FROM nvidia/cuda:12.4.1-cudnn-devel-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    BOLTZ_CACHE=/root/boltz2_cache \
    PIP_NO_CACHE_DIR=1

# Real python 3.11 (point release, not Ubuntu 22.04's rc1) via deadsnakes.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      software-properties-common ca-certificates curl git \
 && add-apt-repository -y ppa:deadsnakes/ppa \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
      python3.11 python3.11-venv python3.11-dev \
 && rm -rf /var/lib/apt/lists/* \
 && curl -sS https://bootstrap.pypa.io/get-pip.py | python3.11

RUN python3.11 -m pip install --upgrade pip

# boltz brings its own consistent torch; cuequivariance-torch = pure bindings
# (no CUDA-ops accelerator wheel). runpod = serverless SDK; pyyaml for manifests.
RUN python3.11 -m pip install boltz cuequivariance-torch "runpod>=1.6,<2" pyyaml

# HARD build gates (no `|| true`) — fail the build here, not at first request:
#   1. the interpreter actually has the 3.11 security backport torch needs, and
#      torch + cuequivariance import.
RUN python3.11 -c "import sys; assert hasattr(sys, 'get_int_max_str_digits'), 'python lacks get_int_max_str_digits'; import torch, cuequivariance_torch; print('OK torch', torch.__version__)"
#   2. exercise the FULL boltz CLI import chain (lightning_fabric, torch._dynamo,
#      etc.) that only blows up at runtime otherwise.
RUN boltz predict --help > /dev/null

# Pre-download the ~6 GB weights (CCD mols.tar + boltz2_conf.ckpt) into the image
# so cold starts skip the download. The builder has no GPU, so the predict itself
# fails at GPU-load — but the weight DOWNLOAD happens first, hence `|| true`.
COPY runpod/boltz2_worker/warm.yaml /tmp/warm.yaml
RUN mkdir -p /root/boltz2_cache \
 && (boltz predict /tmp/warm.yaml --out_dir /tmp/warmout --cache /root/boltz2_cache \
       --output_format pdb --diffusion_samples 1 --override || true) \
 && ls -la /root/boltz2_cache

WORKDIR /app
COPY runpod/boltz2_worker/handler.py /app/handler.py

# build-rev: 2
CMD ["python3.11", "-u", "handler.py"]
