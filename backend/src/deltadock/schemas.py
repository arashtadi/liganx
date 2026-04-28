"""Pydantic schemas for the public API. Kept separate from DB models."""

import re
from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from .models import JobStatus


# Standard 4-char RCSB PDB ID (e.g. "2RGP") OR a user-uploaded structure
# tagged "USR_xxxxxxxx" (8 hex chars from POST /upload/pdb). Both forms get
# stored as the job's pdb_id in the DB; the runner branches on the prefix to
# decide whether to fetch from RCSB or read the upload from disk.
PDB_ID_RE = re.compile(r"^([A-Za-z0-9]{4}|USR_[0-9a-f]{8})$")
# Mutations: T790M, L858R, G12C, T790M+C797S, E746_A750del, V559insT
MUTATION_RE = re.compile(r"^[A-Z][0-9]+[A-Z]([+_][A-Za-z0-9]+)*(del|ins[A-Z]+)?$")
# Chain ID: usually a single letter, sometimes two.
CHAIN_RE = re.compile(r"^[A-Za-z0-9]{1,2}$")


class CompoundIn(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    smiles: str = Field(..., min_length=1, max_length=2000)


class JobCreate(BaseModel):
    pdb_id: str = Field(..., min_length=4, max_length=12)
    chain: str = "A"
    uniprot_id: str | None = Field(default=None, max_length=20)
    # Empty list = WT only. Otherwise list of mutations like ["T790M", "L858R"]
    mutations: list[str] = Field(default_factory=list, max_length=20)
    compounds: list[CompoundIn] = Field(..., min_length=1, max_length=100)
    # Search depth — Vina-style: 8 fast / 16 balanced / 32 thorough. We cap at
    # 64 because anything higher gives diminishing returns and risks tying up
    # the GPU. Anything below 4 is useless.
    exhaustiveness: int = Field(default=8, ge=4, le=64)
    # Whether to also dock against wild-type. Default True (most users want a
    # baseline for Δ); set False to skip WT and just dock the listed mutants.
    include_wt: bool = True

    # Server-side validators mirror the frontend regex. Catches anyone
    # bypassing the form (curl, postman, malicious actors), and keeps the
    # filesystem paths we build from these values constrained to a known shape.
    @field_validator("pdb_id")
    @classmethod
    def _v_pdb(cls, v: str) -> str:
        if not PDB_ID_RE.match(v):
            raise ValueError("pdb_id must be 4 alphanumeric chars or USR_<8 hex>")
        # User-uploaded IDs carry a "USR_" prefix (case-significant) — only
        # standard RCSB IDs get upper-cased to match RCSB's canonical casing.
        return v if v.startswith("USR_") else v.upper()

    @field_validator("chain")
    @classmethod
    def _v_chain(cls, v: str) -> str:
        if not CHAIN_RE.match(v):
            raise ValueError("chain must be 1-2 alphanumeric characters")
        return v.upper()

    @field_validator("mutations")
    @classmethod
    def _v_mutations(cls, v: list[str]) -> list[str]:
        bad = [m for m in v if not MUTATION_RE.match(m)]
        if bad:
            raise ValueError(f"invalid mutation code(s): {', '.join(bad[:3])}")
        return v


class CompoundOut(BaseModel):
    id: int
    name: str | None
    smiles: str


class DockingResultOut(BaseModel):
    compound_id: int
    variant: str
    best_score: float
    pose_uri: str | None = None
    extra: str | None = None


class JobOut(BaseModel):
    id: int
    # share_id is what the frontend uses in URLs — unguessable, URL-safe.
    # Integer `id` is kept for back-compat with the few existing direct links
    # but new jobs are addressed by share_id everywhere user-facing.
    share_id: str
    pdb_id: str
    chain: str
    uniprot_id: str | None
    mutations: list[str]
    status: JobStatus
    error_message: str | None
    created_at: datetime
    updated_at: datetime
    # Echo the docking knobs so the UI can label the matrix accurately
    # ("ran with Thorough exhaustiveness", "WT skipped"). Defaults match the
    # legacy behaviour for jobs created before these fields existed.
    exhaustiveness: int = 8
    include_wt: bool = True
    compounds: list[CompoundOut] = Field(default_factory=list)
    results: list[DockingResultOut] = Field(default_factory=list)


class HealthOut(BaseModel):
    status: str = "ok"
    version: str
    env: str
