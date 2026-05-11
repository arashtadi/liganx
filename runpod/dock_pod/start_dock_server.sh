#!/bin/bash
# Entrypoint for the Liganx dock pod container.
#
# Responsibilities:
#   1. Make sure the workspace dirs exist (a Network Volume mount may
#      arrive empty on first boot).
#   2. Capture stdout/stderr to a log file on /workspace so the user
#      can `tail -f /workspace/dock_server.log` from the web terminal
#      to see what's happening without `docker logs`.
#   3. exec uvicorn so the container's PID 1 is the actual server
#      process — docker stop / SIGTERM propagates correctly.
#
# Port 7861 must be exposed via RunPod's "HTTP services" panel for the
# backend's POD_DOCK_URL to reach us via https://<podid>-7861.proxy.runpod.net.
# If only "TCP ports" is configured the backend can't talk to us
# (proxy.runpod.net only routes HTTP-flagged ports).

set -e

LOG=/workspace/dock_server.log
mkdir -p /workspace

# Self-heal OpenCL ICD config. RunPod's base CUDA images install
# libnvidia-opencl.so.1 (via cuda-opencl-12-N) but do NOT create
# /etc/OpenCL/vendors/nvidia.icd. Without that file the ocl-icd loader
# can't find any platforms, and Vina-GPU dies with
# Err-1001:CL_PLATFORM_NOT_FOUND_KHR rc=255 on every /dock call. (Hit
# this during the 4090 cutover 2026-05-11; spent 30 min chasing it.)
# Idempotent — only writes the file when missing, then logs the path.
if [ ! -f /etc/OpenCL/vendors/nvidia.icd ]; then
    NV_OCL=$(ls /usr/lib/x86_64-linux-gnu/libnvidia-opencl.so.1 2>/dev/null || echo "")
    if [ -n "$NV_OCL" ]; then
        mkdir -p /etc/OpenCL/vendors
        echo "$NV_OCL" > /etc/OpenCL/vendors/nvidia.icd
    fi
fi

# Sanity-log the GPU info so it shows up at the top of every restart's
# log — handy when chasing "why did this dock fail" questions later.
{
    echo "=== $(date -u) START dock_server ==="
    echo "--- OpenCL ICD ---"
    if [ -f /etc/OpenCL/vendors/nvidia.icd ]; then
        echo "nvidia.icd → $(cat /etc/OpenCL/vendors/nvidia.icd)"
    else
        echo "WARN: /etc/OpenCL/vendors/nvidia.icd missing; Vina-GPU will fail with CL_PLATFORM_NOT_FOUND_KHR"
    fi
    echo "--- GPU ---"
    nvidia-smi --query-gpu=name,compute_cap,driver_version,memory.total --format=csv 2>&1 || echo "(nvidia-smi failed)"
    echo "--- Python + torch ---"
    python3 -c 'import torch; print("torch", torch.__version__, "cuda", torch.cuda.is_available(), "cap", torch.cuda.get_device_capability() if torch.cuda.is_available() else None)' 2>&1 || echo "(torch import failed)"
    echo "--- QuickVina-GPU sanity ---"
    /workspace/Vina-GPU-2.1/QuickVina2-GPU-2.1/QuickVina2-GPU-2-1 --help 2>&1 | head -3 || echo "(vina --help failed)"
    echo "--- GNINA sanity ---"
    /usr/local/bin/gnina --version 2>&1 | head -3 || echo "(gnina --version failed)"
    echo "--- starting uvicorn on :7861 ---"
} >> "$LOG" 2>&1

cd /workspace

exec uvicorn dock_server:app --host 0.0.0.0 --port 7861 >> "$LOG" 2>&1
