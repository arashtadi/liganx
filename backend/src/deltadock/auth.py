"""Supabase Auth — JWT verification + FastAPI dependencies.

The Supabase project signs user JWTs with an ES256 asymmetric key. Verification
uses the public JWKS at:

    https://<project>.supabase.co/auth/v1/.well-known/jwks.json

We cache the JWKS in-process (PyJWKClient handles refresh on key rotation —
on a `kid` miss it re-fetches automatically). No shared secret is involved,
so there's nothing to put in Fly secrets.

Three dependencies are exposed:

  * `current_user`        — required, returns the authenticated user or 401.
  * `current_user_or_none` — optional, returns None if no token (used for
                             public-by-share-id endpoints that adapt their
                             behaviour when the viewer happens to be logged in).
  * `verified_user`       — required + email_confirmed_at must be set. Apply
                             this on POST /jobs to prevent burner accounts
                             from queueing GPU work before email-verifying.

The current dataclass exposes:
  * id           — UUID, the auth.users.id (use this as Job.user_id).
  * email        — the user's email (display only).
  * email_verified — bool, derived from `email_confirmed_at` claim.
  * raw          — the full decoded payload, in case other claims are useful.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Annotated, Optional

import jwt
from fastapi import Depends, Header, HTTPException, status
from jwt import PyJWKClient
from sqlalchemy import text

log = logging.getLogger(__name__)


# ── Settings ──────────────────────────────────────────────────────────────

# Inferred from DATABASE_URL by extract_supabase_url() at startup, but can be
# explicitly overridden via env. Keep this lazy so unit tests don't need a
# real Supabase project to import the module.
_SUPABASE_URL = os.environ.get("SUPABASE_URL")
_AUDIENCE = os.environ.get("SUPABASE_JWT_AUD", "authenticated")


def _supabase_url() -> str:
    """Resolve the Supabase project URL. Cached after first lookup.

    Env var SUPABASE_URL takes precedence. Otherwise we extract the project ref
    from DATABASE_URL (which has the form
    `postgresql://postgres.<project_ref>:...@aws-0-us-east-2.pooler.supabase.com`
    on Supabase pooled connections) and synthesize the URL.
    """
    global _SUPABASE_URL
    if _SUPABASE_URL:
        return _SUPABASE_URL
    db_url = os.environ.get("DATABASE_URL", "")
    # postgresql+psycopg2://postgres.<ref>:password@host:5432/dbname
    import re
    m = re.search(r"postgres\.([a-z0-9]+):", db_url)
    if not m:
        raise RuntimeError(
            "Cannot determine Supabase project URL — set SUPABASE_URL or ensure "
            "DATABASE_URL contains a Supabase pooler connection string."
        )
    _SUPABASE_URL = f"https://{m.group(1)}.supabase.co"
    return _SUPABASE_URL


# Lazy PyJWKClient — first request triggers JWKS fetch; thereafter it's cached
# and only refreshes on a kid miss (key rotation).
_jwks_client: PyJWKClient | None = None


def _get_jwks_client() -> PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        url = _supabase_url() + "/auth/v1/.well-known/jwks.json"
        _jwks_client = PyJWKClient(url, cache_jwk_set=True, lifespan=3600)
    return _jwks_client


# ── User type ─────────────────────────────────────────────────────────────

@dataclass(frozen=True, slots=True)
class CurrentUser:
    id: str             # UUID — use as Job.user_id
    email: str
    email_verified: bool
    raw: dict


def _decode(token: str) -> CurrentUser:
    """Decode and verify a Supabase JWT. Raises HTTPException(401) on failure."""
    try:
        signing_key = _get_jwks_client().get_signing_key_from_jwt(token).key
        payload = jwt.decode(
            token,
            signing_key,
            algorithms=["ES256"],
            audience=_AUDIENCE,
            options={"require": ["sub", "exp"]},
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired — sign in again")
    except jwt.InvalidAudienceError:
        raise HTTPException(status_code=401, detail="Token audience mismatch")
    except jwt.PyJWTError as e:
        log.warning("JWT verification failed: %s", e)
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    except Exception as e:
        # Network failure fetching JWKS, etc. — fail closed.
        log.exception("JWKS lookup failed: %s", e)
        raise HTTPException(status_code=503, detail="Auth service unavailable")

    sub = payload.get("sub")
    if not sub:
        raise HTTPException(status_code=401, detail="Token missing subject")
    email = payload.get("email") or ""

    # Email-verified determination — has to handle BOTH password-flow and
    # OAuth-flow users:
    #
    # 1. Password flow: user clicks the email-confirmation link, Supabase
    #    sets `email_confirmed_at` on the auth.users row. Some Supabase
    #    projects propagate this to the JWT as a top-level claim, others
    #    don't — depends on JWT template settings.
    #
    # 2. OAuth flow (Google, GitHub, etc.): the provider has already
    #    verified the email at the source, so Supabase auto-sets the
    #    confirmed timestamp at signup. The JWT's `app_metadata.provider`
    #    field will be "google"/"github"/etc instead of "email", and
    #    `user_metadata.email_verified` is set to true.
    #
    # We treat the user as verified if ANY of these signals are true.
    # Falling back to "no" only when the user used password signup AND
    # hasn't clicked the link yet — exactly the case where the email-
    # verification gate is meaningful.
    app_md = payload.get("app_metadata") or {}
    user_md = payload.get("user_metadata") or {}
    provider = app_md.get("provider") or ""
    providers = app_md.get("providers") or []
    has_oauth_provider = (
        (provider and provider != "email")
        or any(p and p != "email" for p in providers)
    )
    email_verified = bool(
        payload.get("email_confirmed_at")
        or payload.get("confirmed_at")
        or user_md.get("email_verified") is True
        or has_oauth_provider
    )
    return CurrentUser(
        id=str(sub),
        email=email,
        email_verified=email_verified,
        raw=payload,
    )


# ── FastAPI dependencies ──────────────────────────────────────────────────

def _extract_bearer(authorization: str | None) -> str | None:
    """Return the bearer token if the header is well-formed, else None."""
    if not authorization:
        return None
    parts = authorization.split(None, 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    return parts[1].strip() or None


def current_user(
    authorization: Annotated[str | None, Header()] = None,
) -> CurrentUser:
    """Hard-required authenticated user. Apply to endpoints that must have
    an owner — POST /jobs, GET /jobs (list), POST /jobs/{key}/cancel, etc."""
    token = _extract_bearer(authorization)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sign in required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return _decode(token)


def current_user_or_none(
    authorization: Annotated[str | None, Header()] = None,
) -> CurrentUser | None:
    """Optional auth. Endpoints that are public-by-default (e.g. share-link
    GET /jobs/{share_id}) but want to know who's viewing for personalization
    or analytics use this. Returns None if no token; never raises 401."""
    token = _extract_bearer(authorization)
    if not token:
        return None
    try:
        return _decode(token)
    except HTTPException:
        # Bad/expired token on a public endpoint shouldn't break the page.
        return None


def verified_user(user: Annotated[CurrentUser, Depends(current_user)]) -> CurrentUser:
    """Auth + email-confirmed gate. Apply to expensive operations like
    POST /jobs so unverified accounts can't burn GPU credit."""
    if not user.email_verified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Confirm your email before submitting docking jobs. "
                   "Check your inbox for the verification link, or visit "
                   "/account to resend it.",
        )
    return user


