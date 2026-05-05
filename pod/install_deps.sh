#!/bin/bash
# Idempotent system + Python deps for the dock_server.
# Sourced from start_dock_server.sh on every boot. Self-heals after
# a container rebuild. Skips if already installed (~1s on warm boot).
#
# QuickVina2-GPU runtime needs three things on this RunPod image:
#   1. libboost-{program_options,filesystem,thread}1.74.0  (binary links)
#   2. ocl-icd-libopencl1 + /etc/OpenCL/vendors/nvidia.icd (OpenCL ICD)
#   3. fastapi/uvicorn/pydantic                            (FastAPI server)
#
# (2) is the gotcha — without nvidia.icd, OpenCL clGetPlatformIDs returns
# CL_PLATFORM_NOT_FOUND_KHR (-1001) and the binary exits rc=255 even
# though libnvidia-opencl.so.1 IS installed by the NVIDIA driver. The
# ICD file just tells the OpenCL loader where to find the NVIDIA backend.
set -u
LOG=/workspace/dock_server_boot.log
echo "==== $(date -Is) install_deps.sh ====" >> "$LOG"

# ---- 1. Boost runtime libraries QuickVina2-GPU links against ----
NEED_BOOST=0
for pkg in libboost-program-options1.74.0 libboost-filesystem1.74.0 libboost-thread1.74.0; do
    dpkg -s "$pkg" >/dev/null 2>&1 || NEED_BOOST=1
done
# ---- 2. OpenCL ICD loader (NVIDIA OpenCL backend is already present
#         in /usr/lib/x86_64-linux-gnu/libnvidia-opencl.so.1, just need
#         the ICD-loader package and the registration file) ----
NEED_OCL=0
dpkg -s ocl-icd-libopencl1 >/dev/null 2>&1 || NEED_OCL=1

if [ "$NEED_BOOST" = "1" ] || [ "$NEED_OCL" = "1" ]; then
    apt-get update >> "$LOG" 2>&1
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        libboost-program-options1.74.0 \
        libboost-filesystem1.74.0 \
        libboost-thread1.74.0 \
        ocl-icd-libopencl1 >> "$LOG" 2>&1
fi

# ---- Register the NVIDIA OpenCL ICD if not already present ----
if [ ! -f /etc/OpenCL/vendors/nvidia.icd ]; then
    mkdir -p /etc/OpenCL/vendors
    echo "libnvidia-opencl.so.1" > /etc/OpenCL/vendors/nvidia.icd
    ldconfig
fi

# ---- 3. Python deps ----
python3 -m pip install --quiet --no-warn-script-location \
    fastapi uvicorn pydantic >> "$LOG" 2>&1 || true
