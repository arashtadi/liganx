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

from datetime import datetime
from typing import Annotated, Optional

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


class CompoundOut(BaseModel):
    id: int
    name: str
    smiles: str
    created_at: datetime
    updated_at: datetime


class CompoundUpsert(BaseModel):
    """Auto-save payload — both name and SMILES required because the
    frontend only fires this once both fields are non-empty. Trim and
    length-bound on the API side too so a curl caller can't smuggle
    in 100 MB of pasted SMILES."""
    name: str = Field(min_length=1, max_length=200)
    smiles: str = Field(min_length=1, max_length=2000)


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
            "SELECT id, name, smiles, created_at, updated_at"
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
    # timestamps without a follow-up GET.
    row = session.execute(
        text(
            "INSERT INTO public.user_compound (user_id, name, smiles)"
            " VALUES (:uid, :name, :smiles)"
            " ON CONFLICT (user_id, name) DO UPDATE SET"
            "   smiles = EXCLUDED.smiles,"
            "   updated_at = NOW()"
            " RETURNING id, name, smiles, created_at, updated_at"
        ),
        {"uid": user.id, "name": name, "smiles": smiles},
    ).mappings().first()
    session.commit()
    if row is None:  # defensive — shouldn't happen with RETURNING
        raise HTTPException(status_code=500, detail="upsert returned no row")
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
