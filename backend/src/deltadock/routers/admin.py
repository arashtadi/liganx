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
from datetime import datetime, timedelta
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
    # Ensemble-docking access. UNGATED BY DEFAULT (True) — this is an admin
    # kill-switch, not a billing tier. Admin flips it False to revoke a
    # user's access to ensemble docking via PATCH /admin/users/{id}/ensemble.
    ensemble_enabled: bool = True
    # FEP+ access. GATED BY DEFAULT (False) — unlike ensemble, FEP studies
    # cost ~$100 of pod GPU each, so a fresh signup must not be able to
    # burn that. Admin flips True via PATCH /admin/users/{id}/fep.
    fep_enabled: bool = False
    # Per-user approval gate (migration 029). 'pending' is the default for
    # new sign-ups; existing users were grandfathered to 'approved'. The
    # admin page sorts pending users to the top + offers Approve/Deny
    # buttons. The Telegram inline keyboard also writes through to this.
    access_status: str = "approved"
    access_decided_at: Optional[str] = None
    access_decided_by: Optional[str] = None


class QuotaUpdate(BaseModel):
    """PATCH payload for changing a user's quota. Allow 0 (effectively
    bans new submissions but doesn't kill existing ones)."""
    job_quota: int = Field(..., ge=0, le=10_000)


class ProUpdate(BaseModel):
    """PATCH payload for flipping a user's Pro status."""
    is_pro: bool


class EnsembleUpdate(BaseModel):
    """PATCH payload for flipping a user's ensemble-docking access."""
    ensemble_enabled: bool


class FepUpdate(BaseModel):
    """PATCH payload for flipping a user's FEP+ access. Gated by
    default, so this is the explicit grant rather than a kill-switch
    like ensemble."""
    fep_enabled: bool


class AccessUpdate(BaseModel):
    """PATCH payload for the per-user approval gate (migration 029).
    `status` must be 'pending' | 'approved' | 'denied'. The CHECK
    constraint on user_profile mirrors this, so a typo here would 500
    rather than corrupt state. Same shape the Telegram inline-button
    callback uses internally — keeps the two admin entry points (web
    page + Telegram) writing through identical semantics."""
    status: str = Field(..., pattern="^(pending|approved|denied)$")


@router.get("/watchdog/status")
def get_watchdog_status(
    _admin: Annotated[CurrentUser, Depends(admin_user)],
) -> dict:
    """(U5) Liganx watchdog snapshot — latest run + last 24 runs.

    Returns:
      - latest: the most recent WatchdogRun (severity-summarised
        results, per-check details, auto-remediation actions taken)
      - history: oldest-to-newest list of recent runs (up to 24)
      - interval_seconds: how often the watchdog wakes
      - next_run_at_approx: best-effort estimate for the next tick
        (latest.started_at + interval; null if no runs yet)
    """
    from ..services.watchdog import (
        get_history, WATCHDOG_INTERVAL_SECONDS,
    )
    history = get_history()
    latest = history[0] if history else None
    next_run = None
    if latest:
        try:
            started_at = datetime.fromisoformat(latest["started_at"].rstrip("Z"))
            next_dt = started_at + timedelta(seconds=WATCHDOG_INTERVAL_SECONDS)
            next_run = next_dt.isoformat() + "Z"
        except Exception:                                                # noqa: BLE001
            next_run = None
    return {
        "latest": latest,
        "history": history,
        "interval_seconds": WATCHDOG_INTERVAL_SECONDS,
        "next_run_at_approx": next_run,
    }


