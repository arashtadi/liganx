"""Liganx AI Beta — POST /jobs/{job_key}/ask

Q&A endpoint scoped to a single job. The model receives a structured
snapshot of what's on the JobPage and the user's question, and returns
a plain-text answer.

Auth model: requires a logged-in user (Anthropic calls cost real money,
so we don't let strangers burn budget). The job itself stays publicly
readable through GET /jobs/{key} — only the AI Q&A is gated.

Rate-limit: 30 questions per hour per IP (matches the assist_ai bucket).
The RATE_LIMIT_BYPASS_EMAILS env var lifts the cap for the founder's
account during early demos.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session

from ..auth import CurrentUser, current_user
from ..db import get_session
from ..services.ask_ai import ASK_MODEL, ask_claude_about_job, build_job_context
from ..services.rate_limit import RateLimit, rate_limit

log = logging.getLogger(__name__)

router = APIRouter(prefix="/jobs", tags=["ask"])

# 30 Q&A calls per hour per IP. Each call costs roughly $0.001-$0.002
# at Haiku pricing with a typical payload + 800 token cap, so 30/hr is
# ~$0.05/hr/user worst case. The free tier should sustain this; the
# Stripe Pro tier (#212) will lift it.
_ASK_LIMIT = rate_limit("ask_ai", RateLimit(max_requests=30, window_seconds=3600))


class AskRequest(BaseModel):
    """The user's free-form question. min_length=2 keeps accidental
    one-letter submits from burning a call; max_length=1000 caps the
    token budget per request."""
    question: str = Field(..., min_length=2, max_length=1000)


class AskResponse(BaseModel):
    """Returned to the frontend chat panel. `model` is included so the
    UI can show 'powered by claude-haiku-4-5' under the answer — looks
    professional and helps debug if quality complaints come in."""
    answer: str
    model: str
    job_key: str


# Locally re-imported to avoid a circular: routers/jobs.py owns
# `_resolve_job` and that module already imports a lot of things this
# router doesn't need. Re-implement the 3-line resolver inline.
def _resolve_job_for_ask(session: Session, key: str):
    from ..models import Job
    from sqlmodel import select
    if key.isdigit() and len(key) <= 9:
        job = session.get(Job, int(key))
        if job:
            return job
    return session.exec(select(Job).where(Job.share_id == key)).first()


@router.post(
    "/{job_key}/ask",
    response_model=AskResponse,
    dependencies=[Depends(_ASK_LIMIT)],
)
async def ask_about_job(
    job_key: str,
    payload: AskRequest,
    user: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
) -> AskResponse:
    """Answer a free-form question about the job's results, scoped to
    the page's data.

    Errors:
      - 404: job not found (share_id miss or stale link)
      - 503: Anthropic unreachable / rate-limited upstream
      - 429: this server's rate-limit (handled by the dep)
      - 401: missing auth (handled by current_user)
    """
    job = _resolve_job_for_ask(session, job_key)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    # Public jobs are readable by anyone with the share_id, so we DON'T
    # gate on job.user_id == user.id here — that would break the
    # "share a job with a collaborator" flow. We still require auth
    # (the user must be logged in to ask), which is enough to keep
    # cost predictable.

    context = build_job_context(job)
    try:
        result = await ask_claude_about_job(
            context=context, question=payload.question,
        )
    except RuntimeError as e:
        # Maps AI service errors (network, auth, quota) to 503. The
        # frontend shows the message verbatim in the chat bubble so
        # the user sees what happened.
        log.warning("ask_about_job failed for %s: %s", job_key, e)
        raise HTTPException(status_code=503, detail=str(e))

    return AskResponse(
        answer=result.answer,
        model=result.model or ASK_MODEL,
        job_key=job_key,
    )
