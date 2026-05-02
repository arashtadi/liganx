"""Per-user compound library — CRUD for public.user_compound.

Backs the "Your library" section in the New-job form. The form fires a
POST whenever a compound row has both a name AND a valid SMILES; the
endpoint upserts on (user_id, name) so re-saving a name with a new
SMILES is treated as an edit rather than a duplicate insert. Delete is
straightforward by id.

Auth: every endpoint requires a signed-in user; rows are scoped to
user_id so one user can't read or write another's library even with a
direct API call.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Annotated, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlmodel import Session

from ..auth import CurrentUser, current_user
from ..db import get_session

router = APIRouter(prefix="/me/compounds", tags=["me", "compounds"])


# Per-user library cap — keeps a runaway client (or a mis-behaving auto-save)
# from filling the table indefinitely. 200 is comfortably more than any
# user is likely to maintain by hand.
MAX_LIBRARY_PER_USER = 200

# AI suggestion history cap — frontend prunes oldest unstarred entry on
# the 11th save, but we enforce server-side too in case a curl client
# tries to push an unbounded list. Each entry is ~500 bytes so 10 is
# ~5 KB per compound; comfortably small.
MAX_AI_HISTORY_PER_COMPOUND = 10


class AIHistoryEntry(BaseModel):
    """One entry in a compound's AI suggestion log.

    These are produced by the AI sidebar in the Ketcher modal — every
    time the user asks for an edit ("make it more soluble") the response
    is appended here so re-opening the compound days later restores the
    full conversation. The frontend manages the array (append on new
    response, delete per entry, flag toggle); the backend just stores it
    verbatim. See migrations/009_ai_history.sql for the JSONB shape."""
    id: str = Field(min_length=1, max_length=64)
    ts: str = Field(min_length=1, max_length=32)  # ISO 8601
    instruction: str = Field(min_length=1, max_length=500)
    smiles: str = Field(min_length=1, max_length=2000)
    rationale: str = Field(default="", max_length=2000)
    warnings: list[str] = Field(default_factory=list, max_length=10)
    flag: Optional[Literal["star", "reject"]] = None


class CompoundOut(BaseModel):
    id: int
    name: str
    smiles: str
    tags: list[str] = []
    ai_history: list[AIHistoryEntry] = []
    created_at: datetime
    updated_at: datetime


class CompoundUpsert(BaseModel):
    """Auto-save payload — both name and SMILES required because the
    frontend only fires this once both fields are non-empty. Trim and
    length-bound on the API side too so a curl caller can't smuggle
    in 100 MB of pasted SMILES."""
    name: str = Field(min_length=1, max_length=200)
    smiles: str = Field(min_length=1, max_length=2000)


class CompoundTagsUpdate(BaseModel):
    """PATCH-style payload for tag edits. Always replaces the whole tag
    set — same shape as job tags. Bounded length so a runaway client
    can't store an unreasonable list."""
    tags: list[str] = Field(default_factory=list, max_length=20)


class CompoundAIHistoryUpdate(BaseModel):
    """PATCH-style payload for AI history edits — replaces the whole
    array. Same pattern as tags: frontend manages the list (append /
    delete / flag toggle) and PUTs the canonical version. Server caps
    at MAX_AI_HISTORY_PER_COMPOUND entries; anything over that is
    silently truncated to the most-recent N (after sorting starred
    entries to the top, since starred are protected from auto-prune)."""
    ai_history: list[AIHistoryEntry] = Field(default_factory=list)


