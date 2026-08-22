"""In-app feedback capture.

  POST /feedback — a logged-in user submits a rating (1-5) + optional written
                   comment + a context string (which page/job they were on).
                   Fired by the frontend feedback modal after the user's 5th
                   dock. The submission is relayed to the operator on BOTH
                   Telegram and email, enriched server-side with the user's
                   identity (name / org / role from their profile) and a
                   timestamp, so the operator knows exactly who said what,
                   where, and when.

Fail-soft: notification failures are logged, never surfaced to the user — a
feedback form that 500s because Telegram is down is worse than a silent miss.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Annotated, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlmodel import Session

from ..auth import CurrentUser, current_user
from ..db import get_session
from ..services.rate_limit import RateLimit, rate_limit

log = logging.getLogger(__name__)

router = APIRouter(prefix="/feedback", tags=["feedback"])

# Generous but abuse-proof: a real user submits once. 10/hour stops a stuck
# client (or a bored tester) from spamming the operator's inbox + Telegram.
_FEEDBACK_LIMIT = rate_limit("feedback", RateLimit(max_requests=10, window_seconds=3600))


class FeedbackIn(BaseModel):
    rating: Optional[int] = Field(default=None, ge=1, le=5)
    message: Optional[str] = Field(default=None, max_length=4000)
    # Would-recommend (NPS-lite): "yes" | "maybe" | "no". Set by the frontend.
    recommend: Optional[str] = Field(default=None, max_length=10)
    # e.g. "job _08z63a3M40 · KRAS 4OBE" or the page URL — set by the frontend.
    context: Optional[str] = Field(default=None, max_length=500)


class FeedbackOut(BaseModel):
    ok: bool = True


@router.post("", response_model=FeedbackOut, status_code=202,
             dependencies=[Depends(_FEEDBACK_LIMIT)])
def submit_feedback(
    payload: FeedbackIn,
    user: Annotated[CurrentUser, Depends(current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> FeedbackOut:
    email = getattr(user, "email", None)

    # Enrich with the user's profile so the operator gets full identity, not
    # just an email. Best-effort — a missing row just means fewer fields.
    full_name = organization = role = None
    try:
        row = session.execute(
            text(
                "SELECT COALESCE(NULLIF(p.full_name,''), "
                "                u.raw_user_meta_data->>'full_name', "
                "                u.raw_user_meta_data->>'name') AS full_name, "
                "       p.organization, p.role "
                "FROM auth.users u "
                "LEFT JOIN public.user_profile p ON p.user_id = u.id "
                "WHERE u.id = :uid"
            ),
            {"uid": user.id},
        ).first()
        if row:
            full_name, organization, role = row[0], row[1], row[2]
    except Exception:  # noqa: BLE001
        log.exception("feedback: profile lookup failed for %s", user.id)

    when = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    # Telegram (operator channel) — actionable, instant.
    try:
        from ..services.notifications import notify_feedback
        notify_feedback(
            user_email=email, full_name=full_name, organization=organization,
            role=role, rating=payload.rating, message=payload.message,
            recommend=payload.recommend, context=payload.context, when=when,
        )
    except Exception:  # noqa: BLE001
        log.exception("feedback: telegram notify failed")

    # Email (so a muted phone / dead Telegram doesn't lose the feedback).
    try:
        from ..services.email import notify_admin_feedback
        notify_admin_feedback(
            user_email=email, full_name=full_name, organization=organization,
            role=role, rating=payload.rating, message=payload.message,
            recommend=payload.recommend, context=payload.context, when=when,
        )
    except Exception:  # noqa: BLE001
        log.exception("feedback: email notify failed")

    log.info("feedback from %s: rating=%s ctx=%s", email, payload.rating, payload.context)
    return FeedbackOut(ok=True)
