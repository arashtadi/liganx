"""Current-user profile endpoints.

Reads from / writes to public.user_profile (the typed mirror of
auth.users.raw_user_meta_data — see migration 003 for the trigger
that keeps the two in sync). Why we have a typed table instead of
just reading user_metadata via the Supabase JS client:

  • SQL aggregations against typed columns are cheap; against JSON
    they're slow and ugly.
  • The Settings page wants to write back without going through
    Supabase admin auth — we can update public.user_profile directly
    using the FastAPI's existing postgres role.
  • Future analytics (Insights dashboard, churn cohorts, role-based
    experiments) all assume typed columns.

The trigger handles the metadata→typed direction. This router handles
the typed→typed read/write. We deliberately do NOT push updates back
into raw_user_meta_data from the backend — that would require the
Supabase service-role key, and the small downside (frontend
session.user.user_metadata can be stale until next session refresh)
is worth the simpler auth surface.
"""

from __future__ import annotations

from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import text
from sqlmodel import Session

from ..auth import CurrentUser, current_user
from ..db import get_session

router = APIRouter(prefix="/me", tags=["me"])


# Canonical role values accepted by the API. Keep in sync with
# frontend SIGNUP_ROLES in lib/auth.tsx — we validate server-side
# so direct API callers can't insert garbage.
ALLOWED_ROLES = {
    "grad_student", "postdoc", "pi", "industry_sci",
    "comp_chem", "med_chem", "structural_bio",
    "undergrad", "other",
}


class ProfileOut(BaseModel):
    """Full profile shape returned to the frontend. All fields except
    user_id and marketing_opt_in are nullable because users can sign
    up via OAuth without filling anything in."""
    user_id: str
    full_name: Optional[str] = None
    organization: Optional[str] = None
    role: Optional[str] = None
    # Free-form description of the user's role when role == 'other'.
    # Captured from the welcome / settings forms when the user picks
    # Other from the dropdown and types what their actual role is.
    # NULL when role is one of the canonical enum values.
    role_other: Optional[str] = None
    researchgate_url: Optional[str] = None
    marketing_opt_in: bool = False
    signup_source: Optional[str] = None
    # Pro tier flag — toggled from /admin. When False (the default for
    # all new signups) the frontend gates GNINA + Virtual Screening
    # behind a "Pro feature" contact-us modal; the backend also rejects
    # those submissions with 402.
    is_pro: bool = False
    # Ensemble-docking access flag — UNGATED BY DEFAULT (True). This is
    # NOT a billing tier like is_pro; it's an admin kill-switch. When an
    # admin sets it False for a user, the Studio's ensemble toggle is
    # disabled with a "contact us" hint and the backend rejects
    # ensemble=true submissions from that user with 402. Defaults True
    # here so a missing profile row (fresh OAuth user) keeps full access.
    ensemble_enabled: bool = True
    # (U17j) Recent docking jobs piggybacked on /me/profile to dodge
    # aggressive ad-blockers that block every other path the History
    # page tries. /me/profile is heavily used by the app for legitimate
    # auth/profile reads and consistently reaches the server across
    # blocklists. Populated only when ?include=dockings is passed so
    # the existing callers (Studio, login flow, Settings) don't pay the
    # extra payload cost. List shape is intentionally Any-typed at the
    # Pydantic level so we don't have to introduce a circular import
    # from routers/jobs; the frontend uses the same Job interface it
    # uses for the regular list endpoint.
    recent_dockings: Optional[list[dict]] = None


class ProfileUpdate(BaseModel):
    """PATCH-style payload — all fields optional, only the present
    ones are updated. Empty strings are treated as 'clear this field'
    so the user can blank out their org or ResearchGate URL after the
    fact. marketing_opt_in is preserved as-is when omitted."""
    full_name: Optional[str] = Field(default=None, max_length=200)
    organization: Optional[str] = Field(default=None, max_length=200)
    role: Optional[str] = Field(default=None, max_length=40)
    # Set when role == 'other' so we capture the actual role text.
    # Cleared (empty string) when the user changes role away from
    # 'other'. The frontend handles that transition; backend just
    # stores whatever it's told.
    role_other: Optional[str] = Field(default=None, max_length=200)
    researchgate_url: Optional[str] = Field(default=None, max_length=500)
    marketing_opt_in: Optional[bool] = None

    @field_validator("role")
    @classmethod
    def _v_role(cls, v: Optional[str]) -> Optional[str]:
        # Empty string clears the field; otherwise must be one of the
        # canonical values. Done server-side so curl/script callers
        # can't store bogus role strings that would confuse analytics.
        if v is None or v == "":
            return v
        if v not in ALLOWED_ROLES:
            raise ValueError(f"role must be one of {sorted(ALLOWED_ROLES)}")
        return v

    @field_validator("researchgate_url")
    @classmethod
    def _v_rg(cls, v: Optional[str]) -> Optional[str]:
        if v is None or v == "":
            return v
        if not v.startswith(("http://", "https://")):
            raise ValueError("researchgate_url must start with http:// or https://")
        return v


