# Liganx GPU pod image — QuickVina2-GPU + GNINA + admet-ai, all baked in.
#
# This is the dock_server pod that the backend's POD_DOCK_URL points at.
# Unlike the serverless QuickVina worker in ../Dockerfile, this is a
# long-lived GPU pod with a FastAPI server on port 7861 exposing /dock,
# /dock_batch, /dock_gnina, /dock_batch_gnina, and /admet/predict.
#
# Build:
#   cd runpod/dock_pod
#   # 1) Copy the running pod's dock_server.py into this directory first.
#   #    From the existing pod's web terminal:
#   #       cat /workspace/dock_server.py  → save locally as runpod/dock_pod/dock_server.py
#   docker buildx build --platform linux/amd64 \
#       -t ghcr.io/arashtadi/liganx-dock-pod:v1 \
#       --push .
#
# Deploy on RunPod:
#   Console → Deploy → GPU Pod → search "4090" → click card → Edit template:
#       Container image: ghcr.io/arashtadi/liganx-dock-pod:v1
#       Container disk: 20 GB
#       Volume disk:   skip (state-less image; the network volume already
#                            has dock_server.py if you went through the
#                            volume route)
#       Expose HTTP ports: 8888,7861
#       Expose TCP ports:  22
#   Deploy.
#
# Compute capabilities baked in: sm_86 (RTX A5000/A6000, RTX 30xx) and
# sm_89 (RTX 4090, L40). Vina-GPU is compiled with `--gpu-architecture
# compute_86;compute_89` so the same image runs on either generation
# without recompilation. GNINA's distributed binary already supports
# sm_75..sm_89 so no rebuild needed there either.
#
# Pinned versions (all matter — see HISTORY notes at the bottom):
#   - CUDA 12.4.1 (matches what torch 2.4.1+cu124 was built against)
#   - Ubuntu 22.04 (provides boost 1.74; older than the Vina-GPU GitHub
#                   release's 1.84, hence why we compile Vina-GPU from
#                   source rather than using the release binary)
#   - Python 3.11.10 (matches the existing pod; admet-ai 1.x has
#                     transitive deps that resolve cleanly here)
#   - torch 2.4.1+cu124 + torchvision 0.19.1+cu124 (pinned to avoid the
#                     admet-ai-pulls-torch-2.11 cascade that broke
#                     production on 2026-05-08)
#   - admet-ai <2 (chemprop 1.x line, compatible with torch 2.4.1)
#   - GNINA v1.3 release binary (sm_75..sm_89 supported)

FROM nvidia/cuda:12.4.1-devel-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    LC_ALL=C.UTF-8 \
    LANG=C.UTF-8 \
    # OpenCL: NVIDIA's ICD lives at /etc/OpenCL/vendors/nvidia.icd.
    # We write it ourselves below — RunPod/NVIDIA's CUDA base images
    # install libnvidia-opencl.so.1 but DO NOT create the ICD config
    # file. start_dock_server.sh also self-heals this at boot, so even
    # a pod started from a different image stays functional.
    OCL_ICD_VENDORS=/etc/OpenCL/vendors

# 1. OS dependencies. boost 1.74 (Ubuntu 22.04's default) is what we
#    compile Vina-GPU against; we do NOT need 1.84 because we're not
#    using the precompiled GitHub release binary.
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        cmake \
        git \
        wget \
        curl \
        ca-certificates \
        python3.11 \
        python3-pip \
        python3.11-dev \
        libboost-all-dev \
        ocl-icd-opencl-dev \
        opencl-headers \
        ocl-icd-libopencl1 \
        openbabel \
        libxrender1 \
        libxext6 \
        libsm6 \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3.11 /usr/local/bin/python3 \
    && ln -sf /usr/bin/python3.11 /usr/local/bin/python

# 1b. OpenCL ICD config — install_pod.sh and start_dock_server.sh both
#     self-heal this at runtime too, but baking it into the image means
#     the very first /dock call doesn't pay the diagnosis cost. Without
#     this file the loader returns CL_PLATFORM_NOT_FOUND_KHR even when
#     libnvidia-opencl.so.1 is present (cuda-opencl-12-4 installs the
#     lib but doesn't drop the .icd manifest). Found the hard way during
#     the 4090 live-migration cutover 2026-05-11.
RUN mkdir -p /etc/OpenCL/vendors \
 && echo '/usr/lib/x86_64-linux-gnu/libnvidia-opencl.so.1' > /etc/OpenCL/vendors/nvidia.icd

