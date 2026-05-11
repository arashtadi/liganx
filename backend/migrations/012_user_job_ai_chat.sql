-- Migration 012: user_job_ai_chat — Liganx AI Beta conversation history
--
-- Why this exists: Liganx AI Beta (v1.13) ships an in-memory chat panel.
-- Reload the page and the conversation is gone. The user asked for
-- persistence: when they re-open a job from History, the prior Q&A
-- should hydrate the panel so they don't ask the same question twice.
--
-- Design rules (see ask_ai.py for the enforcement code):
--   1. Per-user, per-job scoping — the composite PK (user_id, job_share_id)
--      means a shared link doesn't leak the original owner's notes to
--      anyone else who opens the link.
--   2. Bounded growth — at most 20 messages (10 turns) per row, each AI
--      answer truncated to 500 chars at write time.
--   3. 30-day TTL — a nightly job (TBD) prunes rows older than 30 days.
--   4. JSONB array — schema-flexible (we can add 'pinned' or 'edited_at'
--      to individual messages later without an ALTER TABLE).
--
-- Message shape (validated server-side):
--   { "role": "user" | "assistant",
--     "text": str (<= 500 chars after truncation),
--     "model_id": str | null,
--     "ts": ISO8601 }
--
-- Idempotent — all statements use IF NOT EXISTS.

BEGIN;

CREATE TABLE IF NOT EXISTS user_job_ai_chat (
    user_id UUID NOT NULL,
    -- We key on share_id (the public token) rather than job.id so the
    -- relationship survives any future renumbering of the jobs table
    -- and so the cross-table reference doesn't require a real FK
    -- (the share_id lives on the Job row but isn't unique across all
    -- of Liganx — we treat the pair (user_id, share_id) as the key).
    job_share_id VARCHAR(32) NOT NULL,
    messages JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, job_share_id)
);

-- Pruning index — the TTL job will DELETE WHERE updated_at < now() - interval '30 days'.
CREATE INDEX IF NOT EXISTS ix_user_job_ai_chat_updated_at
    ON user_job_ai_chat(updated_at);

COMMIT;
