"""Application configuration loaded from environment variables."""

from functools import lru_cache
from typing import Annotated, Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    """All runtime config in one place. Reads from .env in development."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # App
    app_env: Literal["development", "staging", "production"] = "development"
    app_secret: str = "change-me"
    log_level: str = "info"

    # Database — empty default falls through to SQLite for dev
    database_url: str = ""

    # Redis / Celery — empty defaults mean run jobs in-process
    redis_url: str = ""
    celery_broker_url: str = ""
    celery_result_backend: str = ""

    # Object storage (Cloudflare R2). When all four are set, the runner writes
    # pose PDBQT files to R2 instead of local disk and serves them via signed
    # URLs (or a pass-through proxy). r2_public_url is optional — when set,
    # it's used to build pose links the frontend can fetch directly without
    # a backend round-trip; when empty, the backend proxies the GET.
    r2_account_id: str = ""
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""
    r2_bucket: str = "liganx-poses"
    r2_public_url: str = ""

    # Override the on-disk pose cache location. In production (Fly.io)
    # /var/lib/liganx/poses is mounted as a 1 GB volume; in dev the runner
    # uses ~/.deltadock/poses. Either way, this is the *fallback* — R2 is
    # preferred when configured.
    pose_cache_dir: str = ""

    # Override the on-disk root for cleaned WT PDBs, FoldX-mutated receptors,
    # and the FoldX scratch dir. In dev these all live under ~/.deltadock and
    # are fine ephemeral. In production (Fly.io) they MUST live on a mounted
    # volume — otherwise every redeploy wipes them, and any job that tries to
    # reuse a previously-cleaned receptor (3D viewer, re-rendering pose) fails
    # with a 404. Set LIGANX_CACHE_ROOT=/var/lib/liganx in Fly secrets.
    # Aliased so the env var is namespaced (LIGANX_*) — pydantic's default
    # would match the bare CACHE_ROOT which is too generic for a shared host.
    cache_root: str = Field(default="", validation_alias="LIGANX_CACHE_ROOT")

    # RunPod serverless docking — when both api_key and endpoint_id are set,
    # the runner dispatches Vina jobs to a RunPod worker instead of running
    # locally. Falls back to local automatically on transient failures.
    runpod_api_key: str = ""
    runpod_endpoint_id: str = ""
    runpod_template_id: str = ""        # for pod-based workflows (Phase B)
    # Per-job timeout for the RunPod /runsync call. Vina at exhaustiveness=8
    # typically finishes in 25-60s; pad for cold starts.
    runpod_timeout_s: int = 240

    # Pod-hosted GPU docking — points at a long-running FastAPI service that
    # wraps QuickVina2-GPU on a dedicated GPU Pod. Replaces the serverless
    # path when set (always-warm worker, GPU-accelerated, no cold starts).
    # Expected URL: https://<pod-id>-<port>.proxy.runpod.net
    pod_dock_url: str = ""
    pod_dock_timeout_s: int = 60

    # When the Pod has the /dock_batch endpoint deployed, we can group cells
    # of the same variant into a single HTTP call so the GPU loads the
    # receptor once per variant instead of once per cell. Big throughput win
    # on suite jobs (compounds x variants). Off by default until we've
    # stabilized the new per-cell post-processing path through batch
    # results — flip on via env (POD_BATCH_DOCK=1) when ready.
    pod_batch_dock: bool = False

    # When true, validation (PoseBusters + ProLIF + strain analysis) runs
    # AFTER docking + DB write completes — in a thread pool that updates
    # row.extra in place. The user sees scores within seconds of docking
    # finishing; the confidence ribbon, contacts list, and PoseBusters
    # verdict fill in over the next ~30s via the frontend's 2s polling.
    # Without this, every cell waits 15-20s for validation in series before
    # being persisted, which dominates wall time on small-target jobs.
    # Off by default — flip on via env (DEFER_VALIDATION=1) when ready.
    defer_validation: bool = False

    # Whether to honor `engine=gnina` on incoming jobs. Defaults False so the
    # picker stays dark in production until the Pod-side /dock_gnina endpoint
    # is installed (see pod/GNINA_INSTALL.md). Flip via Fly secret
    # `GNINA_ENABLED=1` once the Pod has the binary + endpoints. When false,
    # the runner ignores `job.engine` and always uses QuickVina2-GPU — so
    # the schema column can ship safely even before the Pod side lands.
    gnina_enabled: bool = False
    gnina_timeout_s: int = 120
    # Default GNINA CNN scoring mode for jobs that pick `engine=gnina`.
    # "rescore" is fast (~10-30 s/cell), "refine" is slower (~30-90 s) but
    # uses the CNN gradient to refine the pose itself. Most users want
    # rescore for matrix screens.
    gnina_cnn_mode: str = "rescore"

    # Boltz-2 ML pose+affinity engine — third engine option (#104). Defaults
    # off so the engine picker stays inert until the Pod-side
    # /predict_boltz2 endpoint is live (see runpod/BOLTZ2_INSTALL.md). When
    # `boltz2_enabled=True` and the job picks `engine=boltz2`, the runner
    # routes to predict_one_boltz2 in the pipeline. When the flag is off,
    # the runner returns a 503-style error if a job comes in with
    # engine=boltz2 — the API also rejects boltz2 at submit time when the
    # flag is off, so this is belt-and-suspenders. Pod URL is the same
    # base as QuickVina/GNINA (boltz endpoints live on the same pod) but
    # we expose a separate setting in case we ever split.
    boltz2_enabled: bool = False
    boltz2_timeout_s: int = 180
    # Separate pod URL for Boltz-2. Required when boltz2_enabled=True
    # because Boltz-2 needs torch ≥ 2.6 + sm_89 (RTX 4090) which
    # the QuickVina/GNINA pod's Blackwell GPU can't run. Empty string
    # means "fall back to pod_dock_url" (legacy single-pod deploys).
    # Production setting (2026-04-30):
    #   BOLTZ2_POD_URL=https://yvdrklbbg9qlwa-7862.proxy.runpod.net
    boltz2_pod_url: str = ""
    # Boltz-2 sampling controls. Defaults match the integration plan:
    # single-sequence (no MSA fetch) for fair WT/mutant comparison, one
    # sample because Boltz is deterministic at temperature=0.
    boltz2_use_msa: bool = False
    boltz2_num_samples: int = 1

    # Celery + Redis dispatch (#168, scaffold). When True, the API
    # endpoint enqueues run_job onto a Celery worker via Redis instead
    # of running it as a FastAPI BackgroundTask. Default False — the
    # in-process path is preserved until Redis is provisioned and the
    # worker container is deployed (see docs/celery_redis_migration_plan.md).
    use_celery_dispatch: bool = False
    # Broker URL for Celery. Set to a Redis URL like
    # redis://default:<password>@<host>:<port>/0 once Redis is up.
    # Empty string means "no broker configured" — the celery_app module
    # will refuse to register if this is empty AND use_celery_dispatch
    # is True (fail loud rather than silently swallow tasks).
    celery_broker_url: str = ""
    # Optional separate result backend. Default is to reuse the broker
    # URL (Celery's eager_results=True for fast feedback during
    # development; production switches to the broker URL).
    celery_result_backend: str = ""

    # Email
    resend_api_key: str = ""
    email_from: str = "hello@deltadock.bio"

    # Stripe
    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""

    # Pipeline tools
    vina_path: str = "vina"
    foldx_path: str = ""

    # Frontend — accepted as a comma-separated string (the friendly form for
    # container envs: `CORS_ORIGINS=https://liganx.com,https://www.liganx.com`).
    # `NoDecode` stops pydantic-settings from trying to JSON-decode the env
    # value before our validator runs, so we get the raw string and split it
    # ourselves. JSON-array form is still supported via the validator's
    # bracket-detection branch.
    cors_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["http://localhost:5173", "http://127.0.0.1:5173"]
    )

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_cors(cls, v: object) -> object:
        if isinstance(v, str):
            stripped = v.strip()
            # Already JSON? Hand off to a json.loads round-trip; we don't pull
            # in the json module up top because this branch is rare.
            if stripped.startswith("["):
                import json
                return json.loads(stripped)
            # Otherwise treat as comma-separated.
            return [item.strip() for item in stripped.split(",") if item.strip()]
        return v

    @property
    def effective_database_url(self) -> str:
        """Use SQLite for dev if no DATABASE_URL is provided."""
        if self.database_url:
            return self.database_url
        return "sqlite:///./dev.db"

    @property
    def is_dev(self) -> bool:
        return self.app_env == "development"

    @property
    def runpod_enabled(self) -> bool:
        """RunPod dispatch is opt-in: requires BOTH the API key and an endpoint
        ID. Either missing → fall back to local Vina."""
        return bool(self.runpod_api_key and self.runpod_endpoint_id)

    @property
    def pod_dock_enabled(self) -> bool:
        """Pod-hosted GPU docking is opt-in: set POD_DOCK_URL to enable."""
        return bool(self.pod_dock_url)

    @property
    def r2_enabled(self) -> bool:
        """R2 object storage is engaged only when ALL four secrets are set —
        partial configs silently fall back to local disk so a missing secret
        in dev never accidentally writes garbage to a prod bucket."""
        return bool(
            self.r2_account_id
            and self.r2_access_key_id
            and self.r2_secret_access_key
            and self.r2_bucket
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
