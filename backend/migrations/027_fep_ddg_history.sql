-- 027_fep_ddg_history.sql
--
-- (W1) Live convergence chart. The pod's MBAR estimate of ΔΔG only
-- exists at the very END of an edge today; the "live ΔΔG" the UI showed
-- was decorative jitter. To plot a REAL convergence curve (the estimate
-- settling + its CI narrowing as sampling accumulates) we need a TIME
-- SERIES, not just the final scalar.
--
-- The pod-side reader (built after the first real edge gives us reporter
-- files to develop against) periodically opens the openfe multistate
-- .nc reporter mid-run, runs MBAR on the iterations sampled so far, and
-- reports {t, ddg, ci} points. The reconciler appends each new point to
-- this JSON array on every poll; the FEP study graph API serves it; the
-- frontend charts it.
--
-- Stored as TEXT holding a JSON array:
--   [{"t": 0.4, "ddg": -3.4, "ci": 1.9}, {"t": 0.8, "ddg": -1.6, "ci": 1.6}, ...]
-- where `t` is sampling accumulated (ns) or elapsed fraction, `ddg` is
-- the partial-MBAR binding ΔΔG (kcal/mol) and `ci` is the 95% CI
-- half-width. NULL/empty for old rows and edges that finished before the
-- pod reader shipped — the frontend degrades to "no live data" then.
-- Idempotent: ADD COLUMN IF NOT EXISTS.

ALTER TABLE public.fep_perturbation
    ADD COLUMN IF NOT EXISTS ddg_history_json TEXT;
