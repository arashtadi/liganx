"""Database models for jobs, compounds, and results."""

import secrets
from datetime import datetime
from enum import Enum
from typing import Optional

from sqlalchemy import Column, String
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlmodel import Field, Relationship, SQLModel


class JobStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    # User-initiated cancellation. The runner cooperatively checks this
    # between cells and bails when set. The currently in-flight Pod GPU
    # call (~3 s) completes; no further cells dispatch.
    CANCELLED = "cancelled"


def _new_share_id() -> str:
    """Random URL-safe token used as the public job ID.

    11 characters from the base64url alphabet (a-zA-Z0-9_-) — about 65 bits of
    entropy, enough that guessing is computationally infeasible. Short enough
    that links stay copy-pasteable (`/jobs/VXrA3kF9zY1`).
    """
    return secrets.token_urlsafe(8)


class Job(SQLModel, table=True):
    """A docking job: dock a list of compounds against WT and a set of mutants."""

    id: Optional[int] = Field(default=None, primary_key=True)
    # share_id is the PUBLIC, unguessable identifier for a job — used in every
    # /jobs/{...} URL the frontend or share links exposes. The integer `id`
    # stays for internal foreign-key relationships (Compound.job_id, etc.) so
    # we don't have to reshape the relational graph. Existing integer URLs
    # still resolve via a backward-compat lookup in routers/jobs.py.
    share_id: str = Field(
        default_factory=_new_share_id,
        index=True,
        unique=True,
        max_length=32,
    )
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    # Target
    uniprot_id: Optional[str] = Field(default=None, index=True)
    pdb_id: str = Field(index=True)
    chain: str = "A"

    # Mutations: comma-separated list of e.g. "T790M,L858R" — empty = WT only
    mutations: str = ""

    # Search depth for the docking engine. Vina-style "exhaustiveness" maps
    # roughly to: 8 = fast (~3 s/cell GPU), 16 = balanced, 32 = thorough.
    # Higher = more reliable convergence on the global minimum at the cost of
    # GPU time. Default 8 matches Vina's default and is good enough for most
    # screening; bump to 16 or 32 when pose quality matters.
    exhaustiveness: int = Field(default=8)

    # Whether to dock against wild-type as well. Default True — users almost
    # always want a WT baseline to compute Δ. Set False when the user only
    # cares about absolute mutant binding.
    include_wt: bool = Field(default=True)

    # Which docking engine to use for this job. Free-form string keeps the
    # column forward-compatible with engines we haven't shipped yet
    # (autodock_gpu, vanilla vina, etc.). Current values:
    #   "quickvina2_gpu"  — DEFAULT. Pod-hosted Vina derivative on NVIDIA GPU.
    #                       Best balance of speed + Vina-family compatibility.
    #   "gnina"           — Vina fork with CNN-based pose rescoring (Koes lab,
    #                       trained on PDBbind). Slower per cell (~2-3x) but
    #                       genuinely different ranking signal. Behind the
    #                       GNINA_ENABLED Fly secret until the Pod-side
    #                       /dock_gnina endpoint is installed.
    # The runner reads this field to dispatch to the right Pod endpoint;
    # falling through to the QuickVina engine is the safe default if the
    # value is unknown. NULL on legacy rows ⇒ treated as quickvina2_gpu.
    engine: Optional[str] = Field(default="quickvina2_gpu", index=True)

    # Status
    status: JobStatus = Field(default=JobStatus.PENDING, index=True)
    error_message: Optional[str] = None

    # Owner — UUID referencing auth.users(id) in Supabase. Nullable so legacy
    # rows survive an account deletion (FK is ON DELETE SET NULL). The runner
    # never reads this field; it's used by the API layer to scope GET /jobs
    # (list) to the requesting user and to authorize POST /jobs/{key}/cancel.
    # Public share-link GETs intentionally don't filter on user_id.
    user_id: Optional[str] = Field(
        default=None,
        sa_column=Column(UUID(as_uuid=False), index=True, nullable=True),
    )

    # Optional human title — "EGFR resistance scan", "ABL kinome panel". Used
    # in the History page for search + display. Null = render the auto title
    # ("EGFR · 4 compounds · T790M+C797S").
    title: Optional[str] = None

    # Free-form tags for grouping in History — ["egfr-project", "draft"].
    # Stored as Postgres TEXT[] so we can index/filter efficiently if it
    # becomes a power-user feature.
    tags: list[str] = Field(
        default_factory=list,
        sa_column=Column(ARRAY(String()), nullable=False, server_default="{}"),
    )

    compounds: list["Compound"] = Relationship(back_populates="job")
    results: list["DockingResult"] = Relationship(back_populates="job")


class Compound(SQLModel, table=True):
    """One ligand to dock — provided as SMILES, optionally with a friendly name."""

    id: Optional[int] = Field(default=None, primary_key=True)
    job_id: int = Field(foreign_key="job.id", index=True)

    name: Optional[str] = None
    smiles: str

    job: Optional[Job] = Relationship(back_populates="compounds")


class DockingResult(SQLModel, table=True):
    """One docking score: (job, compound, variant) → score in kcal/mol."""

    id: Optional[int] = Field(default=None, primary_key=True)
    job_id: int = Field(foreign_key="job.id", index=True)
    compound_id: int = Field(foreign_key="compound.id", index=True)

    # "WT" or a mutation string like "T790M"
    variant: str = Field(index=True)

    # Best Vina score across poses, kcal/mol (lower = stronger binding)
    best_score: float

    # Path/key into object storage for the pose file (PDBQT). Null in Phase 1 if local.
    pose_uri: Optional[str] = None

    # Free-form metadata: rmsd, num_poses, engine version, etc.
    extra: Optional[str] = None

    created_at: datetime = Field(default_factory=datetime.utcnow)

    job: Optional[Job] = Relationship(back_populates="results")
