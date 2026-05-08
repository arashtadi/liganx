# Liganx backend container.
#
# Layers, top to bottom:
#   1. miniforge3 base — gives us mamba for chemistry stack
#   2. apt: open babel + autodock-vina (used as a local fallback path)
#   3. mamba install: the heavy chem deps (rdkit, openmm/pdbfixer, meeko, prolif, posebusters)
#   4. pip install: the lightweight Python packages (fastapi/sqlmodel/etc.)
#   5. FoldX binary vendored from backend/vendor/foldx/ (license-restricted, NOT in git)
#   6. Application code
#
# Build context is the repo root because we need both /backend and /pipeline.
# Image lands ~3 GB; Fly.io's shared-cpu-1x with 1 GB RAM has enough headroom.

FROM condaforge/miniforge3:24.9.2-0

# Build-time arg: the deploy workflow (.github/workflows/fly-deploy.yml)
# passes --build-arg GIT_SHA="${GITHUB_SHA::7}" so /health can report
# which commit is actually live. Without the matching ARG declaration
# here the build-arg is silently dropped and main.py falls back to
# "dev" — exactly the regression the Liganx Monitor flagged on
# 2026-05-06. Default "dev" keeps local docker-build (no --build-arg)
# working unchanged. Note: fly.toml's [env] block fully overrides any
# `flyctl deploy --env` flag, so the only reliable path is baking the
# SHA into the image via ENV here.
ARG GIT_SHA=dev

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    APP_ENV=production \
    LOG_LEVEL=info \
    GIT_SHA=$GIT_SHA

# System tools: obabel (PDBQT↔PDB conversion in the pose endpoint), autodock-vina
# (only used if POD_DOCK_URL is unset — production always has it set, but we
# keep the binary as a defence-in-depth fallback so a Pod outage is degraded,
# not down).
RUN apt-get update && apt-get install -y --no-install-recommends \
        openbabel \
        autodock-vina \
        ca-certificates \
        curl \
    && rm -rf /var/lib/apt/lists/*

# Heavy chem stack via conda-forge — these are notoriously hard to pip-install
# cleanly across architectures, so let mamba resolve them. Meeko stays out of
# this list because conda-forge's meeko build (0.5.x) imports the removed
# `rdkit.six` module against modern RDKit 2024+ — it gets pip-installed below
# at >=0.6, where that import was dropped.
#
# Smina is here for Vinardo-rescoring of Vina poses — a fast (~1s) re-scoring
# pass that often discriminates close analogs better than raw Vina, narrowing
# the gap with commercial Glide XP. Conda-forge ships a pre-built linux64
# binary so this stays a one-liner.
RUN mamba install -y -n base -c conda-forge \
        python=3.12 \
        rdkit \
        openmm \
        pdbfixer \
        prolif \
        posebusters \
        biopython \
        smina \
    && mamba clean -afy

# Pure-Python web/server deps. Meeko ships here too — pinned >=0.6 so the
# rdkit.six import that broke prod is out of the picture, and pip pulls the
# current PyPI release (1.x as of 2025) which is the maintained line.
RUN pip install --no-cache-dir \
        "fastapi>=0.115" \
        "uvicorn[standard]>=0.32" \
        "sqlmodel>=0.0.22" \
        "pydantic>=2.9" \
        "pydantic-settings>=2.5" \
        "python-multipart>=0.0.12" \
        "httpx>=0.27" \
        "requests>=2.32" \
        "psycopg2-binary>=2.9.9" \
        "boto3>=1.35" \
        "meeko>=0.6" \
        "gemmi>=0.6"

# Vendor the FoldX binary. The user drops their licensed FoldX into
# backend/vendor/foldx/ before `fly deploy`. The directory is in .gitignore
# (license restriction) but COPY'd into the image at build time.
# If the directory is empty, FoldX features degrade gracefully (ddG=null) —
# the runner already handles this case.
COPY backend/vendor/foldx/ /opt/foldx/
RUN if [ -f /opt/foldx/foldx ]; then \
        chmod +x /opt/foldx/foldx; \
    fi
ENV FOLDX_PATH=/opt/foldx/foldx \
    PATH="/opt/foldx:${PATH}"

# Application code. We install /backend and /pipeline as editable installs so
# imports match the dev environment exactly.
WORKDIR /app
COPY backend/ /app/backend/
COPY pipeline/ /app/pipeline/
RUN pip install --no-cache-dir -e /app/backend -e /app/pipeline

# Pose cache lives here in production. The R2 backend is preferred (set
# R2_BUCKET + R2_* secrets), but if neither is configured the runner falls
# back to this directory inside the container ephemeral disk.
RUN mkdir -p /var/lib/liganx/poses
ENV POSE_CACHE_DIR=/var/lib/liganx/poses

# Receptor cache lives at ~/.deltadock on ephemeral disk. v2 prep (commit
# 525c98e+) builds receptors from raw PDBs on first request and caches
# them on the volume; subsequent jobs against the same target hit the
# fresh cache instantly. We previously baked precache files into the
# image, but they were built with the old PDBFixer-renumbering pipeline
# and were silently corrupted, so they've been removed (commit cb9024e).
# First-job latency for a new target is ~10 s of fix_pdb + obabel; every
# subsequent job is instant.
RUN mkdir -p /root/.deltadock/pdb /root/.deltadock/receptors /root/.deltadock/foldx-cache

EXPOSE 8000

# Healthcheck — Fly.io reads this for rolling deploys + restart triggers.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -f http://127.0.0.1:8000/health || exit 1

# Combined entrypoint: starts a Celery worker (when USE_CELERY_DISPATCH=true)
# alongside uvicorn so both share the pose-cache volume on the same machine.
# When the flag is off the script just starts uvicorn — same behavior as the
# old plain CMD, with no worker overhead.
COPY deploy/start.sh /usr/local/bin/start.sh
RUN chmod +x /usr/local/bin/start.sh

CMD ["/usr/local/bin/start.sh"]