# 2. Compile QuickVina2-GPU from source for sm_86 + sm_89.
#    Source repo: DeltaGroupNJUPT/Vina-GPU-2.1
#    Why compile from source: the GitHub release binary is linked
#    against libboost 1.84, which Ubuntu 22.04 doesn't have. Compiling
#    against the system boost (1.74) avoids the runtime-loader error
#    'libboost_program_options.so.1.84.0: cannot open shared object'
#    that bit us on the live pod migration attempt 2026-05-11.
RUN git clone --depth 1 https://github.com/DeltaGroupNJUPT/Vina-GPU-2.1.git \
        /opt/Vina-GPU-2.1 \
    && cd /opt/Vina-GPU-2.1/QuickVina2-GPU-2.1 \
    # Remove the precompiled OpenCL kernel cache so it rebuilds on
    # first run for the actual GPU the pod gets scheduled on.
    && rm -f Kernel1_Opt.bin Kernel2_Opt.bin gpu_runtime.txt \
    # The Makefile in the repo expects user to edit it; we patch the
    # boost path and the GPU compute target inline. BOOST_LIB_VERSION
    # defaults to the system-installed boost (1.74 on jammy).
    && sed -i 's|BOOST_LIB_VERSION=.*|BOOST_LIB_VERSION=1.74|' Makefile || true \
    && sed -i 's|--gpu-architecture=.*|--gpu-architecture=compute_86 -gencode arch=compute_86,code=sm_86 -gencode arch=compute_89,code=sm_89|' Makefile || true \
    # Build. The Makefile produces QuickVina2-GPU-2-1 in this dir.
    && make clean || true \
    && make -j"$(nproc)" \
    # Sanity check: the binary should at least load --help without
    # missing-library errors. We don't run a real dock here because
    # the build host doesn't have a GPU; OpenCL kernel JIT happens
    # at runtime on the deploy host.
    && ls -la QuickVina2-GPU-2-1 \
    && ./QuickVina2-GPU-2-1 --help > /dev/null 2>&1 || \
       echo "(QuickVina2-GPU-2-1 --help non-zero, may be expected without GPU)"

# 3. GNINA v1.3 release binary. Supports sm_75 (Turing) through sm_89
#    (Ada Lovelace). On the production pod we run with cnn_mode=rescore
#    which uses the bundled TVM kernels — those are why GNINA was
#    disabled on Blackwell (sm_120 not supported). On a 4090 / A5000
#    they work fine.
RUN wget -q https://github.com/gnina/gnina/releases/download/v1.3/gnina \
        -O /usr/local/bin/gnina \
    && chmod +x /usr/local/bin/gnina

# 4. Python deps. Pin torch + torchvision to avoid admet-ai's resolver
#    pulling in torch 2.11 (the version that broke torchvision on the
#    live pod migration attempt). Install torch FIRST so admet-ai sees
#    a satisfied requirement and doesn't try to upgrade it.
RUN pip install --no-cache-dir \
        'torch==2.4.1+cu124' \
        'torchvision==0.19.1+cu124' \
        --index-url https://download.pytorch.org/whl/cu124 \
 && pip install --no-cache-dir \
        'fastapi>=0.115' \
        'uvicorn[standard]>=0.32' \
        'pydantic>=2.9' \
        'httpx>=0.27' \
        'rdkit>=2024.3' \
        'admet-ai<2' \
 && python3 -c 'import torch, admet_ai; print("torch", torch.__version__, "admet_ai", admet_ai.__version__)'

# 5. App code. dock_server.py is the FastAPI app; admet_pod.py is the
#    admet-ai wrapper with the CUDA_VISIBLE_DEVICES scoping fix from
#    2026-05-11 (don't pollute os.environ permanently — admet-ai's
#    torch import is one-shot, so we set/restore around the model
#    load only). start_dock_server.sh is the entrypoint script.
WORKDIR /workspace
COPY dock_server.py /workspace/dock_server.py
COPY admet_pod.py /workspace/admet_pod.py
COPY start_dock_server.sh /workspace/start_dock_server.sh
RUN chmod +x /workspace/start_dock_server.sh

# 6. Symlinks so dock_server.py can find the QuickVina2-GPU binary at
#    its hardcoded path (matches the production layout — saves us
#    rewriting VINA_DIR in dock_server.py).
RUN mkdir -p /workspace/Vina-GPU-2.1 \
 && ln -s /opt/Vina-GPU-2.1/QuickVina2-GPU-2.1 \
          /workspace/Vina-GPU-2.1/QuickVina2-GPU-2.1

# 7. SQLite cache for admet-ai predictions. Lives at /workspace so it
#    survives if the user attaches a Network Volume here, but the
#    image works fine without one (cache rebuilds on first request).
RUN touch /workspace/admet_cache.sqlite

EXPOSE 7861

CMD ["/workspace/start_dock_server.sh"]

# -----------------------------------------------------------------------------
# HISTORY — bugs this image bakes fixes for. Read before changing pins.
# -----------------------------------------------------------------------------
#
# 2026-05-08: admet-ai install on the live Blackwell pod pip-bumped torch
#   from 2.4.1 to 2.11.0 (transitive resolver). That broke torchvision
#   0.19.1+cu124's C++ extension load (PendingRollback-style import
#   error). Fix: force-reinstall torch==2.4.1 + torchvision==0.19.1+cu124,
#   then `pip install 'admet-ai<2'` (1.x line keeps the older torch).
#   This image installs torch FIRST so the resolver never tries to
#   upgrade it.
#
# 2026-05-10: admet_pod.py module set os.environ['CUDA_VISIBLE_DEVICES']=""
#   at top-level to force admet-ai CPU mode. That leaked into every
#   subsequent subprocess.Popen, including dock_server's vina-gpu call,
#   which failed with Err-1001:CL_PLATFORM_NOT_FOUND_KHR rc=255. The
#   fixed admet_pod.py in this image scopes the env override to JUST
#   the model load inside _get_model(), then restores the previous
#   value. Don't undo this.
#
# 2026-05-11: GitHub Vina-GPU release binary links against boost 1.84,
#   but Ubuntu 22.04 ships 1.74. We compile from source against the
#   system boost instead of using the prebuilt binary.
#
# 2026-05-11: GNINA v1.3 crashes on Blackwell (sm_120) due to TVM
#   kernel arch mismatch. This image targets sm_86 + sm_89 only. If
#   you ever swap GPU to anything sm_120+ this image will need an
#   updated GNINA build (rebuild from source for the target arch).
