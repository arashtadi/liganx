# Liganx GNINA GPU serverless worker.
#
# GNINA = AutoDock Vina's pose-search + a CNN rescoring head trained on PDBbind.
# The CNN needs a GPU to be fast, so this worker MUST run on a RunPod GPU
# serverless endpoint (unlike the CPU QuickVina worker in ../Dockerfile).
#
# Base image: the upstream gnina/gnina image already ships the `gnina` binary
# built against CUDA + libmolgrid, plus Open Babel for format conversion.
# We add only the RunPod serverless harness + our handler.
#
# Build/deploy: RunPod builds this from the repo (GitHub integration) when a
# GPU serverless endpoint is pointed at runpod/gnina_worker/Dockerfile.
FROM gnina/gnina:latest

# RunPod's serverless SDK (handler bootstrap + queue listener). The gnina
# image is Ubuntu-based with system python3; install pip if missing, then the
# runpod package. Kept tolerant so a base-image python bump doesn't break us.
RUN (command -v pip3 >/dev/null 2>&1 || (apt-get update && apt-get install -y --no-install-recommends python3-pip && rm -rf /var/lib/apt/lists/*)) \
 && pip3 install --no-cache-dir "runpod>=1.6,<2"

# Sanity: fail the build early if gnina isn't runnable in the image.
RUN gnina --version 2>&1 | head -3 || (echo "gnina not found in base image" && exit 1)

WORKDIR /app
# NOTE: RunPod's GitHub build uses the REPO ROOT as the build context (with
# this Dockerfile referenced by path), so COPY sources are repo-root-relative.
COPY runpod/gnina_worker/handler.py /app/handler.py

# RunPod calls handler() per request via runpod.serverless.start() in __main__.
CMD ["python3", "-u", "handler.py"]
