-- 038_resistance_scans.sql
--
-- Resistance Radar — shareable, durable scan records. One row = one scan of a
-- compound across a target's variant panel (per-variant Δ-docking + calibrated
-- resistance probability). Public GET by share_id makes a scan shareable; the
-- per-variant table is stored as one TEXT-encoded JSON payload (rows_json).
--
-- ISOLATION: shares nothing with the docking `job` schema. The scan references
-- its underlying dock jobs only by their share_id inside the JSON payload.
-- Adding or dropping this table cannot affect docking, screening, FEP, Studio,
-- or the selectivity feature.
--
-- Note on create_all: init_db() runs SQLModel.create_all() on boot BEFORE this
-- migration, so in practice the table is usually built from the ResistanceScan
-- model first; this CREATE is the idempotent belt-and-braces + schema-audit
-- record. Types kept dialect-portable (JSON payload in a TEXT column).
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS public.resistance_scan (
    id            SERIAL PRIMARY KEY,
    share_id      VARCHAR(32) NOT NULL UNIQUE,
    created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMP NOT NULL DEFAULT NOW(),
    -- Owner uuid stored as text (portable; API scopes in Python).
    user_id       VARCHAR(64) NULL,

    -- Target + compound
    target_id     VARCHAR(64)  NOT NULL DEFAULT '',
    target_label  VARCHAR(240) NOT NULL DEFAULT '',
    gene          VARCHAR(32)  NOT NULL DEFAULT '',
    pdb_id        VARCHAR(8)   NOT NULL DEFAULT '',
    chain         VARCHAR(4)   NOT NULL DEFAULT 'A',
    uniprot_id    VARCHAR(20)  NULL,
    compound_name VARCHAR(240) NOT NULL DEFAULT '',
    smiles        VARCHAR(2000) NOT NULL DEFAULT '',

    -- State: 'running' | 'done'
    status        VARCHAR(16)  NOT NULL DEFAULT 'running',

    -- Payload: per-variant rows as TEXT-encoded JSON.
    rows_json     TEXT NULL,
    wt_score      DOUBLE PRECISION NULL,
    title         VARCHAR(240) NULL
);

CREATE INDEX IF NOT EXISTS ix_resistance_scan_share_id   ON public.resistance_scan (share_id);
CREATE INDEX IF NOT EXISTS ix_resistance_scan_user_id    ON public.resistance_scan (user_id);
CREATE INDEX IF NOT EXISTS ix_resistance_scan_created_at ON public.resistance_scan (created_at);
