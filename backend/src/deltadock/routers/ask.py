"""Liganx AI Beta — POST /jobs/{job_key}/ask + chat history persistence.

Q&A endpoint scoped to a single job. The model receives a structured
snapshot of what's on the JobPage and the user's question, and returns
a plain-text answer.

#224 — chat history persistence:
  Every successful (question, answer) pair is appended to a per-user-
  per-job row in user_job_ai_chat. When the panel re-opens (page
  reload, or jumping back from History) it hydrates via
  GET /jobs/{key}/ai-chat. The persistence is enforce-on-write, with
  three caps: max 20 messages total, AI answers truncated to 500 chars
  before storage, rolling 30-day TTL pruned by a nightly job.

Auth model: requires a logged-in user (Anthropic calls cost real money,
so we don't let strangers burn budget). The job itself stays publicly
readable through GET /jobs/{key} — only the AI Q&A is gated.

Rate-limit: 30 questions per hour per IP (matches the assist_ai bucket).
The RATE_LIMIT_BYPASS_EMAILS env var lifts the cap for the founder's
account during early demos.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlmodel import Session

from ..auth import CurrentUser, current_user
from ..db import get_session
from ..services.ask_ai import (
    ASK_MODEL, ask_claude_about_job, build_job_context, is_chemist_review_intent,
)
from ..services.rate_limit import RateLimit, rate_limit

log = logging.getLogger(__name__)

router = APIRouter(prefix="/jobs", tags=["ask"])

# 30 Q&A calls per hour per IP. Each call costs roughly $0.001-$0.002
# at Haiku pricing with a typical payload + 800 token cap, so 30/hr is
# ~$0.05/hr/user worst case. The free tier should sustain this; the
# Stripe Pro tier (#212) will lift it.
_ASK_LIMIT = rate_limit("ask_ai", RateLimit(max_requests=30, window_seconds=3600))

# Chat history caps (#224). Sized to fit a productive chemist session
# without letting one runaway conversation blow up the row size.
_MAX_MESSAGES = 20         # 10 turns
_MAX_ANSWER_CHARS = 500    # AI replies truncated at write time
_MAX_USER_CHARS = 1000     # matches AskRequest.question max_length


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


class ChatMessage(BaseModel):
    """One persisted turn in the chat. The frontend reconstructs the
    LiganxAIPanel transcript by replaying these in order on open."""
    role: str  # "user" | "assistant"
    text: str
    model_id: Optional[str] = None
    ts: str  # ISO8601 (UTC)


class ChatHistoryResponse(BaseModel):
    """Returned by GET /jobs/{key}/ai-chat. Empty array when the user
    has never asked anything about this job, OR when the user is
    anonymous (we don't expose another user's chat to a guest who
    happens to have the share link)."""
    messages: list[ChatMessage]


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


async def _build_chemist_review_snippet(session: Session, job) -> Optional[str]:
    """(AI1) Run the chemist-reviewer service for the job's best pose
    and format its output as a string snippet the chat can include in
    the user prompt.

    All failure modes are silent — if the API key is missing, the pose
    isn't available, or Anthropic errors out, we return None and the
    chat falls back to plain Q&A. Better a slightly-less-helpful
    answer than a 500."""
    import os
    from sqlmodel import select
    from ..catalog import get_target
    from ..models import Compound, DockingResult
    from ..services.chemist_review import review_pose

    api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        return None

    # Best (most-negative) real result — same picker as the /review endpoint.
    result = session.exec(
        select(DockingResult)
        .where(DockingResult.job_id == job.id)
        .where(DockingResult.best_score < 0)
        .order_by(DockingResult.best_score.asc())                  # type: ignore[attr-defined]
    ).first()
    if not result:
        return None
    compound = session.get(Compound, result.compound_id)
    if not compound:
        return None
    target = get_target(job.pdb_id)

    try:
        review = await review_pose(
            compound_smiles=compound.smiles,
            compound_name=compound.name or f"compound #{compound.id}",
            target_id=target.id if target else (job.pdb_id or "unknown"),
            target_name=target.name if target else (job.pdb_id or "Unknown target"),
            target_uniprot=(target.uniprot if target else (job.uniprot_id or "")),
            pdb_id=job.pdb_id,
            chain=job.chain,
            variant=result.variant,
            indications=(target.indications if target else []),
            docked_score=result.best_score,
            extra=result.extra,
            api_key=api_key,
        )
    except RuntimeError as e:
        log.info("chemist_review skipped in chat path: %s", e)
        return None

    # Format the structured review into a tight text block. Compact on
    # purpose — Claude's context window is precious, and the chat's
    # second LLM call will paraphrase this into the actual answer.
    lines = [
        f"Compound: {compound.name or f'#{compound.id}'} ({compound.smiles})",
        f"Variant: {result.variant}",
        f"Docked score: {result.best_score:+.2f} kcal/mol",
        f"Verdict: {review.verdict}",
        f"Headline: {review.headline}",
        f"Summary: {review.summary}",
    ]
    if review.strengths:
        lines.append("Strengths:")
        lines.extend(f"  - {s}" for s in review.strengths)
    if review.concerns:
        lines.append("Concerns:")
        lines.extend(f"  - {c}" for c in review.concerns)
    if review.suggestions:
        lines.append("Suggestions:")
        lines.extend(f"  - {s}" for s in review.suggestions)
    if review.criteria:
        lines.append("Per-criterion:")
        for k, v in review.criteria.items():
            lines.append(f"  {k}: {v}")
    return "\n".join(lines)


def _load_chat_messages(session: Session, user_id: str, job_share_id: str) -> list[dict[str, Any]]:
    """Pull the existing chat row's messages array. Returns [] when no
    row exists yet for this (user, job) pair."""
    row = session.execute(
        text(
            "SELECT messages FROM user_job_ai_chat "
            "WHERE user_id = :uid AND job_share_id = :sid"
        ),
        {"uid": user_id, "sid": job_share_id},
    ).first()
    if not row:
        return []
    msgs = row[0]
    # psycopg2 returns JSONB as a Python list directly; defend against
    # the row containing a stringified JSON blob too (older inserts).
    if isinstance(msgs, str):
        try:
            msgs = json.loads(msgs)
        except json.JSONDecodeError:
            msgs = []
    return msgs if isinstance(msgs, list) else []


def _append_chat_turn(
    session: Session,
    *,
    user_id: str,
    job_share_id: str,
    question: str,
    answer: str,
    model_id: Optional[str],
) -> None:
    """Append the (user, assistant) pair to the chat row, enforcing
    the caps. Uses INSERT … ON CONFLICT … UPDATE so the first call
    creates the row and subsequent calls extend it atomically.

    The write happens AFTER the AI response succeeds — we don't want a
    failed answer to pollute the history. Errors in this function are
    swallowed with a log because losing chat history is annoying but
    not worth failing the user's request over.
    """
    try:
        now_iso = datetime.now(timezone.utc).isoformat()
        existing = _load_chat_messages(session, user_id, job_share_id)
        # Cap each text on write so a malformed long answer never lives
        # in the row.
        new_messages = [
            {
                "role": "user",
                "text": question[:_MAX_USER_CHARS],
                "model_id": None,
                "ts": now_iso,
            },
            {
                "role": "assistant",
                "text": answer[:_MAX_ANSWER_CHARS],
                "model_id": model_id,
                "ts": now_iso,
            },
        ]
        combined = existing + new_messages
        # Roll-off oldest pairs when we exceed the cap. We drop pairs
        # (2 at a time) rather than single messages so the transcript
        # never starts mid-Q&A.
        if len(combined) > _MAX_MESSAGES:
            overflow = len(combined) - _MAX_MESSAGES
            # Round up to even so a user→assistant pair always stays
            # paired at the front of the window.
            if overflow % 2 == 1:
                overflow += 1
            combined = combined[overflow:]
        payload_json = json.dumps(combined)
        session.execute(
            text(
                """
                INSERT INTO user_job_ai_chat (user_id, job_share_id, messages, updated_at)
                VALUES (:uid, :sid, CAST(:msgs AS JSONB), now())
                ON CONFLICT (user_id, job_share_id) DO UPDATE
                  SET messages = EXCLUDED.messages,
                      updated_at = now()
                """
            ),
            {"uid": user_id, "sid": job_share_id, "msgs": payload_json},
        )
        session.commit()
    except Exception:
        # Don't let a chat-history insert failure block the user's
        # answer. They'll see the response inline; only the persistence
        # silently failed. Log and move on.
        log.exception("ai chat history persist failed for user=%s job=%s",
                      user_id, job_share_id)
        try:
            session.rollback()
        except Exception:
            pass


@router.get("/{job_key}/ai-chat", response_model=ChatHistoryResponse)
def get_ai_chat_history(
    job_key: str,
    user: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
) -> ChatHistoryResponse:
    """Hydrate the LiganxAIPanel with the user's prior turns for this
    job. Returns an empty list when nothing's persisted.

    Per-user scoping is enforced by the WHERE clause: the row's PK is
    (user_id, job_share_id), so user A asking about job X can NEVER
    see user B's chat about the same X, even if X is publicly shared.
    """
    job = _resolve_job_for_ask(session, job_key)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    raw = _load_chat_messages(session, str(user.id), job.share_id)
    # Defensive: clamp the response to _MAX_MESSAGES even if the row
    # somehow exceeds it (e.g. a future bug bypasses the write-side
    # cap). The frontend trusts this list size.
    raw = raw[-_MAX_MESSAGES:]
    messages: list[ChatMessage] = []
    for m in raw:
        if not isinstance(m, dict):
            continue
        role = m.get("role")
        if role not in ("user", "assistant"):
            continue
        text_val = m.get("text") or ""
        messages.append(ChatMessage(
            role=role,
            text=text_val,
            model_id=m.get("model_id"),
            ts=m.get("ts") or "",
        ))
    return ChatHistoryResponse(messages=messages)


class AiSuggestionsResponse(BaseModel):
    target_id: str
    target_name: str
    mutations: list[str]
    suggestions: list[str]


@router.get("/{job_key}/ai-suggestions", response_model=AiSuggestionsResponse)
def get_ai_suggestions(
    job_key: str,
    session: Session = Depends(get_session),
) -> AiSuggestionsResponse:
    """Three quick-question suggestions tailored to this job's target +
    mutation. Static lookup table — no LLM call, no auth required, free.

    The frontend renders these as one-click "ask this" buttons above the
    chat input on first open. Replaces the old hard-coded trio so a KRAS
    job no longer suggests an EGFR-specific question and vice-versa.
    """
    from ..services.ai_suggestions import suggestions_for_job
    job = _resolve_job_for_ask(session, job_key)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    s = suggestions_for_job(pdb_id=job.pdb_id, mutations=list(job.mutations or []))
    return AiSuggestionsResponse(
        target_id=s.target_id,
        target_name=s.target_name,
        mutations=s.mutations,
        suggestions=s.suggestions,
    )


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
    the page's data. Side effect (#224): appends the (Q, A) pair to
    user_job_ai_chat so the panel can rehydrate later.

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

    # (AI1) If the user is asking for a pose review, run the chemist-
    # reviewer service first and inject its structured verdict into
    # the chat call. Two Claude calls per question (chemist + chat),
    # but only for the specific intent — most chat questions stay
    # single-call.
    chemist_snippet: str | None = None
    if is_chemist_review_intent(payload.question):
        chemist_snippet = await _build_chemist_review_snippet(session, job)

    try:
        result = await ask_claude_about_job(
            context=context,
            question=payload.question,
            chemist_review_snippet=chemist_snippet,
        )
    except RuntimeError as e:
        # Maps AI service errors (network, auth, quota) to 503. The
        # frontend shows the message verbatim in the chat bubble so
        # the user sees what happened.
        log.warning("ask_about_job failed for %s: %s", job_key, e)
        raise HTTPException(status_code=503, detail=str(e))

    # Persist the turn AFTER the AI response succeeds — see
    # _append_chat_turn for the caps. Errors in persistence don't
    # fail the user's request.
    _append_chat_turn(
        session,
        user_id=str(user.id),
        job_share_id=job.share_id,
        question=payload.question,
        answer=result.answer,
        model_id=result.model or ASK_MODEL,
    )

    return AskResponse(
        answer=result.answer,
        model=result.model or ASK_MODEL,
        job_key=job_key,
    )