def profile_complete_user(user: Annotated[CurrentUser, Depends(verified_user)]) -> CurrentUser:
    """Auth + email-verified + profile-complete gate.

    Apply to write endpoints (POST /jobs, POST /me/compounds, etc.) that
    should require the user to have filled out the welcome form. The
    frontend ProfileRedirect routes new users to /welcome and bounces
    them back if they try to navigate elsewhere — this is the
    server-side defense-in-depth so a tampered client can't bypass.

    "Complete" means: organization AND role are both non-empty in
    public.user_profile. We use a fresh session here (rather than asking
    the caller to inject one) so applying the dependency requires no
    changes to the calling endpoint signature beyond swapping the dep.

    Returns 403 with a frontend-friendly message; the frontend's API
    helper turns 403s with this exact detail prefix into a redirect to
    /welcome (see api.ts).
    """
    # Local imports to avoid a circular: db.py imports from this module
    # transitively via the routers.
    from sqlmodel import Session
    from sqlalchemy import text
    from .db import engine

    with Session(engine) as session:
        row = session.execute(
            text(
                "SELECT organization, role FROM public.user_profile"
                " WHERE user_id = :uid"
            ),
            {"uid": user.id},
        ).mappings().first()

    org = (row or {}).get("organization") or ""
    role = (row or {}).get("role") or ""
    if not org.strip() or not role.strip():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Please complete your profile before submitting jobs. "
                   "Visit /welcome to fill out your organization and role.",
        )
    return user


