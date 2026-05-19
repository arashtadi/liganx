-- 026_jobstatus_lowercase_rows.sql
--
-- (U18 part 2) Convert every existing job.status row from the legacy
-- uppercase enum value ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED')
-- to the lowercase form that matches Python `JobStatus.<member>.value`.
-- Pairs with migration 025 which added the lowercase values to the
-- jobstatus enum type.
--
-- After this migration plus the model's `values_callable` mapping
-- (added in the same release), SQLAlchemy reads/writes lowercase and
-- LookupError on cancelled rows is impossible.
--
-- IDEMPOTENT: each UPDATE filters on the uppercase value, so
-- re-running on an already-migrated row is a no-op.
-- SAFE: status is the only column touched. mutations, results, and
-- every other column are untouched.

UPDATE job SET status = 'pending'::jobstatus
 WHERE status::text = 'PENDING';

UPDATE job SET status = 'running'::jobstatus
 WHERE status::text = 'RUNNING';

UPDATE job SET status = 'completed'::jobstatus
 WHERE status::text = 'COMPLETED';

UPDATE job SET status = 'failed'::jobstatus
 WHERE status::text = 'FAILED';

-- 'CANCELLED' uppercase rows aren't expected (the cancel path always
-- wrote lowercase via raw SQL post-U11), but lowercase the column
-- defensively in case any tooling wrote uppercase historically.
UPDATE job SET status = 'cancelled'::jobstatus
 WHERE status::text = 'CANCELLED';
