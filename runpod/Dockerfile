# DeltaDock RunPod serverless worker.
#
# Engine: QuickVina 2.1 — a CPU-only fork of AutoDock Vina that uses smarter
# local-optimization heuristics to skip clearly-bad poses early. ~3-5x faster
# than vanilla Vina at exhaustiveness=8 with identical scoring (it inherits
# Vina's scoring function), so results are directly comparable to local runs.
#
# Why not the GPU variants: per-second cost on RunPod GPU workers is high
# enough that for our single-dispatch pattern (one docking per /runsync call),
# QuickVina on a cheap CPU3 worker beats Vina-GPU on a GPU worker by ~4x in
# total $ cost. GPU only wins when batching many ligands per call, which our
# backend doesn't do today.

FROM python:3.12-slim

# Open Babel still useful for any ad-hoc format conversions inside the
# handler. wget for downloading the QuickVina binary.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        wget ca-certificates \
        openbabel \
 && rm -rf /var/lib/apt/lists/*

# QuickVina 2.1 — single static-linked Linux binary committed to the upstream
# repo. We pin the file path (master is stable for this binary). The handler
# expects to find it at /usr/local/bin/qvina2.1.
RUN wget -qO /usr/local/bin/qvina2.1 \
        https://github.com/QVina/qvina/raw/master/bin/qvina2.1 \
 && chmod +x /usr/local/bin/qvina2.1 \
 && /usr/local/bin/qvina2.1 --version 2>&1 | head -3 || true

# Python deps for the worker. RunPod's `runpod` package provides the
# serverless harness (handler bootstrap + queue listener).
RUN pip install --no-cache-dir runpod==1.6.2

WORKDIR /app
COPY handler.py /app/handler.py

# RunPod expects the entrypoint to call runpod.serverless.start() — handler.py
# does that under `if __name__ == "__main__":`.
CMD ["python", "-u", "handler.py"]
