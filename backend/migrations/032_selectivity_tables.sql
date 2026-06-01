-- 032_selectivity_tables.sql
--
-- Mutant-Selective Binder Discovery — the standalone /selective feature
-- (see docs/mutant_selective_pipeline.md). Creates the single parent table
-- `selectivity_job`. One row = one run of the pipeline: given a target + a
-- mutation, rank binders that prefer the MUTANT pocket over wild-type.
--
-- ISOLATION: this table shares nothing with the docking `job` schema or any
-- Studio code path. The pipeline reuses existing primitives (FoldX/PDBFixer
-- mutant build, /relax_ensemble, fep_runner) by CALLING them from
-- services/selective_runner.py — it does not alter their tables. Adding or
-- dropping this table cannot affect docking, screening, FEP, or Studio.
--
-- Note on create_all: init_db() runs SQLModel.create_all() on boot BEFORE
-- this migration, so in practice the table is usually built from the
-- SelectivityJob model first and this CREATE is the idempotent belt-and-
-- braces (and the canonical record of intent for the schema audit). Types
-- here are kept dialect-portable to match the model exactly — no JSONB/UUID,
-- JSON payloads live in TEXT columns.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS. Safe to
-- run on every boot.

CREATE TABLE IF NOT EXISTS public.selectivity_job (
    id                 SERIAL PRIMARY KEY,
    share_id           VARCHAR(32) NOT NULL UNIQUE,
    created_at         TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMP NOT NULL DEFAULT NOW(),
    -- Owner uuid stored as text (portable; API scopes in Python).
    user_id            VARCHAR(64) NULL,
    seq_number         INTEGER NOT NULL DEFAULT 0,

    -- Target
    uniprot_id         VARCHAR(20) NULL,
    pdb_id             VARCHAR(8)  NOT NULL,
    chain              VARCHAR(4)  NOT NULL DEFAULT 'A',
    mutation           VARCHAR(120) NOT NULL DEFAULT '',
    structure_source   VARCHAR(32) NOT NULL DEFAULT 'mutate_relax',

    -- Step A: triage
    localization       VARCHAR(32)  NULL,
    allowed_modalities VARCHAR(120) NULL,
    modality           VARCHAR(32)  NOT NULL DEFAULT 'small_molecule',

    -- Step C: ensemble
    ensemble_size      INTEGER NOT NULL DEFAULT 1,

    -- Step D
    candidate_source   VARCHAR(120) NULL,
    -- Candidate molecules to screen: TEXT-encoded JSON [{"name","smiles"}, ...].
    candidates_json    TEXT NULL,
    -- D.2 FEP escalation ships OFF: FEP has never completed a full cycle.
    fep_escalation     BOOLEAN NOT NULL DEFAULT FALSE,
    fep_top_n          INTEGER NOT NULL DEFAULT 5,

    -- TEXT-encoded JSON payloads
    triage_json        TEXT NULL,
    pocket_diff_json   TEXT NULL,
    ranked_hits_json   TEXT NULL,

    -- State machine
    status             VARCHAR(32)  NOT NULL DEFAULT 'pending',
    stage              VARCHAR(120) NULL,
    error_message      TEXT NULL,
    title              VARCHAR(240) NULL
);

-- Indexes mirroring the model's index=True columns.
CREATE INDEX IF NOT EXISTS ix_selectivity_job_share_id  ON public.selectivity_job (share_id);
CREATE INDEX IF NOT EXISTS ix_selectivity_job_user_id   ON public.selectivity_job (user_id);
CREATE INDEX IF NOT EXISTS ix_selectivity_job_created_at ON public.selectivity_job (created_at);
CREATE INDEX IF NOT EXISTS ix_selectivity_job_uniprot_id ON public.selectivity_job (uniprot_id);
CREATE INDEX IF NOT EXISTS ix_selectivity_job_pdb_id     ON public.selectivity_job (pdb_id);
CREATE INDEX IF NOT EXISTS ix_selectivity_job_status     ON public.selectivity_job (status);
CREATE INDEX IF NOT EXISTS ix_selectivity_job_seq_number ON public.selectivity_job (seq_number);

-- Belt-and-braces: if an earlier create_all() built the table before
-- candidates_json existed, add it. No-op once present.
ALTER TABLE public.selectivity_job ADD COLUMN IF NOT EXISTS candidates_json TEXT NULL;
