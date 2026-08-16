# Liganx GNINA GPU serverless worker — SLIM multi-stage build.
#
# GNINA = AutoDock Vina's pose-search + a CNN rescoring head. The upstream
# gnina/gnina:latest image is ~23 GB compressed because it is built FROM the
# CUDA *devel* base and leaves the entire gnina + OpenBabel *build tree* (git
# clones, CMake object files) plus pip torchvision/torchaudio in the final
# image. None of that is needed at runtime — only the `gnina` binary and the
# shared libraries it actually links.
#
# This Dockerfile harvests just the gnina binary + its ldd closure (which pulls
# in libtorch/libc10, libmolgrid, boost, OpenBabel, etc.) from the fat image and
# drops them onto a matching CUDA 12.6 cuDNN *runtime* base (same CUDA + Ubuntu
# 24.04 as the upstream build, so the ABI matches). Result: a few GB instead of
# 23, so RunPod cold-start image pulls drop from ~20 min to a few minutes.
#
# Build/deploy: RunPod builds this from the repo (GitHub integration) with the
# repo ROOT as build context.

# ----------------------------------------------------------------------------
# Stage 1 — harvest gnina + its runtime shared-library closure from the fat img
# ----------------------------------------------------------------------------
FROM gnina/gnina:latest AS fat
SHELL ["/bin/bash", "-c"]
# NOTE: best-effort harvest — `set -x` for tracing only, NOT `set -e`/pipefail.
# `find /` legitimately exits non-zero (permission-denied on /proc etc.), which
# under `set -e`+pipefail would abort inside `VAR="$(find ... | head)"`. The
# real correctness gate is the ldd check in the runtime stage below.
RUN set -x; \
    mkdir -p /slim/bin /slim/libs /slim/ob; \
    GNINA="$(command -v gnina)"; echo "gnina binary: $GNINA"; \
    cp -L "$GNINA" /slim/bin/gnina; \
    # Make sure ldd can resolve everything the fat image resolves at runtime:
    # include torch/lib (libtorch) and the CUDA lib dir on the search path.
    TORCHLIB="$(find / -type d -path '*/torch/lib' 2>/dev/null | head -1)"; \
    echo "torch lib dir: ${TORCHLIB:-<none>}"; \
    export LD_LIBRARY_PATH="${TORCHLIB}:/usr/local/cuda/lib64:/usr/local/cuda/lib64/stubs:${LD_LIBRARY_PATH:-}"; \
    echo "=== full ldd of gnina ==="; ldd "$GNINA" || true; \
    # Collect the transitive shared-library closure, then drop the CUDA/cuDNN/
    # NCCL/math libs that the runtime base already provides (avoids shadowing
    # the base's matched versions and their dlopen'd sub-libraries).
    ldd "$GNINA" | awk '{for(i=1;i<=NF;i++) if($i ~ /^\//) print $i}' | sort -u > /tmp/all.txt; \
    # Drop (a) the system CUDA tree under /usr/local/cuda — the runtime base
    # provides matched 12.6 versions; (b) the libcuda driver stub — injected by
    # the GPU runtime; (c) core glibc / loader / libstdc++ — copying those onto
    # LD_LIBRARY_PATH ahead of the (same ubuntu24.04) base would risk ABI breaks.
    # Everything torch bundles under .../torch/lib is KEPT (self-consistent set).
    grep -vE '^/usr/local/cuda/|/(libcuda|ld-linux-x86-64|libc|libm|libdl|libpthread|librt|libresolv|libutil|libnss_[a-z]+|libgcc_s|libstdc\+\+)\.so' /tmp/all.txt > /tmp/keep.txt || true; \
    echo "=== libraries being copied ==="; cat /tmp/keep.txt; \
    while read -r f; do [ -e "$f" ] && cp -Lv "$f" /slim/libs/ || echo "MISSING: $f"; done < /tmp/keep.txt; \
    # libmolgrid (gnina's gridding lib) — copy explicitly in case it is dlopen'd
    find / -name 'libmolgrid*.so*' -exec cp -Lv {} /slim/libs/ \; 2>/dev/null || true; \
    # libtorch runtime — gnina's CNN links it; torch dlopens sub-libs (e.g.
    # libtorch_cuda_linalg) NOT visible to ldd, so copy the whole torch/lib set.
    if [ -n "${TORCHLIB:-}" ]; then find "$TORCHLIB" -maxdepth 1 -name '*.so*' -exec cp -Lv {} /slim/libs/ \; 2>/dev/null || true; fi; \
    # CUDA math/runtime libs that gnina links. In this torch-based image they do
    # NOT live in /usr/local/cuda/lib64 (that dir may not even exist) — they are
    # pip nvidia-*-cu12 wheels under site-packages/nvidia/<pkg>/lib. ldd + the
    # /usr/local/cuda copy both miss them. Name-based GLOBAL find catches each one
    # wherever it lives (pip wheel, torch/lib, or /usr/local/cuda). Definitive.
    find / \( \
        -name 'libcufft*.so*'    -o -name 'libcublas*.so*'   -o -name 'libcublasLt*.so*' -o \
        -name 'libcurand*.so*'   -o -name 'libcusparse*.so*' -o -name 'libcusolver*.so*' -o \
        -name 'libcudart*.so*'   -o -name 'libcupti*.so*'    -o -name 'libnvrtc*.so*'     -o \
        -name 'libnvjitlink*.so*' -o -name 'libnvToolsExt*.so*' -o -name 'libnppc*.so*'   -o \
        -name 'libcudnn*.so*' \
      \) -exec cp -Lv {} /slim/libs/ \; 2>/dev/null || true; \
    # Belt-and-suspenders: copy the ENTIRE pip nvidia-*-cu12 wheel lib tree so no
    # CUDA lib can be missing even if not named above (cufft/cublas/cudnn/nccl/…).
    find / -path '*/nvidia/*/lib/*.so*' -exec cp -Lv {} /slim/libs/ \; 2>/dev/null || true; \
    # OpenBabel is dlopen'd (format plugins) + reads element/typing data files,
    # neither of which ldd captures. Copy the plugin dir + data dir + core lib.
    find / -name 'libopenbabel*.so*' -exec cp -Lv {} /slim/libs/ \; 2>/dev/null || true; \
    OBPLUGIN_PARENT="$(find / -type d -path '*/lib*/openbabel*' 2>/dev/null | head -1)"; \
    OBDATA="$(find / -type d -path '*/share/openbabel*' 2>/dev/null | head -1)"; \
    echo "OpenBabel plugins: ${OBPLUGIN_PARENT:-<none>}   data: ${OBDATA:-<none>}"; \
    [ -n "${OBPLUGIN_PARENT:-}" ] && cp -rL "$OBPLUGIN_PARENT" /slim/ob/plugins || echo "WARN: no OB plugin dir"; \
    [ -n "${OBDATA:-}" ] && cp -rL "$OBDATA" /slim/ob/data || echo "WARN: no OB data dir"; \
    echo "=== harvested payload sizes ==="; du -sh /slim /slim/bin /slim/libs /slim/ob || true

