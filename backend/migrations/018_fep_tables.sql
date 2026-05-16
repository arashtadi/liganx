-- 018_fep_tables.sql
--
-- FEP+ study tables. See docs/fep_plus_design.md §7 for the data
-- model rationale; this migration creates exactly the three tables
-- specified there: fep_job (parent study), fep_node (one ligand in
-- the perturbation graph), fep_perturbation (one A→B alchemical
-- transformation edge).
--
-- Why three tables and not one JSON blob:
--   • Per-edge status needs to be queryable (the runner dispatches
--     edges sequentially and the UI polls their state).
--   • Per-node aggregate ΔΔG-to-hit needs an index for the ranked-
--     analog-table view.
--   • Cycle-closure analysis joins edges into cycles via a graph
--     traversal in Python; the relational shape supports that
--     directly while a JSON blob would force a re-parse per query.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS. Safe to run on every boot.
-- FOREIGN KEYs are intentionally NOT cascading on delete: a deleted
-- FepJob shouldn't auto-cascade through every perturbation, because
-- the pod-side trajectory files (when implemented) need explicit
-- cleanup. Use the future /fep/studies/{id}/cancel endpoint.

CREATE TABLE IF NOT EXISTS public.fep_job (
    id              SERIAL PRIMARY KEY,
    share_id        VARCHAR(64) NOT NULL UNIQUE,
    created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    user_id         UUID NULL,                -- nullable for legacy alignment
    -- Target identity, mirroring the docking Job model.
    pdb_id          VARCHAR(8)  NOT NULL,
    chain           VARCHAR(4)  NOT NULL DEFAULT 'A',
    variant         VARCHAR(120) NOT NULL DEFAULT 'WT',
    -- Optional FK to the parent docking job that produced the hit
    -- pose. Null when the user supplies a pose directly.
    parent_job_id   INTEGER NULL REFERENCES public.job(id) ON DELETE SET NULL,
    -- The hit compound — graph centre. FK to the existing Compound
    -- table; no duplication of SMILES/name.
    hit_compound_id INTEGER NOT NULL REFERENCES public.compound(id),
    -- Free-energy protocol knobs (defaults match design doc §4 with
    -- the post-audit tightening: 2 ns equilibration counted in the
    -- ns_per_window total of 7 ns; production = 5 ns).
    n_lambda_windows INTEGER NOT NULL DEFAULT 12,
    ns_per_window    REAL    NOT NULL DEFAULT 7.0,    -- 2 equil + 5 prod
    forcefield_protein VARCHAR(64)  NOT NULL DEFAULT 'amber14sb',
    forcefield_ligand  VARCHAR(64)  NOT NULL DEFAULT 'openff-2.2.0',
    water_model        VARCHAR(64)  NOT NULL DEFAULT 'tip3p',
    hrex               BOOLEAN      NOT NULL DEFAULT TRUE,
    network_topology   VARCHAR(64)  NOT NULL DEFAULT 'radial_plus_mst',
    -- Aggregate state machine.
    status          VARCHAR(32)  NOT NULL DEFAULT 'pending',
    stage           VARCHAR(120) NULL,
    error_message   TEXT         NULL,
    -- Cycle-closure RMSD across the perturbation graph — populated
    -- when status=completed. <0.5 healthy, 0.5-1.0 warn, >1.0 the
    -- force field is misbehaving on this chemotype.
    cycle_closure_rmsd REAL NULL,
    title           VARCHAR(240) NULL,
    -- Tags as TEXT[] for psql-array querying; FastAPI returns it as
    -- a list[str].
    tags            TEXT[] NOT NULL DEFAULT '{}'::TEXT[]
);

CREATE INDEX IF NOT EXISTS idx_fep_job_user        ON public.fep_job (user_id);
CREATE INDEX IF NOT EXISTS idx_fep_job_share       ON public.fep_job (share_id);
CREATE INDEX IF NOT EXISTS idx_fep_job_pdb_variant ON public.fep_job (pdb_id, variant);
CREATE INDEX IF NOT EXISTS idx_fep_job_status      ON public.fep_job (status);

-- One ligand in the perturbation graph (either the hit or one of
-- the analogs).
CREATE TABLE IF NOT EXISTS public.fep_node (
    id            SERIAL PRIMARY KEY,
    fep_job_id    INTEGER NOT NULL REFERENCES public.fep_job(id) ON DELETE CASCADE,
    compound_id   INTEGER NOT NULL REFERENCES public.compound(id),
    is_hit        BOOLEAN NOT NULL DEFAULT FALSE,
    -- Aggregate result, populated after all edges into this node converge.
    ddg_to_hit_kcal_mol      REAL NULL,
    ddg_to_hit_uncertainty   REAL NULL,
    convergence_flag         VARCHAR(32) NULL,        -- ok | high_uncertainty | not_converged
    starting_pose_uri        VARCHAR(512) NULL
);

CREATE INDEX IF NOT EXISTS idx_fep_node_job      ON public.fep_node (fep_job_id);
CREATE INDEX IF NOT EXISTS idx_fep_node_compound ON public.fep_node (compound_id);

-- One alchemical edge: ligand A → ligand B.
CREATE TABLE IF NOT EXISTS public.fep_perturbation (
    id            SERIAL PRIMARY KEY,
    fep_job_id    INTEGER NOT NULL REFERENCES public.fep_job(id) ON DELETE CASCADE,
    node_a_id     INTEGER NOT NULL REFERENCES public.fep_node(id),
    node_b_id     INTEGER NOT NULL REFERENCES public.fep_node(id),
    lomap_score   REAL NOT NULL,
    -- Per-edge ΔΔG results.
    ddg_complex_kcal_mol   REAL NULL,
    ddg_solvent_kcal_mol   REAL NULL,
    ddg_binding_kcal_mol   REAL NULL,         -- difference = ΔΔG_binding
    ddg_uncertainty        REAL NULL,
    hysteresis_kcal_mol    REAL NULL,         -- |fwd − rev|
    status                 VARCHAR(32) NOT NULL DEFAULT 'pending',
    -- JSON blob of MBAR diagnostics — overlap matrix, decorrelation
    -- times, per-replica free energies. Frontend renders this as a
    -- collapsible "diagnostics" panel for power users.
    mbar_diagnostics_json  TEXT NULL,
    started_at             TIMESTAMP NULL,
    completed_at           TIMESTAMP NULL,
    -- Last 4 KB of pod stdout/stderr for the edge — useful for
    -- debugging convergence failures.
    pod_log_tail           TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_fep_perturbation_job    ON public.fep_perturbation (fep_job_id);
CREATE INDEX IF NOT EXISTS idx_fep_perturbation_status ON public.fep_perturbation (status);
