-- 023_fep_dispatch_state.sql
--
-- (R1) Phase R of the FEP reconciler architecture rewrite. Adds the
-- explicit dispatch_state column + lifecycle timestamps that let the
-- new stateless reconciler (services/fep_reconciler.py) own edge
-- lifecycle without keeping any state in Python RAM.
--
-- See docs/fep_reconciler_design.md §2 (state machine) and §6 (scope).
--
-- WHAT THIS MIGRATION DOES:
--   1. Add dispatch_state TEXT — new column, NULL on existing rows.
--      Allowed values: queued | dispatching | running | aggregating
--                    | done | failed | cancelled
--      (We use TEXT not an ENUM type because ENUM types are painful
--      to alter later; CHECK constraint instead.)
--
--   2. Add dispatched_at TIMESTAMP — set the first time an edge
--      transitions to dispatching. Used for per-edge GPU spend
--      tracking (S1 budget cap, S3 telemetry).
--
--   3. Add last_polled_at TIMESTAMP — updated on every reconciler
--      tick that successfully polls the pod. Drives S2 stale-pod
--      detection.
--
--   4. Backfill dispatch_state from the legacy status column so
--      existing rows are immediately usable by the reconciler:
--        status='ok'      → dispatch_state='done'
--        status='running' → dispatch_state='running'
--        status='pending' → dispatch_state='queued'
--        status='failed'  → dispatch_state='failed'
--        status='skipped' → dispatch_state='cancelled'
--        any other        → leave NULL (reconciler treats NULL as
--                                       'unknown — needs manual triage')
--
--   5. Add a CHECK constraint that enforces the valid-states set.
--
-- WHAT THIS DOES NOT DO:
--   • DOES NOT touch the job table (docking). DOES NOT touch fep_job.
--     Strict scope: fep_perturbation only.
--   • DOES NOT drop or rename the legacy status column. That stays
--     in place during the shadow-mode phase (§7 of the design doc)
--     so the daemon-thread runner can keep working as a fallback.
--   • DOES NOT add the idempotency client_token column yet — that
--     lives on the pod side, not in our DB (see Q2).
--
-- IDEMPOTENT: every clause uses IF NOT EXISTS or its equivalent.
-- Re-running this migration on a partially-applied DB is a no-op.

-- ── 1. Add columns ────────────────────────────────────────────────
ALTER TABLE public.fep_perturbation
    ADD COLUMN IF NOT EXISTS dispatch_state TEXT,
    ADD COLUMN IF NOT EXISTS dispatched_at  TIMESTAMP,
    ADD COLUMN IF NOT EXISTS last_polled_at TIMESTAMP;

-- ── 2. Backfill from legacy status column ─────────────────────────
UPDATE public.fep_perturbation
   SET dispatch_state = CASE status
       WHEN 'ok'      THEN 'done'
       WHEN 'running' THEN 'running'
       WHEN 'pending' THEN 'queued'
       WHEN 'failed'  THEN 'failed'
       WHEN 'skipped' THEN 'cancelled'
       ELSE NULL
   END
 WHERE dispatch_state IS NULL;

-- ── 3. Add CHECK constraint (idempotent via DROP IF EXISTS) ───────
-- Postgres CHECK constraints don't have ADD ... IF NOT EXISTS syntax
-- yet, and the old DO $$ ... END $$; pattern is fragile because our
-- migration splitter strips bare 'BEGIN' lines as transaction wrappers
-- (mistakes the PL/pgSQL keyword for the SQL-level BEGIN). Simpler
-- and more portable: drop-then-add. The DROP is a no-op the first
-- time and idempotent on re-runs.
ALTER TABLE public.fep_perturbation
    DROP CONSTRAINT IF EXISTS fep_perturbation_dispatch_state_check;

ALTER TABLE public.fep_perturbation
    ADD CONSTRAINT fep_perturbation_dispatch_state_check
    CHECK (dispatch_state IS NULL OR dispatch_state IN (
        'queued',
        'dispatching',
        'running',
        'aggregating',
        'done',
        'failed',
        'cancelled'
    ));

-- ── 4. Indexes the reconciler will hit hard ───────────────────────
-- The reconciler's hot query is:
--     SELECT * FROM fep_perturbation
--     WHERE dispatch_state IN ('dispatching', 'running')
--       AND last_polled_at < now() - interval '60 seconds'
--     FOR UPDATE SKIP LOCKED
-- A composite index keeps this O(log N) instead of full scan.
CREATE INDEX IF NOT EXISTS idx_fep_perturbation_reconciler
    ON public.fep_perturbation (dispatch_state, last_polled_at)
    WHERE dispatch_state IN ('dispatching', 'running', 'queued');
