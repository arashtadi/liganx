-- 028_dock_cache.sql
-- Result cache for completed docking cells. A repeat dock of the SAME molecule
-- against the SAME conditions returns instantly from this table instead of
-- re-running the GPU on the pod.
--
-- "Same molecule" = identical canonical isomeric InChIKey. ANY structural change
-- to the ligand (an added atom, a changed bond, a flipped stereocenter) yields a
-- different InChIKey -> a different cache_key -> a cache MISS -> a fresh dock.
-- Only an untouched, identical compound ever hits the cache.
--
-- The cache_key additionally folds in pdb_id, chain, variant, engine,
-- engine_version, exhaustiveness, box geometry and prep_version, so a different
-- target/mutation/engine/box/prep can never collide with a stored result. Bump
-- prep_version or engine_version to invalidate en masse (the key changes, old
-- rows simply stop being hit).
--
-- Lives in the app DB only -- nothing is ever written to the RunPod pod. Access
-- is fail-open: the cache is a pure optimisation, gated by DOCK_CACHE_ENABLED,
-- and every read/write is wrapped so any error falls through to a normal dock.
--
-- Idempotent (CREATE ... IF NOT EXISTS); safe to run on every boot.

CREATE TABLE IF NOT EXISTS dock_cache (
    id              BIGSERIAL PRIMARY KEY,
    cache_key       TEXT NOT NULL,
    inchikey        TEXT NOT NULL,
    pdb_id          TEXT NOT NULL,
    chain           TEXT NOT NULL,
    variant         TEXT NOT NULL,
    engine          TEXT NOT NULL,
    engine_version  TEXT NOT NULL,
    exhaustiveness  INTEGER NOT NULL,
    prep_version    TEXT NOT NULL,
    best_score      DOUBLE PRECISION NOT NULL,
    pose_pdbqt      TEXT,
    extra           TEXT,
    hit_count       INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_hit_at     TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS ix_dock_cache_cache_key ON dock_cache (cache_key);
CREATE INDEX IF NOT EXISTS ix_dock_cache_inchikey ON dock_cache (inchikey);
