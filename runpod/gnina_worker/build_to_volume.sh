#!/usr/bin/env bash
# Build GNINA + every runtime library it needs onto a RunPod NETWORK VOLUME, so
# the serverless worker image can stay tiny (~250 MB) and cold-start in seconds
# instead of slow-pulling a 7.4 GB image.
#
# Run INSIDE a builder pod started from
#   nvidia/cuda:12.6.3-cudnn-devel-ubuntu22.04
# with the target network volume mounted at /runpod-volume:
#
#   bash build_to_volume.sh
#
# Result on the volume:
#   /runpod-volume/gnina/bin/gnina        the binary (rpath -> ../lib)
#   /runpod-volume/gnina/lib/*.so*        libtorch + molgrid + openbabel + CUDA
#                                         runtime + boost/glog/... (everything
#                                         EXCEPT core glibc + the NVIDIA driver)
#   /runpod-volume/gnina/BUILT_AT         timestamp marker
#
# The runtime image only needs: ubuntu:22.04 + python3 + runpod + handler.py,
# with PATH=/runpod-volume/gnina/bin and LD_LIBRARY_PATH=/runpod-volume/gnina/lib.
set -euo pipefail

VOL=/runpod-volume
DEST="$VOL/gnina"
export DEBIAN_FRONTEND=noninteractive
export CMAKE_CUDA_ARCHITECTURES="80;86;89"
export TORCH_CUDA_ARCH_LIST="8.0;8.6;8.9"

test -d "$VOL" || { echo "FATAL: $VOL not mounted (attach the network volume at /runpod-volume)"; exit 1; }

echo "== apt build deps =="
apt-get update
apt-get install -y --no-install-recommends \
  build-essential git wget unzip ca-certificates \
  libboost-all-dev libeigen3-dev libgoogle-glog-dev \
  libprotobuf-dev protobuf-compiler libhdf5-dev libatlas-base-dev \
  python3-dev python3-numpy python3-pip python3-setuptools \
  librdkit-dev libjsoncpp-dev swig zlib1g-dev patchelf file

echo "== modern cmake (pin <4; CMake 4 breaks the openbabel fork) =="
pip3 install --no-cache-dir "cmake<4" ninja pytest
cmake --version

echo "== OpenBabel (dkoes fork) =="
rm -rf /tmp/ob && git clone --depth 1 https://github.com/dkoes/openbabel.git /tmp/ob
cd /tmp/ob && mkdir build && cd build
cmake -DCMAKE_POLICY_VERSION_MINIMUM=3.5 -DWITH_MAEPARSER=OFF -DWITH_COORDGEN=OFF \
      -DPYTHON_BINDINGS=ON -DRUN_SWIG=ON ..
make -j"$(nproc)" && make install && ldconfig

echo "== GNINA (sm_80;86;89; cmake auto-downloads official libtorch) =="
rm -rf /opt/gnina-src && git clone --recursive --depth 1 https://github.com/gnina/gnina.git /opt/gnina-src
cd /opt/gnina-src && mkdir build && cd build
cmake -DCMAKE_POLICY_VERSION_MINIMUM=3.5 -DCMAKE_CUDA_ARCHITECTURES="80;86;89" -DCMAKE_BUILD_TYPE=Release ..
make -j"$(nproc)"
make install
ldconfig
command -v gnina
gnina --version

echo "== assemble volume payload =="
rm -rf "$DEST"
mkdir -p "$DEST/bin" "$DEST/lib"
cp -v "$(command -v gnina)" "$DEST/bin/gnina"

# Recursively resolve every shared lib gnina + libtorch pull in, copy all EXCEPT
# core glibc + loader (must come from the runtime image's own libc) and the
# NVIDIA driver libs (libcuda/libnvidia-* are bind-mounted from the host by the
# container runtime — bundling them would shadow the real driver).
python3 - "$DEST" <<'PY'
import os, re, subprocess, shutil, sys
dest = sys.argv[1]
libdir = os.path.join(dest, "lib")
os.makedirs(libdir, exist_ok=True)

seeds = [os.path.join(dest, "bin", "gnina")]
# libtorch + any .so gnina's build downloaded/produced
for root, _, files in os.walk("/opt/gnina-src/build/_deps"):
    for f in files:
        if f.endswith(".so") or ".so." in f:
            seeds.append(os.path.join(root, f))
# anything make install dropped into /usr/local
for base in ("/usr/local/lib", "/usr/local/lib64"):
    if os.path.isdir(base):
        for f in os.listdir(base):
            if f.endswith(".so") or ".so." in f:
                seeds.append(os.path.join(base, f))

EXCLUDE = re.compile(
    r'^(linux-vdso|ld-linux|libc\.so|libm\.so|libpthread|libdl\.so|librt\.so'
    r'|libresolv|libnsl|libutil|libcuda\.so|libnvidia-)')

