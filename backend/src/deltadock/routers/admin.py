"""Admin endpoints for liganx.com — user management, quotas, stats.

Gated behind the admin_user dependency (ADMIN_EMAIL env var). All routes
under /admin/* return 403 to non-admins; the frontend mirrors this by
hiding the entry point from non-admin users, but the server is the
authority.

Endpoints:

  GET    /admin/stats           — top-level dashboard counters
  GET    /admin/users           — list users with name/email/quota +
                                  used-quota count (jobs not in failed
                                  /cancelled state)
  PATCH  /admin/users/{id}      — update job_quota for a user
  DELETE /admin/users/{id}      — delete the user from auth.users
                                  (CASCADEs into jobs, profile, compounds)

Why we read directly from auth.users (Supabase's protected schema)
rather than going through the Supabase admin REST API:
  - We're already running as the project's postgres role via the
    pooler connection, so we have direct SELECT/DELETE access.
  - Avoids needing to ship the SUPABASE_SERVICE_ROLE_KEY (a much more
    powerful credential than the JWT we already verify with JWKS).
  - One round-trip, not two.

Stats counted-as-used quota (matches the check in routers/jobs.py
create_job): pending + running + completed. failed + cancelled don't
count — users shouldn't be penalized for Pod failures or fat-finger
cancellations.
"""

from __future__ import annotations

import logging
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Path
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlmodel import Session

from ..auth import CurrentUser, admin_user
from ..db import get_session

log = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])

# Statuses that count against a user's lifetime quota. Mirrored from
# routers/jobs.py create_job — keep the two in sync if you change one.
# UPPERCASE because Postgres native enum jobstatus stores by name, not
# by Python str value. Lowercase here causes "invalid input value for
# enum jobstatus" — see routers/jobs.py for the corresponding fix.
QUOTA_COUNTED_STATUSES = ("PENDING", "RUNNING", "COMPLETED")


class AdminStats(BaseModel):
    """Top-level dashboard counters. All cheap aggregations against
    indexed columns, so this can be polled (~5s) without DB pain."""
    total_users: int
    total_jobs: int
    jobs_24h: int
    jobs_7d: int
    jobs_running: int
    jobs_failed_7d: int


class AdminUserRow(BaseModel):
    """One user in the admin list. Mirrors auth.users + user_profile +
    a job count for the right-hand 'used / quota' column."""
    user_id: str
    email: str
    full_name: Optional[str] = None
    organization: Optional[str] = None
    role: Optional[str] = None
    created_at: str  # ISO string — frontend formats
    last_sign_in_at: Optional[str] = None
    job_quota: int
    jobs_used: int  # count of pending+running+completed jobs
    jobs_total: int  # all-time count regardless of status, for visibility
    is_admin: bool
    is_pro: bool  # GNINA + Virtual Screening unlocked. Free tier = Vina only.


class QuotaUpdate(BaseModel):
    """PATCH payload for changing a user's quota. Allow 0 (effectively
    bans new submissions but doesn't kill existing ones)."""
    job_quota: int = Field(..., ge=0, le=10_000)


class ProUpdate(BaseModel):
    """PATCH payload for flipping a user's Pro status."""
    is_pro: bool


@router.get("/stats", response_model=AdminStats)
def get_admin_stats(
    _admin: Annotated[CurrentUser, Depends(admin_user)],
    session: Annotated[Session, Depends(get_session)],
) -> AdminStats:
    """Top-line dashboard counters. Single round-trip, all cheap."""
    row = session.execute(text(
        """
        SELECT
            (SELECT COUNT(*) FROM auth.users) AS total_users,
            (SELECT COUNT(*) FROM job) AS total_jobs,
            (SELECT COUNT(*) FROM job WHERE created_at >= NOW() - INTERVAL '24 hours') AS jobs_24h,
            (SELECT COUNT(*) FROM job WHERE created_at >= NOW() - INTERVAL '7 days') AS jobs_7d,
            (SELECT COUNT(*) FROM job WHERE status IN ('PENDING', 'RUNNING')) AS jobs_running,
            (SELECT COUNT(*) FROM job WHERE status = 'FAILED' AND created_at >= NOW() - INTERVAL '7 days') AS jobs_failed_7d
        """
    )).mappings().first()
    return AdminStats(**row)


