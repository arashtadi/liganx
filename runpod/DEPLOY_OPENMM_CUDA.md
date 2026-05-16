# J18 — rebuild openmm against the pod's CUDA 12.8 (proper resolution)

**Status: planned, not yet executed.**

This runbook fixes `CUDA_ERROR_UNSUPPORTED_PTX_VERSION (222)` properly,
replacing the OpenCL workaround from L5 with native CUDA on the pod's
RTX 4090. Expected speedup: ~2× the OpenCL fallback.

## Why this is needed

The conda env's `openmm 8.4.0.dev` was built against CUDA 13.x PTX. The
pod's NVIDIA driver 570.x + CUDA 12.8 toolkit can only load CUDA 12.x
PTX. Every attempt to create an openmm Context on the CUDA platform
throws CUDA_ERROR_UNSUPPORTED_PTX_VERSION (error code 222) and crashes
the FEP edge mid-MD.

L5 forces openfe to use the OpenCL platform as a workaround. OpenCL
works (verified) but is ~50 % the speed of native CUDA. J18 brings us
back to native CUDA by rebuilding openmm from source against the
correct CUDA version + the actual GPU's compute capability (sm_120 for
Blackwell consumer cards, sm_89 for RTX 4090).

## What the GPU actually is on this pod

Verify before starting:

```bash
nvidia-smi --query-gpu=name,driver_version,compute_cap --format=csv
```

Expected:
- name: NVIDIA GeForce RTX 4090 (or RTX 5090 / Blackwell variant)
- driver: 570.x
- compute_cap: 8.9 (Ada/4090) or 12.0 (Blackwell)

Note the compute_cap — you'll pass it to CMake as `-DCMAKE_CUDA_ARCHITECTURES`.

## Estimated time

- Source clone + dep install: 5 min
- CMake config: 2 min
- `make -j$(nproc)`: 30–45 min on a 4090
- `make install` + Python bindings: 5 min
- Sanity tests: 5 min

Total ~1 hour. Do this when no real FEP edges are running (the build
spikes CPU and could starve the docker dock_server if that's also
under load).

## Pre-flight snapshot (rollback insurance)

```bash
source /workspace/miniconda3/etc/profile.d/conda.sh
conda activate fep
conda list openmm openmmtools | tee /workspace/openmm_pre_j18.txt
python -c "import openmm; print('openmm path:', openmm.__file__)" >> /workspace/openmm_pre_j18.txt
ls -la /workspace/miniconda3/envs/fep/lib/python3.11/site-packages/openmm/ | head -20 >> /workspace/openmm_pre_j18.txt
```

If anything goes wrong, you can rollback with:
```bash
conda install -y --override-channels -c conda-forge openmm=8.4.0
```

## Steps

### 1. Install build dependencies

```bash
conda activate fep
apt-get update && apt-get install -y \
    cmake build-essential ninja-build \
    libfftw3-dev libopenmpi-dev \
    swig doxygen
which nvcc                      # must point at /usr/local/cuda-12.8/bin/nvcc
nvcc --version | grep release   # must say "release 12.8"
```

If nvcc is missing or the wrong version:
```bash
ls /usr/local/                  # find cuda-12.8 dir
export PATH=/usr/local/cuda-12.8/bin:$PATH
export LD_LIBRARY_PATH=/usr/local/cuda-12.8/lib64:$LD_LIBRARY_PATH
```

### 2. Clone openmm 8.2.x (stable, supports sm_89 + sm_120)

```bash
mkdir -p /workspace/openmm_build && cd /workspace/openmm_build
git clone --depth 1 --branch 8.2.0 https://github.com/openmm/openmm.git
cd openmm
```

### 3. Configure with CMake

For RTX 4090 (sm_89):
```bash
mkdir build && cd build
cmake .. \
    -GNinja \
    -DCMAKE_INSTALL_PREFIX=/workspace/miniconda3/envs/fep \
    -DCMAKE_BUILD_TYPE=Release \
    -DOPENMM_BUILD_CUDA_LIB=ON \
    -DOPENMM_BUILD_OPENCL_LIB=ON \
    -DCMAKE_CUDA_ARCHITECTURES="89" \
    -DCUDA_TOOLKIT_ROOT_DIR=/usr/local/cuda-12.8 \
    -DBUILD_TESTING=OFF \
    -DOPENMM_BUILD_PYTHON_WRAPPERS=ON \
    -DPYTHON_EXECUTABLE=/workspace/miniconda3/envs/fep/bin/python
```

