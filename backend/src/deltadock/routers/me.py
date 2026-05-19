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

from fastapi import APIRouter, Depends, HTTPException
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
    include: Optional[str] = None,
    offset: int = 0,
    limit: int = 25,
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

    # (U17j) Piggy-back the recent dockings only when explicitly asked
    # for. Local import avoids the circular dep between me.py and
    # routers/jobs.py (jobs.py imports nothing from me.py, but the
    # module-level import would force jobs.py to load whenever profile
    # is accessed by the auth dance during app startup).
    if include and "dockings" in include.split(","):
        from .jobs import list_jobs  # local: see comment above
        offset = max(0, int(offset))
        limit = max(1, min(200, int(limit)))
        rows = list_jobs(limit=limit, offset=offset, user=user, session=session)
        # JobOut → dict via pydantic so the ProfileOut.recent_dockings
        # field (Optional[list[dict]]) serialises cleanly.
        profile.recent_dockings = [
            r.model_dump() if hasattr(r, "model_dump") else dict(r)
            for r in rows
        ]
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