@router.get("/users", response_model=list[AdminUserRow])
def list_users(
    admin: Annotated[CurrentUser, Depends(admin_user)],
    session: Annotated[Session, Depends(get_session)],
) -> list[AdminUserRow]:
    """Return every user with profile + job stats, sorted by signup
    desc (newest first). Single LEFT JOIN; per-user job counts are a
    correlated subquery — fine at our user-count scale (handful to
    hundreds), upgrade to a window function if we cross thousands.

    Wrapped in try/except as of 2026-05-03 — was returning 503 silently
    (no traceback in logs because the default FastAPI 500 handler
    swallows the exception body). The wrapper logs the full traceback
    + admin email so we can root-cause invisible breakage in prod.
    Per-row defensiveness because one malformed row (e.g. orphaned
    auth.users entry from a partial delete, weird timestamp format)
    shouldn't blackhole the whole admin panel."""
    try:
        rows = session.execute(text(
            f"""
            SELECT
                u.id::text AS user_id,
                u.email,
                u.created_at,
                u.last_sign_in_at,
                p.full_name,
                p.organization,
                p.role,
                COALESCE(p.job_quota, 10) AS job_quota,
                COALESCE(p.is_pro, FALSE) AS is_pro,
                -- job.user_id is UUID; u.id is also UUID. Don't cast either
                -- side or Postgres complains "operator does not exist:
                -- uuid = text". The earlier quota check works with a bound
                -- user-id parameter because parameter binding auto-coerces.
                -- (Don't put a literal colon-identifier token like
                --  COLON+name in this comment; SQLAlchemy text() parses
                --  that pattern as a bind parameter even inside SQL
                --  comments and the query then needs a value supplied
                --  — which crashed the admin panel with "A value is
                --  required for bind parameter".)
                (SELECT COUNT(*) FROM job j
                 WHERE j.user_id = u.id
                   AND j.status IN ('PENDING','RUNNING','COMPLETED')
                ) AS jobs_used,
                (SELECT COUNT(*) FROM job j WHERE j.user_id = u.id) AS jobs_total
            FROM auth.users u
            LEFT JOIN public.user_profile p ON p.user_id = u.id
            ORDER BY u.created_at DESC
            """
        )).mappings().all()
    except Exception as e:
        log.exception("admin/users SQL failed for admin=%r", admin.email)
        raise HTTPException(
            status_code=500,
            detail=f"admin/users query failed: {type(e).__name__}: {e}",
        )

    out: list[AdminUserRow] = []
    admin_email_lc = admin.email.strip().lower()
    skipped_rows: list[str] = []
    for r in rows:
        try:
            out.append(AdminUserRow(
                user_id=r["user_id"],
                email=r["email"] or "",
                full_name=r["full_name"],
                organization=r["organization"],
                role=r["role"],
                # Postgres returns datetimes; psycopg2 deserializes to Python
                # datetime — isoformat for JSON.
                created_at=r["created_at"].isoformat() if r["created_at"] else "",
                last_sign_in_at=r["last_sign_in_at"].isoformat() if r["last_sign_in_at"] else None,
                job_quota=int(r["job_quota"]),
                jobs_used=int(r["jobs_used"]),
                jobs_total=int(r["jobs_total"]),
                is_admin=(r["email"] or "").strip().lower() == admin_email_lc,
                is_pro=bool(r.get("is_pro") or False),
            ))
        except Exception as e:
            uid = (r.get("user_id") or "?") if hasattr(r, "get") else "?"
            email = (r.get("email") or "?") if hasattr(r, "get") else "?"
            log.exception(
                "admin/users: skipping row uid=%r email=%r: %s",
                uid, email, e,
            )
            skipped_rows.append(f"{email} ({uid}): {type(e).__name__}: {e}")

    if skipped_rows:
        log.warning(
            "admin/users: skipped %d/%d rows: %s",
            len(skipped_rows), len(rows), skipped_rows,
        )
    return out