@router.get("", response_model=list[CompoundOut])
def list_my_compounds(
    user: Annotated[CurrentUser, Depends(current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> list[CompoundOut]:
    """Return the user's saved compound library, newest-first.

    Newest-first matches the user's mental model after a save burst —
    the compound they JUST named is the one they probably want to add
    to the job they're building right now."""
    rows = session.execute(
        text(
            "SELECT id, name, smiles, tags, ai_history, created_at, updated_at"
            " FROM public.user_compound"
            " WHERE user_id = :uid"
            " ORDER BY updated_at DESC, id DESC"
        ),
        {"uid": user.id},
    ).mappings().all()
    return [CompoundOut(**dict(r)) for r in rows]


@router.post("", response_model=CompoundOut)
def upsert_my_compound(
    payload: CompoundUpsert,
    user: Annotated[CurrentUser, Depends(current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> CompoundOut:
    """Save or update a compound by name. The (user_id, name) unique
    constraint makes this an upsert by name — if the user re-saves
    "Aspirin" with a different SMILES, the existing row's smiles +
    updated_at fields are bumped instead of inserting a duplicate.

    Capped at MAX_LIBRARY_PER_USER total entries per user. Returning a
    409 (Conflict) on overflow keeps the frontend's mutation handler
    simple — it can show a friendly cap-reached toast on the same status
    code path it would use for any save error."""
    name = payload.name.strip()
    smiles = payload.smiles.strip()
    if not name or not smiles:
        raise HTTPException(status_code=400, detail="name and smiles required")

    # Check the cap, but only when this would be a NEW row — updating an
    # existing entry can never push the user over the cap.
    existing = session.execute(
        text(
            "SELECT id FROM public.user_compound"
            " WHERE user_id = :uid AND name = :name"
        ),
        {"uid": user.id, "name": name},
    ).first()
    if existing is None:
        total = session.execute(
            text("SELECT count(*) FROM public.user_compound WHERE user_id = :uid"),
            {"uid": user.id},
        ).scalar() or 0
        if total >= MAX_LIBRARY_PER_USER:
            raise HTTPException(
                status_code=409,
                detail=f"Compound library cap reached ({MAX_LIBRARY_PER_USER}). Remove some to add more.",
            )

    # ON CONFLICT does the upsert by (user_id, name). RETURNING gives us
    # back the canonical row so the frontend can display the new id and
    # timestamps without a follow-up GET. Tags are preserved on update —
    # the upsert never touches them; tag edits go through PATCH /tags.
    row = session.execute(
        text(
            "INSERT INTO public.user_compound (user_id, name, smiles)"
            " VALUES (:uid, :name, :smiles)"
            " ON CONFLICT (user_id, name) DO UPDATE SET"
            "   smiles = EXCLUDED.smiles,"
            "   updated_at = NOW()"
            " RETURNING id, name, smiles, tags, ai_history, created_at, updated_at"
        ),
        {"uid": user.id, "name": name, "smiles": smiles},
    ).mappings().first()
    session.commit()
    if row is None:  # defensive — shouldn't happen with RETURNING
        raise HTTPException(status_code=500, detail="upsert returned no row")
    return CompoundOut(**dict(row))


@router.patch("/{compound_id}/tags", response_model=CompoundOut)
def update_my_compound_tags(
    compound_id: int,
    payload: CompoundTagsUpdate,
    user: Annotated[CurrentUser, Depends(current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> CompoundOut:
    """Replace the tag set on a compound. Mirrors how job tags work — the
    frontend sends the full list; backend overwrites. We trim and dedupe
    server-side so a re-played payload with whitespace variants doesn't
    end up with ['Favorite', ' favorite ', 'FAVORITE'] all saved as
    separate tags."""
    cleaned: list[str] = []
    seen: set[str] = set()
    for raw in payload.tags:
        t = raw.strip()
        if not t:
            continue
        if len(t) > 40:  # match the History tag length
            t = t[:40]
        key = t.lower()
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(t)

    row = session.execute(
        text(
            "UPDATE public.user_compound"
            " SET tags = :tags, updated_at = NOW()"
            " WHERE id = :cid AND user_id = :uid"
            " RETURNING id, name, smiles, tags, ai_history, created_at, updated_at"
        ),
        {"cid": compound_id, "uid": user.id, "tags": cleaned},
    ).mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="Compound not found")
    session.commit()
    return CompoundOut(**dict(row))


@router.patch("/{compound_id}/ai-history", response_model=CompoundOut)
def update_my_compound_ai_history(
    compound_id: int,
    payload: CompoundAIHistoryUpdate,
    user: Annotated[CurrentUser, Depends(current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> CompoundOut:
    """Replace the AI suggestion history for a compound. Same shape as
    PATCH /tags — frontend manages the array (append on response,
    delete per entry, flag toggle) and PUTs the canonical version.

    Server-side cap: keep all starred entries plus enough recent
    unstarred entries to reach MAX_AI_HISTORY_PER_COMPOUND total. This
    matches the client's auto-prune rule so the source-of-truth row in
    the DB never exceeds the cap even if a client sends more.

    Why JSON-encode rather than passing the list directly: SQLAlchemy
    binds Python lists as PostgreSQL arrays by default, which fails
    against a JSONB column. Serialising to a JSON string + casting on
    the SQL side (::jsonb) is the cleanest fix and matches how the
    sqlmodel/asyncpg layer typically handles JSONB on inserts."""
    entries = list(payload.ai_history)
    if len(entries) > MAX_AI_HISTORY_PER_COMPOUND:
        # Sort starred entries first (preserve insertion order within
        # each group), keep the most recent N. Matches the client rule.
        starred = [e for e in entries if e.flag == "star"]
        unstarred = [e for e in entries if e.flag != "star"]
        keep_unstarred = MAX_AI_HISTORY_PER_COMPOUND - len(starred)
        if keep_unstarred < 0:
            # User has more starred entries than the cap — preserve all
            # starred (chemists' bookmarks shouldn't disappear silently)
            # and drop all unstarred. They'll see a fuller-than-cap list
            # but every entry is one they explicitly flagged.
            entries = starred
        else:
            # Keep most-recent unstarred (already in newest-first order
            # by client convention) plus all starred, then re-sort by ts
            # descending for stable display.
            entries = starred + unstarred[:keep_unstarred]

    # Convert Pydantic models to plain dicts before JSON-encoding so the
    # JSONB column gets a clean array of objects.
    serialised = json.dumps([e.model_dump() for e in entries])

    row = session.execute(
        text(
            "UPDATE public.user_compound"
            " SET ai_history = CAST(:hist AS jsonb), updated_at = NOW()"
            " WHERE id = :cid AND user_id = :uid"
            " RETURNING id, name, smiles, tags, ai_history, created_at, updated_at"
        ),
        {"cid": compound_id, "uid": user.id, "hist": serialised},
    ).mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="Compound not found")
    session.commit()
    return CompoundOut(**dict(row))


@router.delete("/{compound_id}", status_code=204)
def delete_my_compound(
    compound_id: int,
    user: Annotated[CurrentUser, Depends(current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> None:
    """Remove a saved compound. Scoped to the requesting user — even if
    a curl caller knows another user's compound id, the WHERE clause
    blocks it. Idempotent: deleting an already-gone row is a no-op
    (still returns 204)."""
    session.execute(
        text(
            "DELETE FROM public.user_compound"
            " WHERE id = :cid AND user_id = :uid"
        ),
        {"cid": compound_id, "uid": user.id},
    )
    session.commit()
    return None


# Re-export Optional so import-checkers don't strip it as unused.
_ = Optional
