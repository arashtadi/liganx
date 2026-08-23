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
#         cuequivariance_ops_torch"). Tried `pip install "boltz[cuda]"`.
#   rev4: boltz[cuda] pulled torch 2.13.0+cu130 (CUDA 13). RunPod's GPUs run
#         driver 550 (CUDA 12.4), which can't run a CUDA-13 build ->
#         torch.cuda.is_available()==False. Root fix: DON'T use kernels. boltz's
#         TriangleMultiplication has a pure-PyTorch fallback (use_kernels=False,
#         via the --no_kernels predict flag), so we install PLAIN boltz on a
#         cu12 torch (2.11.0+cu128) and never touch cuequivariance. Validated on
#         RTX 4090 / driver 550 end to end (see BOLTZ2_VALIDATE.md field notes).
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

# rev4: CUDA-12 torch + PLAIN boltz (NOT boltz[cuda]). boltz[cuda] pulled
# torch 2.13.0+cu130, which needs a CUDA-13 driver (>=580); RunPod's fleet runs
# driver 550 (CUDA 12.4) so torch.cuda.is_available() came back False. We pin a
# cu12 torch (2.11.0+cu128 — CUDA 12.x runs on driver 550 via minor-version
# compat) and run the handler with --no_kernels (boltz's pure-PyTorch triangle
# path), so NO cuequivariance kernels are needed at all. Validated on an RTX
# 4090/driver-550: ABL T315I/imatinib delta +1.05 = resistance (correct dir).
# The constraint file keeps boltz from upgrading torch back to 2.13.
RUN python3.11 -m pip install torch==2.11.0 --index-url https://download.pytorch.org/whl/cu128
RUN printf 'torch==2.11.0\n' > /tmp/con.txt \
 && python3.11 -m pip install -c /tmp/con.txt boltz "runpod>=1.6,<2" pyyaml

# Build-time import gate (no `|| true`): catches interpreter / torch / lightning
# breakage at BUILD. No cuequivariance import here — the --no_kernels path never
# touches it. (torch.cuda can't be checked: the builder has no GPU.)
RUN python3.11 -c "import sys; assert hasattr(sys, 'get_int_max_str_digits'); import torch, boltz; print('OK torch', torch.__version__)"
RUN boltz predict --help > /dev/null

# Pre-download the ~6 GB weights (CCD mols.tar + boltz2_conf.ckpt) into the image
# so cold starts skip the download. Builder has no GPU, so the predict fails at
# GPU-load — but the weight DOWNLOAD happens first, hence `|| true`.
COPY runpod/boltz2_worker/warm.yaml /tmp/warm.yaml
RUN mkdir -p /root/boltz2_cache \
 && (boltz predict /tmp/warm.yaml --out_dir /tmp/warmout --cache /root/boltz2_cache \
       --output_format pdb --diffusion_samples 1 --override --no_kernels || true) \
 && ls -la /root/boltz2_cache

WORKDIR /app
COPY runpod/boltz2_worker/handler.py /app/handler.py

# build-rev: 4
CMD ["python3.11", "-u", "handler.py"]
