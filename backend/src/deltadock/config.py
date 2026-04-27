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