@router.post("/watchdog/run")
async def trigger_watchdog_run(
    _admin: Annotated[CurrentUser, Depends(admin_user)],
) -> dict:
    """(U5) Trigger an out-of-cycle watchdog run RIGHT NOW. Returns the
    fresh result. Useful for verifying a fix without waiting for the
    next hourly tick."""
    from ..services.watchdog import run_all_checks
    from dataclasses import asdict
    run = await run_all_checks()
    return asdict(run)


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
            -- (U22) ::text cast — jobstatus enum is lowercase post-U18.
            (SELECT COUNT(*) FROM job WHERE status::text IN ('pending', 'running')) AS jobs_running,
            (SELECT COUNT(*) FROM job WHERE status::text = 'failed' AND created_at >= NOW() - INTERVAL '7 days') AS jobs_failed_7d
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
                -- Ensemble docking is ungated by default — COALESCE a NULL
                -- (column predates migration 016, or admin never touched
                -- it) to TRUE so a fresh user reads as having access.
                COALESCE(p.ensemble_enabled, TRUE) AS ensemble_enabled,
                -- FEP+ is GATED by default (migration 017). COALESCE the
                -- NULL/missing case to FALSE — opposite of ensemble — so a
                -- fresh user reads as locked out until admin grants.
                COALESCE(p.fep_enabled, FALSE) AS fep_enabled,
                -- Approval gate (migration 029). Existing users were
                -- grandfathered to 'approved' in the migration; NULL only
                -- happens for a brand-new auth.users row before any
                -- /me/profile bootstrap — treat that as 'pending'.
                COALESCE(p.access_status, 'pending') AS access_status,
                p.access_decided_at,
                p.access_decided_by,
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
                -- (U22) ::text cast — jobstatus enum is lowercase post-U18.
                (SELECT COUNT(*) FROM job j
                 WHERE j.user_id = u.id
                   AND j.status::text IN ('pending','running','completed')
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
                # Ungated by default: a NULL/missing value reads as True.
                ensemble_enabled=(
                    True if r.get("ensemble_enabled") is None
                    else bool(r.get("ensemble_enabled"))
                ),
                # GATED by default: a NULL/missing value reads as False.
                fep_enabled=bool(r.get("fep_enabled") or False),
                access_status=str(r.get("access_status") or "pending").lower(),
                access_decided_at=(
                    r["access_decided_at"].isoformat()
                    if r.get("access_decided_at") else None
                ),
                access_decided_by=r.get("access_decided_by"),
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


@router.patch("/users/{user_id}/ensemble", response_model=AdminUserRow)
def update_user_ensemble(
    payload: EnsembleUpdate,
    admin: Annotated[CurrentUser, Depends(admin_user)],
    session: Annotated[Session, Depends(get_session)],
    user_id: str = Path(..., min_length=10, max_length=100),
) -> AdminUserRow:
    """Flip a user's ensemble-docking access (true = allowed, false =
    blocked). UPSERTs the user_profile row so OAuth users who haven't
    touched /me/profile yet can still be toggled — same defensive
    pattern as update_user_quota / update_user_pro.

    Important: ensemble docking is UNGATED BY DEFAULT. This endpoint is
    an admin kill-switch, NOT a billing unlock — setting ensemble_enabled
    FALSE is the only thing that blocks a user; the column DEFAULTs TRUE
    and a missing row reads as allowed. No quota side-effects (unlike the
    Pro toggle) — ensemble docking doesn't change a user's job budget."""
    session.execute(text(
        """
        INSERT INTO public.user_profile (user_id, ensemble_enabled, marketing_opt_in)
        VALUES (:uid, :enabled, FALSE)
        ON CONFLICT (user_id) DO UPDATE SET ensemble_enabled = EXCLUDED.ensemble_enabled
        """
    ), {"uid": user_id, "enabled": payload.ensemble_enabled})
    session.commit()
    log.info(
        "Admin %s set user %s ensemble_enabled=%s",
        admin.email, user_id, payload.ensemble_enabled,
    )

    rows = list_users(admin, session)
    for r in rows:
        if r.user_id == user_id:
            return r
    raise HTTPException(status_code=404, detail="User not found after update")


@router.patch("/users/{user_id}/fep", response_model=AdminUserRow)
def update_user_fep(
    payload: FepUpdate,
    admin: Annotated[CurrentUser, Depends(admin_user)],
    session: Annotated[Session, Depends(get_session)],
    user_id: str = Path(..., min_length=10, max_length=100),
) -> AdminUserRow:
    """Flip a user's FEP+ access. UPSERTs the user_profile row.

    UNLIKE ensemble (which is ungated by default and uses an admin
    kill-switch), FEP+ is GATED BY DEFAULT — the column DEFAULTs FALSE
    and a missing row reads as blocked. So this endpoint is the
    explicit GRANT, not a kill-switch. A per-study FEP run costs
    ~$100 of pod GPU; we don't want a fresh signup to be able to
    click that without an admin having reviewed their need.

    The admin is unconditionally allowed by `fep_access_allowed`, so
    they never need to flip the flag for themselves to test."""
    session.execute(text(
        """
        INSERT INTO public.user_profile (user_id, fep_enabled, marketing_opt_in)
        VALUES (:uid, :enabled, FALSE)
        ON CONFLICT (user_id) DO UPDATE SET fep_enabled = EXCLUDED.fep_enabled
        """
    ), {"uid": user_id, "enabled": payload.fep_enabled})
    session.commit()
    log.info(
        "Admin %s set user %s fep_enabled=%s",
        admin.email, user_id, payload.fep_enabled,
    )

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
    # we don't trip any FK that doesn't have ON DELETE CASCADE. The
    # dependency chain (discovered 2026-05-31 from a ForeignKeyViolation
    # on compound_job_id_fkey when the original two-step delete fired):
    #
    #   auth.users
    #     ← user_profile        (CASCADE, but we explicit-delete for atomicity)
    #     ← user_compound       (CASCADE, same)
    #     ← job                 (NO CASCADE — manual)
    #          ← docking_result (CASCADE from job)
    #          ← compound       (NO CASCADE — manual; compound.job_id blocks)
    #               ← fep_node  (CASCADE from fep_job, but references compound!)
    #     ← fep_job             (NO CASCADE on user_id — manual)
    #          ← fep_perturbation (CASCADE from fep_job)
    #          ← fep_node       (CASCADE from fep_job)
    #
    # Correct sequence: nuke FEP first (which CASCADEs its nodes/perts and
    # frees the compound rows from fep_node's references), then compounds,
    # then jobs, then the user's directly-owned tables, then auth.users.
    # (1) FEP studies — CASCADEs to fep_node + fep_perturbation.
    session.execute(text("DELETE FROM public.fep_job WHERE user_id = :uid"), {"uid": user_id})
    # (2) Compound rows — both the user's library compounds (user_id) AND
    #     any compounds attached to their jobs (job_id, no cascade). After
    #     step (1) no FEP nodes reference these anymore, so the delete is
    #     unblocked.
    session.execute(text(
        "DELETE FROM compound "
        " WHERE user_id = :uid OR job_id IN (SELECT id FROM job WHERE user_id = :uid)"
    ), {"uid": user_id})
    # (3) Jobs — CASCADEs docking_result.
    session.execute(text("DELETE FROM job WHERE user_id = :uid"), {"uid": user_id})
    # (4) user_profile + user_compound — both CASCADE on auth.users
    #     deletion, but we delete explicitly so the operation is atomic
    #     within the same transaction (cleaner rollback story if the
    #     auth.users delete itself fails).
    session.execute(text("DELETE FROM public.user_profile WHERE user_id = :uid"), {"uid": user_id})
    session.execute(text("DELETE FROM public.user_compound WHERE user_id = :uid"), {"uid": user_id})
    # (5) the user itself.
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

@router.patch("/users/{user_id}/access", response_model=AdminUserRow)
def update_user_access(
    payload: AccessUpdate,
    admin: Annotated[CurrentUser, Depends(admin_user)],
    session: Annotated[Session, Depends(get_session)],
    user_id: str = Path(..., min_length=10, max_length=100),
) -> AdminUserRow:
    """Approve / deny / re-pend a user (migration 029).

    The same UPSERT pattern as update_user_pro: the profile row may not
    exist yet for a brand-new OAuth user, so INSERT ... ON CONFLICT DO
    UPDATE handles both first-time and existing rows. We stamp
    access_decided_at + access_decided_by so the admin row records who
    flipped the gate and when — useful when there are multiple admins
    or when the Telegram webhook does the flip.

    Mirrors what the /telegram/webhook handler writes; both paths go
    through the same column + check constraint so a typo here is caught
    at the DB layer."""
    session.execute(text(
        """
        INSERT INTO public.user_profile (user_id, access_status, access_decided_at, access_decided_by, marketing_opt_in)
        VALUES (:uid, :status, NOW(), :actor, FALSE)
        ON CONFLICT (user_id) DO UPDATE SET
            access_status = EXCLUDED.access_status,
            access_decided_at = NOW(),
            access_decided_by = EXCLUDED.access_decided_by
        """
    ), {"uid": user_id, "status": payload.status, "actor": (admin.email or "admin")[:80]})
    session.commit()
    log.info("Admin %s set user %s access_status=%s", admin.email, user_id, payload.status)

    rows = list_users(admin, session)
    for r in rows:
        if r.user_id == user_id:
            return r
    raise HTTPException(status_code=404, detail="User not found after update")