@router.patch("/users/{user_id}", response_model=AdminUserRow)
def update_user_quota(
    payload: QuotaUpdate,
    admin: Annotated[CurrentUser, Depends(admin_user)],
    session: Annotated[Session, Depends(get_session)],
    user_id: str = Path(..., min_length=10, max_length=100),
) -> AdminUserRow:
    """Set a user's job_quota. Idempotent — repeated calls with the same
    value are no-ops at the DB level. We UPSERT because OAuth users
    sometimes don't have a user_profile row until they touch /me/profile,
    so we need to be able to grant a quota to a fresh OAuth user before
    they've completed their profile."""
    session.execute(text(
        """
        INSERT INTO public.user_profile (user_id, job_quota, marketing_opt_in)
        VALUES (:uid, :quota, FALSE)
        ON CONFLICT (user_id) DO UPDATE SET job_quota = EXCLUDED.job_quota
        """
    ), {"uid": user_id, "quota": payload.job_quota})
    session.commit()
    log.info("Admin %s updated user %s quota to %d", admin.email, user_id, payload.job_quota)

    # Return the refreshed row so the frontend can update its local
    # state without a separate GET.
    rows = list_users(admin, session)
    for r in rows:
        if r.user_id == user_id:
            return r
    raise HTTPException(status_code=404, detail="User not found after update")


@router.patch("/users/{user_id}/pro", response_model=AdminUserRow)
def update_user_pro(
    payload: ProUpdate,
    admin: Annotated[CurrentUser, Depends(admin_user)],
    session: Annotated[Session, Depends(get_session)],
    user_id: str = Path(..., min_length=10, max_length=100),
) -> AdminUserRow:
    """Flip a user's is_pro flag (true=Pro, false=Free). UPSERTs the
    user_profile row so OAuth users who haven't touched /me/profile yet
    can still be granted Pro access — same defensive pattern as
    update_user_quota.

    Quota side-effect on grant: a Pro user with the default free-tier
    quota (≤10 jobs) gets bumped to PRO_DEFAULT_QUOTA. Without this,
    granting Pro unlocks the engines (GNINA + VS) but the user is
    still capped at 10 lifetime jobs — the most-common surprise per
    May 13 admin feedback. Admin can still tune the quota further
    via the existing PATCH /admin/users/{id} endpoint.

    Quota side-effect on revoke: we LEAVE the quota where it is.
    A user who consumed 200 jobs while Pro shouldn't suddenly find
    themselves at 200/10 = 2000% blocked on every new submission.
    If the admin wants to restrict them, they can lower the quota
    explicitly."""
    PRO_DEFAULT_QUOTA = 500
    FREE_DEFAULT_QUOTA = 10  # matches migration 007 DEFAULT

    if payload.is_pro:
        # On grant, bump quota only if the user is at (or below) the
        # free-tier default. Don't clobber a manually-raised cap.
        session.execute(text(
            """
            INSERT INTO public.user_profile (user_id, is_pro, job_quota, marketing_opt_in)
            VALUES (:uid, TRUE, :pro_quota, FALSE)
            ON CONFLICT (user_id) DO UPDATE SET
                is_pro = TRUE,
                job_quota = CASE
                    WHEN public.user_profile.job_quota <= :free_quota THEN :pro_quota
                    ELSE public.user_profile.job_quota
                END
            """
        ), {
            "uid": user_id,
            "pro_quota": PRO_DEFAULT_QUOTA,
            "free_quota": FREE_DEFAULT_QUOTA,
        })
    else:
        # On revoke, only flip the flag — don't touch quota. The user
        # keeps whatever cap they were at; admin can lower manually.
        session.execute(text(
            """
            INSERT INTO public.user_profile (user_id, is_pro, marketing_opt_in)
            VALUES (:uid, FALSE, FALSE)
            ON CONFLICT (user_id) DO UPDATE SET is_pro = FALSE
            """
        ), {"uid": user_id})
    session.commit()
    log.info("Admin %s set user %s is_pro=%s", admin.email, user_id, payload.is_pro)

    rows = list_users(admin, session)
    for r in rows:
        if r.user_id == user_id:
            return r
    raise HTTPException(status_code=404, detail="User not found after update")


