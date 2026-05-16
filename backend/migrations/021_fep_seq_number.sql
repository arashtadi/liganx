-- 021_fep_seq_number.sql
--
-- (J14) Per-user sequential job numbers for FEP studies so the UI
-- can render 'FEP #42' instead of just the random share_id. Same
-- pattern as Job.seq_number for docking — the share_id stays the
-- canonical URL slug, but a human-friendly number is what users
-- recognise when comparing rows on the History page.
--
-- Why per-user (and not global): a global sequence would leak the
-- platform's submission rate to every user. Per-user means each
-- account's FEP #1, #2, #3 are theirs alone; not surprising or
-- privacy-leaky.
--
-- Why NOT NULL with default 0: existing rows from before this
-- migration get 0, which the UI renders as no-number. New rows
-- compute MAX(seq_number)+1 per-user at insert time in the
-- application layer (router code, not a DB trigger — keeps the
-- write path simple and trace-able).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.

ALTER TABLE public.fep_job
    ADD COLUMN IF NOT EXISTS seq_number INTEGER NOT NULL DEFAULT 0;

-- Backfill existing rows with row_number() per user, ordered by
-- creation time. Idempotent: only runs on rows where seq_number=0
-- (the DEFAULT value), so re-running the migration won't reshuffle
-- numbers that were already assigned via the app layer.
WITH numbered AS (
    SELECT
        id,
        user_id,
        ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at, id) AS rn
    FROM public.fep_job
    WHERE seq_number = 0
)
UPDATE public.fep_job AS f
SET seq_number = n.rn
FROM numbered AS n
WHERE f.id = n.id;

CREATE INDEX IF NOT EXISTS idx_fep_job_user_seq
    ON public.fep_job (user_id, seq_number);
