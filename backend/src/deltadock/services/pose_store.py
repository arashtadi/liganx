"""Pose-file storage abstraction.

Two backends, picked at runtime based on env config:

  * **R2** (production) — pose files live in a Cloudflare R2 bucket. Writes
    are PutObject; reads are either a signed URL the frontend can fetch
    directly, or a backend-proxied stream when no public URL is configured.
  * **Local disk** (dev / Fly.io fallback) — files written under
    POSE_CACHE_DIR (or `~/.deltadock/poses`). Same on-disk shape as before
    so existing rows in the DB keep resolving without migration.

`pose_uri` in the database stores either:
  * `r2://bucket/key`  — when R2 is enabled
  * an absolute filesystem path — for local-disk writes (legacy + fallback)

Anything else is rejected by `read_pose` for safety, since the only way a
non-conforming URI lands in the DB is bug or tampering.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Protocol

from ..config import get_settings

log = logging.getLogger(__name__)


def _default_local_dir() -> Path:
    s = get_settings()
    if s.pose_cache_dir:
        return Path(s.pose_cache_dir)
    return Path.home() / ".deltadock" / "poses"


class PoseStore(Protocol):
    """Interface every backend implements. Just two operations — write the
    final PDBQT for a (job, compound, variant), and read it back as bytes."""

    def write(self, job_id: int, compound_id: int, variant: str, src_path: Path) -> str:
        """Persist `src_path` and return the URI to record on the DocResult."""

    def read(self, pose_uri: str) -> bytes:
        """Fetch the bytes referenced by a stored pose_uri."""

    def exists(self, pose_uri: str) -> bool:
        """Cheap probe — does the underlying object/file still exist?"""


class LocalDiskPoseStore:
    """Filesystem implementation. Mirrors the legacy behaviour exactly so old
    rows with `/Users/arash/.deltadock/poses/job1_c1_T790M.pdbqt` keep working
    without a data migration."""

    def __init__(self, base_dir: Path | None = None) -> None:
        self.base_dir = base_dir or _default_local_dir()

    def write(self, job_id: int, compound_id: int, variant: str, src_path: Path) -> str:
        self.base_dir.mkdir(parents=True, exist_ok=True)
        target = self.base_dir / f"job{job_id}_c{compound_id}_{variant}.pdbqt"
        # Write atomically — copy to a sibling tmp file, then rename — so a
        # half-written pose never gets read by a concurrent /poses GET.
        tmp = target.with_suffix(target.suffix + ".tmp")
        tmp.write_bytes(Path(src_path).read_bytes())
        tmp.replace(target)
        return str(target)

    def read(self, pose_uri: str) -> bytes:
        path = Path(pose_uri)
        # Defence-in-depth: even though pose_uri came from our own DB, refuse
        # to read anything outside POSE_CACHE / base_dir or the legacy
        # ~/.deltadock/poses directory. A subtle bug or DB corruption that
        # snuck a path traversal in (`../etc/passwd`) gets bounced here.
        try:
            resolved = path.resolve()
            allowed_roots = [self.base_dir.resolve()]
            legacy = (Path.home() / ".deltadock" / "poses").resolve()
            if legacy not in allowed_roots:
                allowed_roots.append(legacy)
            if not any(_is_within(resolved, root) for root in allowed_roots):
                raise FileNotFoundError(f"pose path outside allowed roots: {pose_uri}")
        except (ValueError, OSError) as e:
            raise FileNotFoundError(str(e)) from e
        return path.read_bytes()

    def exists(self, pose_uri: str) -> bool:
        try:
            return Path(pose_uri).is_file() and Path(pose_uri).stat().st_size > 0
        except OSError:
            return False


def _is_within(child: Path, parent: Path) -> bool:
    try:
        child.relative_to(parent)
        return True
    except ValueError:
        return False


class R2PoseStore:
    """Cloudflare R2 implementation. R2 speaks the S3 API so we drive it via
    boto3 with a custom endpoint URL.

    URI scheme: `r2://<bucket>/<key>`. We deliberately don't include the
    account ID in the URI — the bucket name is unique within the account, and
    keeping the URI short keeps DB rows lean.
    """

    def __init__(self) -> None:
        # boto3 import is deferred so dev environments without boto3 still
        # boot — they'll just route everything through LocalDiskPoseStore.
        import boto3  # noqa: F401  (import-time check)
        s = get_settings()
        endpoint = f"https://{s.r2_account_id}.r2.cloudflarestorage.com"
        import boto3 as _boto3
        self._client = _boto3.client(
            "s3",
            endpoint_url=endpoint,
            aws_access_key_id=s.r2_access_key_id,
            aws_secret_access_key=s.r2_secret_access_key,
            region_name="auto",
        )
        self._bucket = s.r2_bucket

    def _key_for(self, job_id: int, compound_id: int, variant: str) -> str:
        # Same naming convention as the local store so we can ls a bucket and
        # immediately pattern-match to a job/compound/variant.
        return f"job{job_id}_c{compound_id}_{variant}.pdbqt"

    @staticmethod
    def _parse_uri(pose_uri: str) -> tuple[str, str]:
        if not pose_uri.startswith("r2://"):
            raise ValueError(f"not an r2:// URI: {pose_uri!r}")
        rest = pose_uri[len("r2://") :]
        bucket, _, key = rest.partition("/")
        if not bucket or not key:
            raise ValueError(f"malformed r2:// URI: {pose_uri!r}")
        return bucket, key

    def write(self, job_id: int, compound_id: int, variant: str, src_path: Path) -> str:
        key = self._key_for(job_id, compound_id, variant)
        with open(src_path, "rb") as fh:
            self._client.put_object(
                Bucket=self._bucket,
                Key=key,
                Body=fh.read(),
                ContentType="chemical/x-pdbqt",
            )
        return f"r2://{self._bucket}/{key}"

    def read(self, pose_uri: str) -> bytes:
        bucket, key = self._parse_uri(pose_uri)
        resp = self._client.get_object(Bucket=bucket, Key=key)
        return resp["Body"].read()

    def exists(self, pose_uri: str) -> bool:
        try:
            bucket, key = self._parse_uri(pose_uri)
            self._client.head_object(Bucket=bucket, Key=key)
            return True
        except Exception:
            return False


_store: PoseStore | None = None


def get_pose_store() -> PoseStore:
    """Module-level singleton — boto3 client construction isn't free, so we
    only build it once. Resets on settings change require a process restart,
    which is fine because settings are env-driven."""
    global _store
    if _store is not None:
        return _store
    s = get_settings()
    if s.r2_enabled:
        try:
            _store = R2PoseStore()
            log.info("Pose storage: Cloudflare R2 (bucket=%s)", s.r2_bucket)
            return _store
        except Exception as e:
            # Fall back to local — better to lose pose persistence across
            # restarts than to crash the whole runner because of an R2 hiccup.
            log.error("R2 pose store unavailable, falling back to local disk: %s", e)
    _store = LocalDiskPoseStore()
    log.info("Pose storage: local disk (%s)", _store.base_dir)  # type: ignore[attr-defined]
    return _store