@router.delete("/users/{user_id}", status_code=204)
def delete_user(
    admin: Annotated[CurrentUser, Depends(admin_user)],
    session: Annotated[Session, Depends(get_session)],
    user_id: str = Path(..., min_length=10, max_length=100),
) -> None:
    """Hard-delete a user and everything they own. CASCADE handles the
    user_profile and user_compound rows; jobs are cleaned up explicitly
    because Job.user_id is a string FK that doesn't have an ON DELETE
    CASCADE constraint (it's just a UUID string for portability).

    Refuses to delete the admin themselves — that would brick the panel
    and lose audit context. To re-permission another user, change
    ADMIN_EMAIL via Fly secrets."""
    if user_id == admin.id:
        raise HTTPException(
            status_code=400,
            detail="Refusing to delete the admin account.",
        )

    # Order matters: delete dependent rows before the auth.users row so
    # we don't trip any FK that doesn't have ON DELETE CASCADE.
    # (1) jobs — manual cleanup; results table CASCADEs from job.id.
    session.execute(text("DELETE FROM job WHERE user_id = :uid"), {"uid": user_id})
    # (2) user_profile + user_compound — both CASCADE on auth.users
    #     deletion, but we delete explicitly so the operation is atomic
    #     within the same transaction (cleaner rollback story if the
    #     auth.users delete itself fails).
    session.execute(text("DELETE FROM public.user_profile WHERE user_id = :uid"), {"uid": user_id})
    session.execute(text("DELETE FROM public.user_compound WHERE user_id = :uid"), {"uid": user_id})
    # (3) the user itself.
    result = session.execute(text("DELETE FROM auth.users WHERE id = :uid"), {"uid": user_id})
    if result.rowcount == 0:
        # Roll back all the deletes — we don't want to nuke jobs/profile
        # for a user that doesn't actually exist (would be a no-op anyway,
        # but rollback keeps the operation atomic).
        session.rollback()
        raise HTTPException(status_code=404, detail="User not found")
    session.commit()
    log.info("Admin %s deleted user %s", admin.email, user_id)
    return None


# ── /admin/optimize_attempts ───────────────────────────────────────────
# Durable view of every /assist/optimize call (success and failure).
# Added 2026-05-04 alongside migration 010 — see optimize_attempt.sql
# for column rationale. Powers "why did Optimize fail earlier today?"
# investigations that previously required Fly's 15-min log buffer to
# still hold the relevant lines.

class OptimizeAttemptRow(BaseModel):
    """One optimize_attempt row, JSON-shaped for the admin UI / curl."""
    id: int
    created_at: str
    user_email: Optional[str]
    target_pdb: Optional[str]
    mutations: Optional[str]
    parent_smiles: str
    parent_score: Optional[float]
    status: str
    elapsed_ms: int
    n_raw_variants: Optional[int]
    n_unique_variants: Optional[int]
    n_survivors_sa: Optional[int]
    n_docked: Optional[int]
    n_returned: Optional[int]
    error_message: Optional[str]
    request_id: Optional[str]


@router.get("/optimize_attempts", response_model=list[OptimizeAttemptRow])
def list_optimize_attempts(
    _admin: Annotated[CurrentUser, Depends(admin_user)],
    session: Annotated[Session, Depends(get_session)],
    limit: int = 100,
    only_failures: bool = False,
    user_email: Optional[str] = None,
) -> list[OptimizeAttemptRow]:
    """List recent /assist/optimize attempts, newest-first.

    Query params:
      limit         — max rows (default 100, capped 1000)
      only_failures — filter to status != 'ok' (uses the partial index)
      user_email    — filter to a specific user's attempts

    Typical use: support reports like "Optimize failed for me 2x then
    worked" → curl /admin/optimize_attempts?user_email=arashtadi@gmail.com
    and read off the 3 rows."""
    capped = max(1, min(limit, 1000))

    sql = "SELECT id, created_at, user_email, target_pdb, mutations, " \
          "parent_smiles, parent_score, status, elapsed_ms, " \
          "n_raw_variants, n_unique_variants, n_survivors_sa, " \
          "n_docked, n_returned, error_message, request_id " \
          "FROM public.optimize_attempt WHERE 1=1"
    params: dict = {}
    if only_failures:
        sql += " AND status != 'ok'"
    if user_email:
        sql += " AND user_email = :email"
        params["email"] = user_email
    sql += " ORDER BY created_at DESC LIMIT :limit"
    params["limit"] = capped

    rows = session.execute(text(sql), params).mappings().all()
    return [
        OptimizeAttemptRow(
            id=r["id"],
            created_at=r["created_at"].isoformat() if r["created_at"] else "",
            user_email=r["user_email"],
            target_pdb=r["target_pdb"],
            mutations=r["mutations"],
            parent_smiles=r["parent_smiles"],
            parent_score=r["parent_score"],
            status=r["status"],
            elapsed_ms=r["elapsed_ms"],
            n_raw_variants=r["n_raw_variants"],
            n_unique_variants=r["n_unique_variants"],
            n_survivors_sa=r["n_survivors_sa"],
            n_docked=r["n_docked"],
            n_returned=r["n_returned"],
            error_message=r["error_message"],
            request_id=str(r["request_id"]) if r["request_id"] else None,
        )
        for r in rows
    ]