@router.get("/profile", response_model=ProfileOut)
def get_my_profile(
    user: Annotated[CurrentUser, Depends(current_user)],
    session: Annotated[Session, Depends(get_session)],
    request: Request = None,  # type: ignore[assignment]
) -> ProfileOut:
    """Read current user's profile. Returns an all-null profile (with
    just the user_id and default marketing_opt_in=False) when the row
    doesn't exist yet — happens for OAuth users on whom the trigger
    fired with empty metadata.

    (U17j) When ?include=dockings is passed, the response also carries
    the user's recent docking jobs in `recent_dockings`. This is the
    only path the History page can rely on — uBlock / EasyPrivacy
    learn-and-block every other endpoint within seconds. /me/profile is
    too heavily used by app boot, Studio gating, and Settings for any
    blocklist to block, so embedding job data here is the durable
    workaround. Existing callers that don't pass `include` get the
    same slim profile they always did.
    """
    row = session.execute(
        text(
            "SELECT full_name, organization, role, role_other,"
            " researchgate_url, marketing_opt_in, signup_source,"
            " COALESCE(is_pro, FALSE) AS is_pro,"
            # Ensemble docking is ungated by default — COALESCE a NULL
            # (column predates the migration, or admin never touched it)
            # to TRUE so access is the default state.
            " COALESCE(ensemble_enabled, TRUE) AS ensemble_enabled"
            " FROM public.user_profile WHERE user_id = :uid"
        ),
        {"uid": user.id},
    ).mappings().first()

    # ADMIN_EMAIL is implicit Pro everywhere — backend gates check it
    # via auth.is_pro_user, frontend gates check via this field. Without
    # this override the admin user's profile row would say is_pro=false
    # and the Studio would show lock icons on GNINA + VS even though the
    # backend would happily accept the submission.
    from ..auth import ADMIN_EMAIL
    admin_is_pro_override = (
        ADMIN_EMAIL
        and getattr(user, "email", None)
        and user.email.strip().lower() == ADMIN_EMAIL
    )

    if row is None:
        profile = ProfileOut(user_id=user.id, is_pro=bool(admin_is_pro_override))
    else:
        payload = dict(row)
        if admin_is_pro_override:
            payload["is_pro"] = True
        profile = ProfileOut(user_id=user.id, **payload)

    # (U17Q) Final answer: always return the first 25 dockings in the
    # bare /me/profile response. After 18 query-string variants got
    # dynamically learned + blocked by the user's ad-blocker (it
    # pattern-matches the VALUE, not just paths), the only durable
    # answer is to remove the query string entirely. Bare /me/profile
    # is rock-solid because it's the auth-bootstrap endpoint and
    # blocking it would shatter every login.
    #
    # Cost: every /me/profile call (auth boot, Settings, Studio
    # gating) now carries ~5-10 KB of compounds + jobs metadata.
    # Acceptable — the existing callers ignore the extra field.
    #
    # Pagination via the same query mechanism (for "Load more")
    # remains plumbed through with the regex `o(\d+)l(\d+)` parser
    # below — works in normal browsers, gracefully empty for the
    # affected user (page 2+ won't paginate, but page 1 always works).
    #
    # Local import avoids the circular dep between me.py and
    # routers/jobs.py (jobs.py imports nothing from me.py, but the
    # module-level import would force jobs.py to load whenever profile
    # is accessed by the auth dance during app startup).
    import re as _re
    from .jobs import list_jobs  # local: see comment above

    offset, limit = 0, 25
    if request is not None:
        _pat = _re.compile(r"^o(\d+)l(\d+)$")
        for _val in request.query_params.values():
            if _val:
                m = _pat.match(_val)
                if m:
                    offset = int(m.group(1))
                    limit = max(1, min(200, int(m.group(2))))
                    break

    # (U17S) Use raw SQL instead of going through list_jobs() because
    # the Job SQLAlchemy model declares status as Enum(JobStatus) which
    # maps by NAME. Migration 024 + the U11 raw-SQL cancel write rows
    # with value 'cancelled' (lowercase), and SQLAlchemy then throws
    # `LookupError: 'cancelled' is not among the defined enum values`
    # when loading those rows back — every list_jobs() call blows up
    # the moment a user has a cancelled job in their history. The
    # right long-term fix is to give the Job model a `values_callable`
    # sa_column, but that touches every reader in the codebase. Raw
    # SQL here keeps the blast radius to this endpoint.
    try:
        rows = session.execute(
            text(
                "SELECT id, share_id, pdb_id, chain, uniprot_id, mutations,"
                "       status::text AS status, error_message,"
                "       created_at, updated_at, exhaustiveness, include_wt,"
                "       COALESCE(ensemble, FALSE) AS ensemble,"
                "       engine, user_id, title, COALESCE(tags, '{}') AS tags"
                "  FROM job"
                " WHERE user_id = :uid"
                " ORDER BY created_at DESC"
                " LIMIT :lim OFFSET :off"
            ),
            {"uid": user.id, "lim": limit, "off": offset},
        ).mappings().all()

        compound_rows = []
        if rows:
            job_ids = [r["id"] for r in rows]
            compound_rows = session.execute(
                text(
                    "SELECT id, job_id, name, smiles FROM compound"
                    " WHERE job_id = ANY(:ids)"
                ),
                {"ids": job_ids},
            ).mappings().all()
        compounds_by_job: dict[int, list[dict]] = {}
        for c in compound_rows:
            compounds_by_job.setdefault(c["job_id"], []).append({
                "id": c["id"], "name": c["name"], "smiles": c["smiles"],
            })

        def _serialise(r) -> dict:
            d = dict(r)
            for k in ("created_at", "updated_at"):
                if d.get(k) is not None:
                    d[k] = d[k].isoformat() if hasattr(d[k], "isoformat") else d[k]
            d["mutations"] = [m for m in (d.get("mutations") or "").split(",") if m]
            d["tags"] = list(d.get("tags") or [])
            d["compounds"] = compounds_by_job.get(d["id"], [])
            d["results"] = []
            d["pdb_quality"] = None
            return d

        profile.recent_dockings = [_serialise(r) for r in rows]
    except Exception as _ex:  # noqa: BLE001
        # Defence-in-depth: a failure here must not break /me/profile
        # itself — auth-bootstrap depends on it staying green.
        import logging as _logging
        import traceback as _tb
        _logging.getLogger(__name__).error(
            "recent_dockings piggy-back failed for user=%s: %s\n%s",
            getattr(user, "id", "?"), _ex, _tb.format_exc(),
        )
        profile.recent_dockings = []
    return profile