# ── Admin gate ────────────────────────────────────────────────────────────
#
# Admin endpoints (/admin/*) are gated behind a single email allowlist
# pulled from the ADMIN_EMAIL env var. We do NOT use a database "is_admin"
# flag because:
#   - There's only one admin in practice (Arash). Adding a column for a
#     constant of 1 is overkill.
#   - The env var is set via Fly secrets, so an attacker would need to
#     compromise our Fly account to grant themselves admin — which is
#     strictly stronger than any DB-flag scheme that could be flipped via
#     a misconfigured INSERT.
#   - Multi-admin support can be added later by switching to a comma-
#     separated env var (ADMIN_EMAILS) without breaking single-admin
#     deployments.
#
# The check is case-insensitive because Supabase normalizes email casing
# inconsistently between OAuth and password flows.
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "").strip().lower()


def is_pro_user(user_id: Optional[str], session) -> bool:
    """Return True if the user has user_profile.is_pro = TRUE OR is the
    configured admin. Cheap one-column read against an indexed PK.

    Designed for routers that need to gate features (GNINA, /screening)
    without coupling to fastapi.Depends — call from inside the handler
    after you already have a Session. NULL/missing rows return False so
    a brand-new OAuth user (no profile row yet) defaults to free tier."""
    if not user_id:
        return False
    # Admin email always implicit Pro
    try:
        row = session.execute(
            text("SELECT email FROM auth.users WHERE id = :uid"),
            {"uid": user_id},
        ).first()
        if row and (row[0] or "").strip().lower() == ADMIN_EMAIL:
            return True
    except Exception:
        # Any auth.users read failure → fall through to profile check
        pass
    try:
        row = session.execute(
            text("SELECT COALESCE(is_pro, FALSE) FROM public.user_profile WHERE user_id = :uid"),
            {"uid": user_id},
        ).first()
        return bool(row and row[0])
    except Exception:
        # Defensive: if the column doesn't exist yet (migration hasn't
        # run), treat everyone as free tier. The migration runs on
        # startup so this is only relevant in the brief window before
        # the next deploy.
        return False


def ensemble_access_allowed(user_id: Optional[str], session) -> bool:
    """Return True if the user may submit ensemble-docking Full Jobs.

    Ensemble docking is UNGATED BY DEFAULT — this is an admin kill-switch,
    NOT a billing tier like is_pro. The result is True unless an admin has
    explicitly set user_profile.ensemble_enabled = FALSE for this user. A
    missing profile row, a NULL column, or the column not existing yet
    (migration 016 hasn't run) all resolve to True = access. The
    configured admin email is always allowed.

    Designed for routers gating the ensemble feature without coupling to
    fastapi.Depends — call from inside the handler after you already have
    a Session. Same call shape as is_pro_user."""
    if not user_id:
        # Job submission requires auth, so this shouldn't fire — but
        # default-allow keeps parity with "ungated by default".
        return True
    # Admin email is always allowed (mirrors is_pro_user).
    try:
        row = session.execute(
            text("SELECT email FROM auth.users WHERE id = :uid"),
            {"uid": user_id},
        ).first()
        if row and (row[0] or "").strip().lower() == ADMIN_EMAIL:
            return True
    except Exception:
        # Any auth.users read failure → fall through to the profile check.
        pass
    try:
        row = session.execute(
            text(
                "SELECT COALESCE(ensemble_enabled, TRUE) "
                "FROM public.user_profile WHERE user_id = :uid"
            ),
            {"uid": user_id},
        ).first()
        # No profile row → ungated (True). Row present → honour the
        # COALESCE'd value (only an explicit FALSE blocks).
        if row is None:
            return True
        return bool(row[0])
    except Exception:
        # Column doesn't exist yet (migration 016 pending) → ungated.
        return True


def admin_user(user: Annotated[CurrentUser, Depends(current_user)]) -> CurrentUser:
    """Auth + admin email gate. Apply to /admin/* endpoints. Returns 403
    (not 401) for authenticated-but-not-admin users so we can distinguish
    \"sign in needed\" from \"signed in but no permission\" in the UI."""
    if not ADMIN_EMAIL:
        # Misconfigured server (env var not set). Fail closed so we never
        # accidentally expose admin endpoints in dev.
        log.error("ADMIN_EMAIL env var not set — refusing all admin access")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Admin access is not configured on this server.",
        )
    if user.email.strip().lower() != ADMIN_EMAIL:
        # Don't leak who the admin is; just say "not authorized".
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required.",
        )
    return user