# ── /admin/pod ─── RunPod cost control ────────────────────────────────
# Manual start/stop + status for the GPU pod, plus visibility into the
# auto-stop watchdog's idle counter. The watchdog itself runs as an
# asyncio task spawned in main.py's lifespan hook; these endpoints just
# expose it to the admin UI.

class PodStatusOut(BaseModel):
    configured: bool
    pod_id: Optional[str] = None
    name: Optional[str] = None
    desired_status: Optional[str] = None  # RUNNING / EXITED / etc.
    uptime_seconds: Optional[int] = None
    last_activity_seconds_ago: Optional[float] = None
    idle_threshold_seconds: int
    error: Optional[str] = None


@router.get("/pod/status", response_model=PodStatusOut, tags=["admin"])
async def admin_pod_status(_admin: Annotated[CurrentUser, Depends(admin_user)]) -> PodStatusOut:
    """Live status of the controlled RunPod GPU pod plus the watchdog's
    last-activity timestamp. Drives the Pod Control card in the admin UI."""
    from ..config import get_settings
    from ..services import runpod_client
    from ..services.pod_activity import seconds_since_last_activity

    _settings = get_settings()
    threshold = _settings.runpod_idle_minutes * 60
    if not runpod_client.is_configured():
        return PodStatusOut(
            configured=False,
            idle_threshold_seconds=threshold,
            last_activity_seconds_ago=seconds_since_last_activity(),
        )
    try:
        s = await runpod_client.get_pod_status()
        return PodStatusOut(
            configured=True,
            pod_id=s.get("id"),
            name=s.get("name"),
            desired_status=s.get("desiredStatus"),
            uptime_seconds=s.get("uptimeSeconds"),
            last_activity_seconds_ago=seconds_since_last_activity(),
            idle_threshold_seconds=threshold,
        )
    except Exception as e:  # noqa: BLE001
        log.warning("admin_pod_status: %s", e)
        return PodStatusOut(
            configured=True,
            idle_threshold_seconds=threshold,
            last_activity_seconds_ago=seconds_since_last_activity(),
            error=str(e),
        )


@router.post("/pod/stop", tags=["admin"])
async def admin_pod_stop(_admin: Annotated[CurrentUser, Depends(admin_user)]) -> dict:
    """Stop the GPU pod immediately. /workspace volume persists; cold-
    start cost on resume is ~3-5 min. Idempotent at the RunPod API."""
    from ..services import runpod_client

    if not runpod_client.is_configured():
        raise HTTPException(503, "RunPod not configured (RUNPOD_API_KEY/POD_ID unset)")
    try:
        result = await runpod_client.stop_pod()
        return {"ok": True, "result": result}
    except Exception as e:  # noqa: BLE001
        log.exception("admin_pod_stop failed")
        raise HTTPException(502, f"RunPod stop failed: {e}")


@router.post("/pod/start", tags=["admin"])
async def admin_pod_start(_admin: Annotated[CurrentUser, Depends(admin_user)]) -> dict:
    """Resume the GPU pod. Returns immediately with desiredStatus=RUNNING;
    actual readiness for docking takes ~3-5 min more (container provision
    + start_dock_server.sh). Hit /pod/status to poll."""
    from ..services import runpod_client

    if not runpod_client.is_configured():
        raise HTTPException(503, "RunPod not configured (RUNPOD_API_KEY/POD_ID unset)")
    try:
        result = await runpod_client.start_pod()
        return {"ok": True, "result": result}
    except Exception as e:  # noqa: BLE001
        log.exception("admin_pod_start failed")
        raise HTTPException(502, f"RunPod start failed: {e}")
