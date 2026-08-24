"""Per-feature usage allowances for approved users.

A companion to the base ``job_quota`` (see routers/jobs.py). Access flags
(migrations 036–039) decide *whether* a user can touch a feature; these quotas
decide *how much*. Each is a lifetime total the user spends down; when they hit
it they can "Request more" and the operator Grants +N on Telegram (the webhook
bumps the ``<feature>_quota`` column — see routers/telegram_webhook.py).

Design notes:
  • Usage is DERIVED from the real tables (job / screening_job / resistance_scan)
    rather than a separate counter, so it can never drift from what actually ran.
  • Admins (ADMIN_EMAIL) bypass every quota — parity with the access gates.
  • Enforcement raises HTTP 402 with a structured detail the frontend switches on
    (kind="feature_quota") to open the right "request more" modal.
"""
from __future__ import annotations

import os
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import text
from sqlmodel import Session

# feature -> user_profile column holding that feature's allowance.
FEATURE_QUOTA_COL = {
    "gnina": "gnina_quota",
    "boltz2": "boltz2_quota",
    "resistance": "resistance_quota",
    "screening": "screening_quota",
}

# Default allowance when the column is NULL (old rows) — matches migration 040.
FEATURE_QUOTA_DEFAULT = {
    "gnina": 25,
    "boltz2": 5,
    "resistance": 5,
    "screening": 300,
}

# How much a single operator "Grant" adds (the webhook uses this).
FEATURE_GRANT = {
    "gnina": 25,
    "boltz2": 5,
    "resistance": 5,
    "screening": 300,
}

# Unit label for user-facing copy.
FEATURE_UNIT = {
    "gnina": "GNINA runs",
    "boltz2": "AI Resistance runs",
    "resistance": "Resistance Radar scans",
    "screening": "screening compounds",
}

# SQL that counts a user's lifetime usage of each feature. :uid is bound.
_FEATURE_USED_SQL = {
    "gnina": "SELECT COUNT(*) FROM job WHERE user_id = :uid AND engine = 'gnina'",
    "boltz2": "SELECT COUNT(*) FROM job WHERE user_id = :uid AND engine LIKE 'boltz2%'",
    "resistance": "SELECT COUNT(*) FROM resistance_scan WHERE user_id = :uid",
    "screening": "SELECT COALESCE(SUM(n_total), 0) FROM screening_job WHERE user_id = :uid",
}


def _is_admin(user) -> bool:
    admin_email = os.environ.get("ADMIN_EMAIL", "").strip().lower()
    return bool(admin_email) and (getattr(user, "email", "") or "").strip().lower() == admin_email


def feature_quota_status(session: Session, user_id: str, feature: str) -> tuple[int, int]:
    """Return (used, quota) for a feature. Unknown feature → (0, 0)."""
    col = FEATURE_QUOTA_COL.get(feature)
    if not col:
        return 0, 0
    default = FEATURE_QUOTA_DEFAULT[feature]
    qrow = session.execute(
        text(f"SELECT COALESCE({col}, :d) FROM public.user_profile WHERE user_id = :uid"),
        {"d": default, "uid": user_id},
    ).first()
    quota = int(qrow[0]) if qrow and qrow[0] is not None else default
    used = session.execute(text(_FEATURE_USED_SQL[feature]), {"uid": user_id}).scalar() or 0
    return int(used), int(quota)


def enforce_feature_quota(session: Session, user, feature: str, increment: int = 1) -> None:
    """Raise HTTP 402 if this action would exceed the user's allowance for the
    feature. `increment` is how much the action consumes (1 for a run/scan; the
    compound count for a screening). Admins bypass. No-op for unknown features."""
    if feature not in FEATURE_QUOTA_COL:
        return
    if _is_admin(user):
        return
    used, quota = feature_quota_status(session, str(user.id), feature)
    if used + increment <= quota:
        return
    # Best-effort operator ping (never turns a clean 402 into a 500).
    try:
        from .notifications import notify_feature_quota_reached, user_identity
        _, _fn, _org = user_identity(session, str(user.id))
        notify_feature_quota_reached(
            feature=feature,
            user_email=getattr(user, "email", None),
            user_id=str(user.id),
            used=used,
            quota=quota,
            full_name=_fn,
            organization=_org,
        )
    except Exception:  # noqa: BLE001
        import logging
        logging.getLogger(__name__).exception("notify_feature_quota_reached failed (non-fatal)")

    unit = FEATURE_UNIT.get(feature, "runs")
    raise HTTPException(
        status_code=402,
        detail={
            "kind": "feature_quota",
            "feature": feature,
            "used": used,
            "quota": quota,
            "unit": unit,
            "message": (
                f"You've used all {quota} of your {unit}. "
                "Request more and we'll top you up."
            ),
        },
        headers={"X-Feature-Quota-Used": str(used), "X-Feature-Quota-Limit": str(quota)},
    )