@router.put("/profile", response_model=ProfileOut)
def update_my_profile(
    payload: ProfileUpdate,
    user: Annotated[CurrentUser, Depends(current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> ProfileOut:
    """Upsert the profile fields the user supplied. Empty string clears
    the column; missing field leaves it untouched. The typed columns
    are the canonical store — the trigger only mirrors metadata→typed,
    not the other way, so writes here don't propagate back to the
    Supabase user_metadata JSON until the next time the user updates
    metadata via the Supabase JS client (which is fine — the frontend
    reads from this endpoint, not from session.user.user_metadata)."""
    # Build the UPDATE clause dynamically based on which fields the
    # caller supplied. SQL composition via parameter substitution
    # only — no string interpolation of user input.
    fields = payload.model_dump(exclude_unset=True)
    if not fields:
        # No-op update — just return the current row.
        return get_my_profile(user, session)

    # Treat empty string as NULL (clear the column).
    for k, v in list(fields.items()):
        if v == "":
            fields[k] = None

    set_clauses = ", ".join(f"{k} = :{k}" for k in fields.keys())
    fields["uid"] = user.id

    # Try UPDATE first. If no row was hit, INSERT (the OAuth case
    # where the trigger may have written a sparse row OR no row).
    result = session.execute(
        text(
            f"UPDATE public.user_profile SET {set_clauses}, updated_at = NOW()"
            " WHERE user_id = :uid"
        ),
        fields,
    )
    is_first_profile_write = False
    if result.rowcount == 0:
        # No existing row — INSERT one. Default marketing_opt_in to
        # False if not provided in the payload.
        cols = list(fields.keys())  # includes uid
        col_list = ", ".join(["user_id" if c == "uid" else c for c in cols])
        val_list = ", ".join(f":{c}" for c in cols)
        ins = session.execute(
            text(
                f"INSERT INTO public.user_profile ({col_list})"
                f" VALUES ({val_list})"
                " ON CONFLICT (user_id) DO NOTHING"
                " RETURNING user_id"
            ),
            fields,
        )
        # The INSERT actually landed a fresh row (not ON CONFLICT no-op),
        # so this is the first time we're persisting anything for this
        # user. That's our "new signup" hook — any subsequent profile
        # edits hit the UPDATE branch above instead.
        is_first_profile_write = ins.first() is not None
    session.commit()

    # Operator alert: Telegram ping on a brand-new signup. Fired AFTER
    # the commit so a notification implies the user is fully persisted.
    # Wrapped in try/except so a Telegram failure can't take down the
    # signup write (notifications module already swallows internally,
    # but defense in depth).
    if is_first_profile_write:
        try:
            from ..services.notifications import notify_new_user
            notify_new_user(
                user_email=getattr(user, "email", None),
                user_id=user.id,
                signup_method=getattr(user, "provider", None),
                full_name=payload.full_name,
                organization=payload.organization,
                role=payload.role,
            )
        except Exception:
            # Observability must not cascade; log + swallow.
            import logging
            logging.getLogger(__name__).exception("notify_new_user failed")
        # Belt-and-braces: also email the admin via Resend. Telegram is the
        # actionable path (has Approve/Deny buttons); the email is a
        # heads-up so a muted phone doesn't keep a sign-up sitting in
        # 'pending' for hours. Fail-soft (services/email.py swallows
        # internally) so a Resend hiccup can't take down the sign-up.
        try:
            from ..services.email import notify_admin_new_signup
            notify_admin_new_signup(
                user_email=getattr(user, "email", None),
                user_id=user.id,
                full_name=payload.full_name,
                organization=payload.organization,
                role=payload.role,
            )
        except Exception:
            import logging
            logging.getLogger(__name__).exception("notify_admin_new_signup failed")

    return get_my_profile(user, session)


@router.post("/profile/dismiss-onboarding", status_code=204)
def dismiss_onboarding_modal(
    user: Annotated[CurrentUser, Depends(current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> None:
    """Marker that the user dismissed the OAuth complete-profile modal
    without filling it in. Stored as `onboarding_dismissed_at` on the
    profile row so the modal won't pester them on every sign-in. We
    use a column rather than localStorage so dismissal persists across
    browsers / devices."""
    # Lazily add the column on first call — keeps the migration
    # surface small. Once we ship a v4 migration we'd move this to a
    # proper ALTER TABLE there.
    session.execute(text(
        "ALTER TABLE public.user_profile"
        " ADD COLUMN IF NOT EXISTS onboarding_dismissed_at TIMESTAMPTZ"
    ))
    session.execute(text(
        "INSERT INTO public.user_profile (user_id, onboarding_dismissed_at, marketing_opt_in)"
        " VALUES (:uid, NOW(), FALSE)"
        " ON CONFLICT (user_id) DO UPDATE SET onboarding_dismissed_at = NOW()"
    ), {"uid": user.id})
    session.commit()
    return None


class AccessStatusOut(BaseModel):
    """Per-user approval gate state (migration 029). The frontend polls
    this to decide whether to render the pending-lock screen or the
    normal Studio. The backend ALSO enforces the gate on POST /jobs
    (defense-in-depth), so a tampered frontend can't bypass — but the
    UI shouldn't show Run Dock when it'll be rejected."""
    status: str = Field(..., description="pending | approved | denied")
    decided_at: Optional[str] = None
    # Per-feature access for AI Resistance Prediction (Boltz-2). One of:
    # None/"none" (never requested), "requested", "approved", "denied".
    # Admins always read "approved". The Studio uses this to render the
    # button vs the "Request access" CTA vs a "Pending" state.
    boltz2_access: Optional[str] = None
    # Per-feature access for GNINA docking + Virtual Screening (migration 037).
    # Same values as boltz2_access. Admins read "approved".
    gnina_access: Optional[str] = None
    screening_access: Optional[str] = None


@router.get("/access_status", response_model=AccessStatusOut)
def get_access_status(
    user: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
) -> AccessStatusOut:
    """Return the caller's approval status. Pending users see a
    locked-out UI; approved users see the normal app. Cheap (single
    indexed lookup) so the frontend can call it on app load + after
    sign-up to flip from "pending" → "approved" without a full reload.

    Two side effects layered onto the read (both idempotent, both
    cheap):

    1. **Admin auto-approve.** If the caller's email matches ADMIN_EMAIL
       we UPSERT their user_profile row to access_status='approved' so
       admin never sees the pending lock screen — and so the same row
       reads as approved from every other gate (POST /jobs, the admin
       page itself, etc.). Self-healing: if admin's row drifts to
       pending for any reason, the next /me/access_status fixes it.

    2. **First-sign-up notification.** notify_new_user used to fire only
       from POST /me/profile. Google-OAuth users skip /welcome entirely
       (their profile row is auto-created by the migration-003 trigger)
       so the admin never got notified. Migration 031 added a
       signup_notified_at flag; we atomically claim it here on first
       call and fire the Telegram + admin-email notification only when
       we win the race. Backfilled NOW() for existing rows so this
       never double-notifies."""
    import os
    admin_email_env = os.environ.get("ADMIN_EMAIL", "").strip().lower()
    user_email_lc = (getattr(user, "email", "") or "").strip().lower()
    is_admin = bool(admin_email_env) and user_email_lc == admin_email_env

    if is_admin:
        # Self-heal: ensure admin's row exists and reads as approved. The
        # COALESCE on marketing_opt_in keeps the existing column-defaults
        # pattern in step with update_user_pro / update_user_access. The
        # WHERE clause on the UPDATE side keeps this a true no-op once
        # the row is already approved.
        session.execute(text(
            """
            INSERT INTO public.user_profile (user_id, access_status, access_decided_at, access_decided_by, signup_notified_at, marketing_opt_in)
            VALUES (:uid, 'approved', NOW(), 'admin_email_auto', NOW(), FALSE)
            ON CONFLICT (user_id) DO UPDATE SET
                access_status = 'approved',
                access_decided_at = CASE
                    WHEN public.user_profile.access_status = 'approved' THEN public.user_profile.access_decided_at
                    ELSE NOW()
                END,
                access_decided_by = CASE
                    WHEN public.user_profile.access_status = 'approved' THEN public.user_profile.access_decided_by
                    ELSE 'admin_email_auto'
                END,
                signup_notified_at = COALESCE(public.user_profile.signup_notified_at, NOW())
            """
        ), {"uid": user.id})
        session.commit()
        # Admin always has every gated feature (mirrors the gates in jobs.py /
        # screening.py).
        return AccessStatusOut(status="approved", decided_at=None,
                               boltz2_access="approved", gnina_access="approved",
                               screening_access="approved")

    # Watched-user live monitor: ping the operator on Telegram when a
    # watched user's app is active (this endpoint is polled on app load /
    # after sign-in). Deduped to ~30 min inside the helper so a polling
    # frontend doesn't spam. Side-effect only — never blocks the read.
    try:
        from ..services.notifications import is_watched_user, notify_watch_login
        if is_watched_user(user_email_lc):
            notify_watch_login(user_email=user_email_lc)
    except Exception:
        import logging as _wlog
        _wlog.getLogger(__name__).exception("watch-login ping failed (non-fatal)")

    # First-sign-up notification: atomic claim. UPDATE … RETURNING tells
    # us whether THIS request was the first to ever see the row pending +
    # not-yet-notified. If rowcount=1 we won and fire the notifications;
    # otherwise it was a re-call from a later page nav (or an earlier
    # request already claimed it) and we silently move on.
    claimed = False
    try:
        res = session.execute(text(
            "UPDATE public.user_profile "
            "   SET signup_notified_at = NOW() "
            " WHERE user_id = :uid "
            "   AND signup_notified_at IS NULL"
        ), {"uid": user.id})
        session.commit()
        claimed = (res.rowcount or 0) > 0
    except Exception:  # noqa: BLE001
        # Don't break the read on a transient DB issue. Worst case the
        # admin doesn't get notified for this user this time; the next
        # /me/access_status hit will retry.
        import logging
        logging.getLogger(__name__).exception("signup_notified_at claim failed for user %s", user.id)
        session.rollback()

    if claimed:
        # Fire Telegram (Approve/Deny inline buttons) + admin email.
        # Both are fail-soft inside their respective modules — no need
        # to wrap each individually.
        try:
            from ..services.notifications import notify_new_user
            notify_new_user(
                user_email=getattr(user, "email", None),
                user_id=user.id,
                signup_method=getattr(user, "provider", None),
            )
        except Exception:  # noqa: BLE001
            import logging
            logging.getLogger(__name__).exception("notify_new_user failed (fired from access_status)")
        try:
            from ..services.email import notify_admin_new_signup
            notify_admin_new_signup(
                user_email=getattr(user, "email", None),
                user_id=user.id,
            )
        except Exception:  # noqa: BLE001
            import logging
            logging.getLogger(__name__).exception("notify_admin_new_signup failed (fired from access_status)")

    row = session.execute(
        text(
            "SELECT COALESCE(access_status, 'pending') AS status, access_decided_at, "
            "       boltz2_access, gnina_access, screening_access "
            "FROM public.user_profile WHERE user_id = :uid"
        ),
        {"uid": user.id},
    ).mappings().first()
    if not row:
        # No profile row yet (brand-new sign-up before the profile-bootstrap
        # trigger has run) → treat as pending. The profile will be created
        # on the next read/write, with access_status defaulting to
        # 'pending' via the migration 029 column default.
        return AccessStatusOut(status="pending", decided_at=None)
    decided_at = row["access_decided_at"]
    return AccessStatusOut(
        status=(row["status"] or "pending").lower(),
        decided_at=decided_at.isoformat() if decided_at else None,
        boltz2_access=(row["boltz2_access"] or None),
        gnina_access=(row["gnina_access"] or None),
        screening_access=(row["screening_access"] or None),
    )


class Boltz2RequestOut(BaseModel):
    """Result of POST /me/request-boltz2-access. boltz2_access is the new
    state: 'approved' (admins), 'requested' (ping sent to operator), or the
    existing value if already decided."""
    boltz2_access: str = Field(..., description="approved | requested")


@router.post("/request-boltz2-access", response_model=Boltz2RequestOut)
def request_boltz2_access(
    user: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
) -> Boltz2RequestOut:
    """User taps 'Request access' on AI Resistance Prediction (Boltz-2).

    Mirrors the signup approval loop, scoped to the per-feature
    user_profile.boltz2_access flag:

      - Admins (ADMIN_EMAIL) already have the engine — return 'approved'
        without touching the row (parity with the jobs.py gate).
      - Already 'approved' or 'requested' → idempotent no-op (never
        re-spams the operator on a double-tap or page reload).
      - Otherwise (NULL or previously 'denied') → set 'requested' and fire
        the operator's Telegram Approve/Deny ping + backup admin email.
    """
    import logging
    import os
    admin_email_env = os.environ.get("ADMIN_EMAIL", "").strip().lower()
    user_email = getattr(user, "email", None)
    if admin_email_env and (user_email or "").strip().lower() == admin_email_env:
        return Boltz2RequestOut(boltz2_access="approved")

    cur = session.execute(
        text("SELECT boltz2_access FROM public.user_profile WHERE user_id = :uid"),
        {"uid": user.id},
    ).first()
    current = (cur[0] if cur else None) or ""
    if current in ("approved", "requested"):
        # Idempotent — already at a terminal-or-pending state, don't re-notify.
        return Boltz2RequestOut(boltz2_access=current)

    # Flip to 'requested'. UPDATE first (the row exists for any signed-in
    # user via the profile-bootstrap trigger); INSERT-on-conflict is a
    # belt-and-braces fallback for the rare missing-row case.
    try:
        res = session.execute(
            text(
                "UPDATE public.user_profile "
                "   SET boltz2_access = 'requested', boltz2_requested_at = NOW() "
                " WHERE user_id = :uid"
            ),
            {"uid": user.id},
        )
        if (res.rowcount or 0) == 0:
            session.execute(
                text(
                    "INSERT INTO public.user_profile (user_id, boltz2_access, boltz2_requested_at) "
                    "VALUES (:uid, 'requested', NOW()) "
                    "ON CONFLICT (user_id) DO UPDATE SET "
                    "    boltz2_access = 'requested', boltz2_requested_at = NOW()"
                ),
                {"uid": user.id},
            )
        session.commit()
    except Exception:  # noqa: BLE001
        session.rollback()
        logging.getLogger(__name__).exception("boltz2 request flip failed for %s", user.id)
        raise HTTPException(status_code=500, detail="Could not record your request. Please try again.")

    # Fire the operator ping + admin email. Fail-soft — a notification
    # hiccup must not fail the request the user just made.
    try:
        from ..services.notifications import notify_boltz2_request
        notify_boltz2_request(user_email=user_email, user_id=user.id)
    except Exception:  # noqa: BLE001
        logging.getLogger(__name__).exception("notify_boltz2_request failed (non-fatal)")
    try:
        from ..services.email import notify_admin_boltz2_request
        notify_admin_boltz2_request(user_email=user_email, user_id=user.id)
    except Exception:  # noqa: BLE001
        logging.getLogger(__name__).exception("notify_admin_boltz2_request failed (non-fatal)")

    return Boltz2RequestOut(boltz2_access="requested")


# Per-feature access columns on user_profile. Feature name -> column. The
# column is interpolated into SQL below, so this MUST stay an allowlist
# (never user input) — the endpoint 404s any feature not in this dict.
_FEATURE_COLUMNS = {
    "boltz2": "boltz2_access",
    "gnina": "gnina_access",
    "screening": "screening_access",
}


class FeatureRequestOut(BaseModel):
    feature: str
    access: str = Field(..., description="approved | requested")


@router.post("/request-access/{feature}", response_model=FeatureRequestOut)
def request_feature_access(
    feature: str,
    user: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
) -> FeatureRequestOut:
    """Generic per-feature access request — the shared backend for the
    Studio's 'Request access' modals (gnina | screening | boltz2).

    Mirrors the signup approval loop: sets '<feature>_access'='requested'
    and fires the operator's Telegram Approve/Deny ping + admin email.
    Admins are already approved; already-approved/requested is idempotent."""
    import logging
    import os
    feature = (feature or "").strip().lower()
    col = _FEATURE_COLUMNS.get(feature)
    if not col:
        raise HTTPException(status_code=404, detail=f"unknown feature '{feature}'")

    admin_email_env = os.environ.get("ADMIN_EMAIL", "").strip().lower()
    user_email = getattr(user, "email", None)
    if admin_email_env and (user_email or "").strip().lower() == admin_email_env:
        return FeatureRequestOut(feature=feature, access="approved")

    cur = session.execute(
        text(f"SELECT {col} FROM public.user_profile WHERE user_id = :uid"),
        {"uid": user.id},
    ).first()
    current = (cur[0] if cur else None) or ""
    if current in ("approved", "requested"):
        return FeatureRequestOut(feature=feature, access=current)

    try:
        res = session.execute(
            text(f"UPDATE public.user_profile SET {col} = 'requested' WHERE user_id = :uid"),
            {"uid": user.id},
        )
        if (res.rowcount or 0) == 0:
            session.execute(
                text(
                    f"INSERT INTO public.user_profile (user_id, {col}) "
                    f"VALUES (:uid, 'requested') "
                    f"ON CONFLICT (user_id) DO UPDATE SET {col} = 'requested'"
                ),
                {"uid": user.id},
            )
        session.commit()
    except Exception:  # noqa: BLE001
        session.rollback()
        logging.getLogger(__name__).exception("feature %s request flip failed for %s", feature, user.id)
        raise HTTPException(status_code=500, detail="Could not record your request. Please try again.")

    try:
        from ..services.notifications import notify_feature_request
        notify_feature_request(feature=feature, user_email=user_email, user_id=user.id)
    except Exception:  # noqa: BLE001
        logging.getLogger(__name__).exception("notify_feature_request failed (non-fatal)")
    try:
        from ..services.email import notify_admin_feature_request
        notify_admin_feature_request(feature=feature, user_email=user_email, user_id=user.id)
    except Exception:  # noqa: BLE001
        logging.getLogger(__name__).exception("notify_admin_feature_request failed (non-fatal)")

    return FeatureRequestOut(feature=feature, access="requested")
