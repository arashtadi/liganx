-- Migration 010: optimize_attempt durable logging
--
-- Why this exists: 2026-05-04 — user asked "why did Optimize fail the
-- first 2 times on job 189 and only work the 3rd time?" The Fly free
-- log buffer keeps only ~15 minutes of logs, and Optimize attempts
-- aren't persisted anywhere — they fire /assist/optimize, return a
-- result or a 5xx, and that's it. By the time the user asks, the
-- evidence is gone.
--
-- This table records every /assist/optimize call (success or failure)
-- so future "why did Optimize fail" questions are a single SELECT.
-- Volume is bounded (rate-limited 30 calls/hr/IP and behind the
-- QUICK_DOCK_ENABLED flag), so growth is manageable without a
-- retention policy in v1. If the table ever exceeds ~100k rows
-- we'll add a 90-day TTL job.
--
-- Status taxonomy:
--   "ok"               — happy path, returned variants
--   "no_variants"      — 200 OK but the AI returned 0 valid variants
--                        (all rejected by SA, pod pre-flight, or self-
--                        prediction gate)
--   "anthropic_error"  — Anthropic API timeout / 5xx / auth fail
--   "pod_error"        — Vina-pod down or batch-dock failure
--   "timeout"          — request exceeded our internal budget (Cloudflare
--                        100s edge timeout is upstream of this — those
--                        attempts may not record at all)
--   "unknown_error"    — anything else; check error_message
--
-- We deliberately store SMILES (parent + variants attempted) inline so
-- diagnosing a regression doesn't require cross-referencing the
-- ai_history JSONB on user_compound. Storage cost is trivial.

BEGIN;

CREATE TABLE IF NOT EXISTS public.optimize_attempt (
    id              BIGSERIAL PRIMARY KEY,
    created_at      TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),

    -- Auth context. user_id is the Supabase auth.users.id (UUID).
    -- Nullable so anonymous fallbacks (if we ever drop auth) still log.
    user_id         UUID NULL,
    user_email      TEXT NULL,

    -- Request shape — what the user asked for.
    target_pdb      TEXT NULL,
    mutations       TEXT NULL,
    parent_smiles   TEXT NOT NULL,
    parent_score    DOUBLE PRECISION NULL,

    -- Outcome.
    status          TEXT NOT NULL,
    elapsed_ms      INTEGER NOT NULL,

    -- Variant counts (NULL when status != "ok" and the loop didn't
    -- get far enough to produce them). Diagnostic — lets us see
    -- "AI proposed 36, 5 survived SA, 3 docked, top 3 returned" at
    -- a glance.
    n_raw_variants       INTEGER NULL,
    n_unique_variants    INTEGER NULL,
    n_survivors_sa       INTEGER NULL,
    n_docked             INTEGER NULL,
    n_returned           INTEGER NULL,

    -- Failure context. Truncated to 2000 chars to bound row size when
    -- the upstream error has a giant traceback.
    error_message   TEXT NULL,

    -- For correlating with Fly logs / Telegram — the same UUID is
    -- written to a log line at the start of each attempt.
    request_id      UUID NULL
);

-- Most queries will be "show me recent attempts by this user" or
-- "show me recent failures". Index supports both via the leading
-- created_at and the user_id include.
CREATE INDEX IF NOT EXISTS optimize_attempt_created_at_idx
    ON public.optimize_attempt (created_at DESC);

CREATE INDEX IF NOT EXISTS optimize_attempt_user_id_idx
    ON public.optimize_attempt (user_id, created_at DESC);

-- Partial index on failures — admin "what's broken right now" view
-- always filters status != 'ok', so a partial index keeps it tight.
CREATE INDEX IF NOT EXISTS optimize_attempt_failures_idx
    ON public.optimize_attempt (created_at DESC)
    WHERE status != 'ok';

COMMIT;

-- Rollback (run manually if needed):
-- BEGIN;
--   DROP TABLE IF EXISTS public.optimize_attempt;
-- COMMIT;
