# Liganx Boltz-2 GPU serverless worker.
#
# Boltz-2 (Wohlwend et al., 2025; MIT) ML co-folding + binding-affinity model.
# Built by RunPod from this repo (GitHub integration), repo ROOT as build
# context — same deploy path as runpod/gnina_worker/Dockerfile.
#
# DEPENDENCY LESSONS (see runpod/BOLTZ2_VALIDATE.md "Field notes"):
#   rev1: boltz on a pre-baked pytorch image + a stray cuequivariance-ops wheel
#         pulled a broken torch. Moved to a plain CUDA base.
#   rev2: Ubuntu 22.04's OWN python3.11 apt package is a release candidate that
#         LACKS sys.get_int_max_str_digits -> torch._dynamo/lightning crash at
#         runtime. Fixed by installing a REAL python 3.11 from deadsnakes.
#   rev3: boltz + ONLY cuequivariance-torch is insufficient — boltz's triangle
#         layer needs the cuequivariance CUDA KERNELS at runtime
#         ("ImportError: ... triangle_multiplicative_update from
#         cuequivariance_ops_torch"). boltz's pyproject puts those in an OPTIONAL
#         extra: cuequivariance_ops_cu12 / cuequivariance_ops_torch_cu12 /
#         cuequivariance_torch (all >=0.5.0). The correct install is the OFFICIAL
#         CUDA extra: `pip install "boltz[cuda]"`, which pulls the matched trio.
#         NOTE: this failure only shows at GPU RUNTIME (the builder has no GPU),
#         so it can't be gated at build time — validate with a real prediction.
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

# OFFICIAL CUDA install: boltz[cuda] pulls boltz + its own consistent torch AND
# the cuequivariance CUDA-kernel trio (ops_cu12 / ops_torch_cu12 / torch) at
# mutually compatible versions. runpod = serverless SDK; pyyaml for manifests.
RUN python3.11 -m pip install "boltz[cuda]" "runpod>=1.6,<2" pyyaml

# Build-time import gate (no `|| true`): catches interpreter / torch / lightning
# breakage at BUILD. (The cuequivariance *kernel* only loads on a real GPU, so
# it can't be checked here — that's what the post-deploy prediction test is for.)
RUN python3.11 -c "import sys; assert hasattr(sys, 'get_int_max_str_digits'); import torch, cuequivariance_torch; print('OK torch', torch.__version__)"
RUN boltz predict --help > /dev/null

# Pre-download the ~6 GB weights (CCD mols.tar + boltz2_conf.ckpt) into the image
# so cold starts skip the download. Builder has no GPU, so the predict fails at
# GPU-load — but the weight DOWNLOAD happens first, hence `|| true`.
COPY runpod/boltz2_worker/warm.yaml /tmp/warm.yaml
RUN mkdir -p /root/boltz2_cache \
 && (boltz predict /tmp/warm.yaml --out_dir /tmp/warmout --cache /root/boltz2_cache \
       --output_format pdb --diffusion_samples 1 --override || true) \
 && ls -la /root/boltz2_cache

WORKDIR /app
COPY runpod/boltz2_worker/handler.py /app/handler.py

# build-rev: 3
CMD ["python3.11", "-u", "handler.py"]