# ----------------------------------------------------------------------------
# Stage 2 — lean runtime: CUDA 12.6 cuDNN runtime + harvested gnina
# ----------------------------------------------------------------------------
FROM nvidia/cuda:12.6.0-cudnn-runtime-ubuntu24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-pip libgomp1 ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY --from=fat /slim/bin/gnina /usr/local/bin/gnina
COPY --from=fat /slim/libs/ /opt/gnina/libs/
COPY --from=fat /slim/ob/ /opt/gnina/ob/

# gnina's harvested libs live in one flat dir; put it (and the base CUDA libs)
# on the loader path. Point OpenBabel at the copied plugin + data dirs.
ENV LD_LIBRARY_PATH=/opt/gnina/libs:/usr/local/cuda/lib64
ENV BABEL_LIBDIR=/opt/gnina/ob/plugins
ENV BABEL_DATADIR=/opt/gnina/ob/data

RUN pip3 install --no-cache-dir --break-system-packages "runpod>=1.6,<2"

# Non-fatal diagnostic: log any unresolved libs (excluding libcuda, injected at
# runtime) but DON'T fail the build — a deployable image lets us validate the
# real GNINA run end-to-end; anything missing shows up there and in worker logs.
RUN echo "=== ldd of installed gnina ==="; ldd /usr/local/bin/gnina || true; \
    missing="$(ldd /usr/local/bin/gnina 2>/dev/null | grep -i 'not found' | grep -viE 'libcuda\.so' || true)"; \
    if [ -n "$missing" ]; then echo "WARN: unresolved (non-driver) libs — may need harvesting:"; echo "$missing"; else echo "OK: all non-driver libraries resolve"; fi

WORKDIR /app
COPY runpod/gnina_worker/handler.py /app/handler.py

# build-rev: 5 (slim multi-stage: harvest binary+libs onto cuDNN runtime base)
CMD ["python3", "-u", "handler.py"]