For Blackwell sm_120:
```bash
# Same as above, but:
#   -DCMAKE_CUDA_ARCHITECTURES="120"
# AND verify CUDA 12.8 actually emits sm_120 PTX — older toolkits don't.
nvcc --help | grep -A 5 "gpu-architecture" | grep -o "compute_[0-9]*" | sort -u
```

### 4. Build

```bash
ninja -j$(nproc) 2>&1 | tail -100
```

Watch for warnings about CUDA arch mismatch — those are the symptom we
were trying to avoid. Build must complete with `[100%]`.

### 5. Install into the conda env

```bash
ninja install
cd /workspace/openmm_build/openmm/build
ninja PythonInstall
```

### 6. Verify the new openmm picks up CUDA

```bash
conda activate fep
python <<'PY'
import openmm
print("openmm version:", openmm.version.full_version)
print("openmm path:", openmm.__file__)
print("Available platforms:")
for i in range(openmm.Platform.getNumPlatforms()):
    p = openmm.Platform.getPlatform(i)
    print(f"  {i}: {p.getName()}")

# Smoke test: create a Context on CUDA with a tiny system
import openmm as mm
system = mm.System()
system.addParticle(1.0)
platform = mm.Platform.getPlatformByName("CUDA")
integrator = mm.VerletIntegrator(0.001)
context = mm.Context(system, integrator, platform)
print("CUDA Context created OK")
print("Platform info:", context.getPlatform().getName())
PY
```

Expected last lines:
```
CUDA Context created OK
Platform info: CUDA
```

If you see CUDA_ERROR_UNSUPPORTED_PTX_VERSION again, the CMake arch
flag didn't match the GPU's compute capability. Re-check
`nvidia-smi --query-gpu=compute_cap` and rebuild with that value.

### 7. Flip LIGANX_OPENMM_PLATFORM to CUDA

```bash
# Edit the fep_server systemd / supervisord / nohup wrapper to set:
export LIGANX_OPENMM_PLATFORM=CUDA

# Then restart fep_server so the new openmm + new env var take effect.
pkill -f 'fep_server:app'
bash /workspace/start_fep_server.sh
sleep 3
curl -s http://localhost:7862/health | python -m json.tool
```

### 8. Run a tiny real-physics smoke edge (~30 min)

Submit a 4 lambda × 0.5 ns edge through the backend with engine=sage.
Watch `/workspace/fep_jobs/<job_id>.json`:
- Expect `stage` to progress through every step
- `result.ok` should be `true`
- `wall_seconds` should be ~half of the OpenCL run for the same edge

If it crashes, rollback to OpenCL by `unset LIGANX_OPENMM_PLATFORM`
and restarting fep_server. The OpenCL path is still functional.

### 9. (Optional) Same upgrade in the Espaloma sibling env

When the Espaloma sibling env is built (K2 still pending), repeat
steps 1–7 inside `conda activate fep_espaloma`. The build artifacts
under `/workspace/openmm_build/` are reusable — only `ninja install`
+ `ninja PythonInstall` need to be re-run against the second env.

## Rollback (if step 6 fails)

```bash
conda activate fep
pip uninstall -y openmm
conda install -y --override-channels -c conda-forge openmm=8.4.0
# fep_pod.py's L5 fix still forces OpenCL, so back to the working
# OpenCL path with zero behaviour change. No data lost.
```

## Verification checklist before declaring J18 done

- [ ] `openmm.Platform.getPlatformByName("CUDA")` returns without crashing
- [ ] One real-physics edge completes with `result.ok=true` on CUDA
- [ ] Wall-clock per edge is roughly half the OpenCL baseline
- [ ] `nvidia-smi` shows the openmm process consuming GPU memory + compute
- [ ] No new errors in `/workspace/fep_server_boot.log`
- [ ] Sage AND Espaloma sibling env (once K2 lands) both work on CUDA
- [ ] `LIGANX_OPENMM_PLATFORM=CUDA` set persistently in the boot script