def ldd(path):
    out = {}
    try:
        r = subprocess.run(["ldd", path], capture_output=True, text=True)
    except Exception:
        return out
    for line in r.stdout.splitlines():
        m = re.search(r'=>\s+(/\S+)', line)
        if m and os.path.exists(m.group(1)):
            out[os.path.basename(m.group(1))] = m.group(1)
    return out

seen, queue, copied = set(), list(seeds), {}
while queue:
    p = queue.pop()
    if p in seen:
        continue
    seen.add(p)
    for base, resolved in ldd(p).items():
        if EXCLUDE.match(base):
            continue
        if resolved not in copied:
            copied[resolved] = base
            queue.append(resolved)

# copy resolved deps + the seed .so themselves (libtorch etc.)
for resolved in list(copied) + [s for s in seeds if not s.endswith("gnina")]:
    tgt = os.path.join(libdir, os.path.basename(resolved))
    if not os.path.exists(tgt) and os.path.exists(resolved):
        try:
            shutil.copy2(resolved, tgt)
        except Exception as e:
            print("skip", resolved, e)
print("copied", len(os.listdir(libdir)), "libs into", libdir)
PY

echo "== rpath so gnina finds its libs even if LD_LIBRARY_PATH is unset =="
patchelf --set-rpath '$ORIGIN/../lib' "$DEST/bin/gnina" || true

echo "== bundle OpenBabel plugins + data (loaded at runtime, not via ldd) =="
OB_PLUGINDIR="$(ls -d /usr/local/lib/openbabel/*/ 2>/dev/null | head -1)"
if [ -n "$OB_PLUGINDIR" ] && [ -d "$OB_PLUGINDIR" ]; then
  mkdir -p "$DEST/lib/openbabel"; cp -a "$OB_PLUGINDIR"/*.so "$DEST/lib/openbabel/" && echo "openbabel plugins <- $OB_PLUGINDIR"
fi
OB_DATADIR="$(dirname "$(find /usr/local/share /usr/share -type f -path '*openbabel*' -name 'atomtyp.txt' 2>/dev/null | head -1)")"
if [ -n "$OB_DATADIR" ] && [ -d "$OB_DATADIR" ]; then
  mkdir -p "$DEST/share/openbabel"; cp -a "$OB_DATADIR"/* "$DEST/share/openbabel/" && echo "openbabel data <- $OB_DATADIR"
fi

echo "== bundle nvrtc + builtins (libtorch dlopen's these; ldd misses them) =="
find / \( -name 'libnvrtc.so*' -o -name 'libnvrtc-builtins.so*' \) 2>/dev/null | grep -v "$DEST/" | while read -r f; do cp -a "$f" "$DEST/lib/" 2>/dev/null && echo "nvrtc <- $f"; done
# libtorch here is a cu121 build: its JIT dlopens libnvrtc-builtins.so.12.1
# specifically. The CUDA 12.6 base only ships 12.6, so fetch the matching 12.1
# nvrtc from pip and bundle it (covers whatever minor libtorch actually needs).
for ver in 12.1.105 12.1.55 12.1; do pip3 install --no-cache-dir "nvidia-cuda-nvrtc-cu12==$ver" >/dev/null 2>&1 && break; done
find / -path '*cuda_nvrtc/lib*' \( -name 'libnvrtc.so*' -o -name 'libnvrtc-builtins.so*' \) 2>/dev/null | while read -r f; do cp -a "$f" "$DEST/lib/" 2>/dev/null && echo "pip-nvrtc <- $f"; done
# ensure the exact soname the loader dlopen's (e.g. libnvrtc-builtins.so.12.6) exists
( cd "$DEST/lib" || exit 0
  for real in libnvrtc-builtins.so.*.* libnvrtc.so.*.*; do
    [ -e "$real" ] || continue; so="${real%.*}"; [ -e "$so" ] || ln -sf "$real" "$so"
  done ) || true
# gnina/openbabel bindings sometimes pull libpython at plugin-load; bundle it too
find / -name 'libpython3*.so*' 2>/dev/null | grep -v "$DEST/" | while read -r f; do cp -a "$f" "$DEST/lib/" 2>/dev/null && echo "libpython <- $f"; done

echo "== sanity: every gnina dep resolves against the volume =="
miss=$(LD_LIBRARY_PATH="$DEST/lib" ldd "$DEST/bin/gnina" | grep -i "not found" || true)
if [ -n "$miss" ]; then echo "!! MISSING:"; echo "$miss"; else echo "OK: all libs resolve"; fi
LD_LIBRARY_PATH="$DEST/lib" "$DEST/bin/gnina" --version

echo "== size =="
du -sh "$DEST"; echo "lib count: $(ls "$DEST/lib" | wc -l)"
date -u +"%Y-%m-%dT%H:%M:%SZ" > "$DEST/BUILT_AT"
echo "DONE build_to_volume"
