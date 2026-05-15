"""Application configuration loaded from environment variables."""

from functools import lru_cache
from typing import Annotated, Literal

from pydantic import Field, field_validator, model_validator
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

    # Shared secret for authenticating backend → GPU-pod calls. The pod's
    # proxy URL is NOT a secret (it has leaked into git history), and
    # RunPod's proxy does no auth — so the pod's FastAPI servers check an
    # X-Pod-Secret header against their POD_SHARED_SECRET env var. Set the
    # SAME value here (Fly secret) and on the pod. Empty = disabled: the
    # backend sends no header and the pod fails open, so the two sides can
    # be rolled out independently without a flag day. See pod_auth_headers().
    pod_shared_secret: str = ""

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
    # uses the CNN gradient to refine the pose itself.
    # 2026-05-05: changed default from "rescore" → "none" because the
    # production pod migrated to NVIDIA RTX PRO 4500 Blackwell (sm_120),
    # and GNINA v1.3's prebuilt TVM CNN kernels SIGABRT on that arch
    # (verified via direct subprocess run — every bundled CNN model
    # crashes with rc=134 / Aborted, while cnn_scoring=none works
    # fine). cnn_mode=none uses gnina's hand-written CUDA Vina kernels
    # — produces a Vina-fork affinity score (slightly different scoring
    # function from QuickVina2-GPU, no CNN re-rank).
    # 2026-05-11: production pod cut over from Blackwell (sm_120) to
    # RTX 4090 (sm_89), and GNINA v1.3's bundled TVM kernels work on
    # sm_89 (confirmed via /workspace/gnina --version on the new pod).
    # Restoring "rescore" so the violet GNINA button (Studio v1.05) does
    # what it advertises — CNN re-rank, not a Vina-fork passthrough.
    # If we ever swap GPU back to sm_120+ this needs flipping back to
    # "none" until the GNINA build catches up (or rebuild from source
    # with CMAKE_CUDA_ARCHITECTURES=120).
    # Override per-deploy via the GNINA_CNN_MODE env var / Fly secret.
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
    # Quick-dock + AI-optimize loop in the Ketcher sidebar (#358).
    # When enabled, the AI assistant can run a fast (exhaustiveness=4)
    # Vina docking against the user's selected target+mutation right
    # inside the editor, then propose 3 variant SMILES designed to
    # gain contacts at residues the original compound missed. Each
    # variant is also docked. This is the "moat" feature — costs real
    # GPU time per click, so we gate it behind a feature flag and
    # rate-limit aggressively (per-IP cap on _QUICK_DOCK_LIMIT).
    # Mirrors the boltz2_enabled gating pattern: default off, frontend
    # shows "By request" on the button, paying customers get the flag
    # flipped server-side.
    quick_dock_enabled: bool = False
    boltz2_enabled: bool = False
    # When enabled, the Optimize loop uses Anthropic native tool use so the
    # AI can self-validate SMILES candidates mid-generation (RDKit parse
    # check + property compute) before committing them. Adds ~5-10s per
    # call worst case (1-3 tool round-trips) but catches the model's own
    # parse mistakes BEFORE they hit the docker. Default off — flip per
    # tester until the loop is proven stable, then default on.
    # Tier 1 #4 (2026-05-04). See services/ai_assistant_tools.py.
    optimize_use_tools: bool = False
    # 600s — generous cold-start window. The first prediction after a pod
    # restart downloads ~5 GB of model weights from HuggingFace into
    # /workspace/boltz2_cache; that pull alone can take 5–10 minutes.
    # Subsequent predictions on the same warm pod run in ~20 s, so this
    # ceiling almost never bites once the cache is populated. If we
    # hit timeout on cell N>1, that's a real model-side problem worth
    # debugging — not a tuning question.
    boltz2_timeout_s: int = 600
    # Separate pod URL for Boltz-2. Required when boltz2_enabled=True
    # because Boltz-2 needs torch ≥ 2.6 + sm_89 (RTX 4090) which
    # the QuickVina/GNINA pod's Blackwell GPU can't run. Empty string
    # means "fall back to pod_dock_url" (legacy single-pod deploys).
    # Production setting (2026-04-30):
    #   BOLTZ2_POD_URL=https://yvdrklbbg9qlwa-7862.proxy.runpod.net
    boltz2_pod_url: str = ""

    # RunPod cost control (v0.91+). When RUNPOD_API_KEY (already
    # declared above for serverless) and RUNPOD_POD_ID are both set,
    # the backend auto-stops the pod after `runpod_idle_minutes` of
    # zero docking traffic and auto-resumes on incoming Full Job
    # submissions. Admin endpoints under /admin/pod/* expose manual
    # start/stop + status. Currently controlling pod diqoc6q2lt55mn.
    runpod_pod_id: str = ""
    # 2026-05-12 update: watchdog disabled by default. The cost-savings
    # ($0.13/day idle vs ~$15/day running, on the 4090) aren't worth the
    # "site looks broken to new visitors" cost — a stopped pod returns
    # 404 to every dock call, which is THE worst-possible first
    # impression for a free visitor. To re-enable, set Fly secret
    # RUNPOD_WATCHDOG_ENABLED=true. When disabled, /admin/pod/stop still
    # works for manual cost control.
    runpod_watchdog_enabled: bool = False
    # If watchdog re-enabled: idle window before auto-stopping. Bumped
    # from 30 to 240 min so a visitor who closes the tab + comes back
    # later doesn't always land on a paused pod.
    runpod_idle_minutes: int = 240
    # ── Pod auto-failover (S3) — the inverse of the cost watchdog ──
    # The cost watchdog (above) STOPS the pod when idle. The failover
    # watchdog STARTS the pod when there's recent docking traffic but
    # /health is unreachable. Together they keep the pod up exactly when
    # users need it. Default ON because the safety rails (sustained-
    # unreachability threshold + recent-activity gate + cooldown) make
    # spurious resumes nearly impossible. Disable with
    # RUNPOD_FAILOVER_ENABLED=false if you want to handle pod outages
    # manually.
    runpod_failover_enabled: bool = True
    # Sustained /health failure (seconds) required before triggering
    # recovery. Below this is treated as a transient blip.
    runpod_failover_unreachable_seconds: float = 300.0
    # If the API hasn't seen docking traffic in this many seconds, an
    # unreachable pod is assumed to be intentionally stopped (cost
    # watchdog) — no failover.
    runpod_failover_recent_activity_seconds: float = 1800.0
    # Cooldown between recovery attempts (or alert-only events) so the
    # watchdog never spams the RunPod API or Telegram.
    runpod_failover_cooldown_seconds: float = 900.0

    # Hard ceiling on pod uptime regardless of activity. The activity-based
    # watchdog above can theoretically loop forever if new jobs keep
    # arriving, which on RunPod is real money: an RTX 4090 is ~$0.40/hour
    # but an A100 or higher leaves real damage if a runaway pod sits
    # idle-but-handed-one-request-every-29-minutes. This is a defence-
    # in-depth ceiling — once a pod has been up for `max_uptime_minutes`
    # the watchdog stops it regardless. The next /jobs submission will
    # auto-resume via pod_lifecycle.ensure_pod_warm, so user impact is a
    # one-time cold-start cost. Bumped from 240 (4h) to 1440 (24h) so
    # a typical work day stays warm.
    runpod_max_uptime_minutes: int = 1440
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

    @model_validator(mode="after")
    def _no_default_secret_in_prod(self) -> "Settings":
        """Surface the "running with default secret in prod" condition
        without crashing the process.

        History: an earlier version of this validator raised RuntimeError
        on `app_env=production AND app_secret="change-me"`. That sounds
        like the safe move but in practice it bricked production on
        2026-05-12 — APP_SECRET wasn't set in Fly secrets, every machine
        restart hit this validator and exited code 2, and /health never
        had a chance to respond. Running with a known default secret is
        degraded; refusing to boot is OUTAGE. Degraded > outage.

        We log a loud warning instead, so the condition is visible in
        Fly logs and Sentry. To gate strictly, set
        REQUIRE_STRONG_APP_SECRET=1 in your env — that flips the check
        back to raising, for environments where the operator has already
        ensured the secret is set.
        """
        import os
        if self.app_env == "production" and self.app_secret == "change-me":
            msg = (
                "WARNING: app_secret is the default 'change-me' but "
                "APP_ENV=production. Set APP_SECRET via Fly secrets to "
                "fix. JWT signing is currently using a public-by-design "
                "default — degraded but functional."
            )
            if os.environ.get("REQUIRE_STRONG_APP_SECRET", "").lower() in ("1", "true", "yes"):
                raise RuntimeError(msg + " (REQUIRE_STRONG_APP_SECRET is set)")
            import logging
            logging.getLogger("deltadock").warning(msg)
        return self

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


def pod_auth_headers() -> dict[str, str]:
    """X-Pod-Secret header for backend → GPU-pod HTTP calls.

    Returns an empty dict when pod_shared_secret is unset, so callers can
    unconditionally spread it into their request headers and the behavior
    is a no-op until the secret is configured on both ends.

    Note: the pipeline modules (pod_dock / gnina_dock / boltz2_dock /
    admet_ml) read POD_SHARED_SECRET from os.environ directly instead of
    importing this — they're deliberately kept importable without the
    backend's config module — but it resolves to the same env var.
    """
    secret = get_settings().pod_shared_secret.strip()
    return {"X-Pod-Secret": secret} if secret else {}
