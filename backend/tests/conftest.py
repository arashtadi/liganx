"""pytest bootstrap — guarantees the test suite can never touch production.

backend/.env holds the PRODUCTION DATABASE_URL, and pytest runs with
backend/ as the working directory, so pydantic-settings auto-loads that
.env. Without this file, a plain `pytest` connects to the prod Supabase
database and can reach the prod GPU pod — running the orphan reaper,
attempting inserts, spending GPU time. That actually happened on
2026-05-15 while wiring up CI.

conftest.py is imported by pytest BEFORE any test module — and therefore
before anything imports the app and instantiates Settings(). pydantic-
settings gives real environment variables precedence over the .env file,
so setting os.environ here overrides whatever .env says. The result is a
hermetic config for every test run, regardless of what's in .env.

To run the `requires_db` tests against a real throwaway Postgres, set
TEST_DATABASE_URL (CI does this via a service container; locally you can
point it at a local Postgres).
"""
import os

# --- database: never the prod DB --------------------------------------
# Unconditionally override DATABASE_URL. The DB-free tests never connect;
# the requires_db tests (test_health.py) need a real Postgres here, which
# CI supplies via TEST_DATABASE_URL + a service container.
os.environ["DATABASE_URL"] = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+psycopg2://test:test@localhost:5432/liganx_test",
)

# --- external services: never the real ones --------------------------
os.environ["POD_DOCK_URL"] = ""        # no GPU-pod docking calls
os.environ["BOLTZ2_POD_URL"] = ""
os.environ["POD_GPU_URL"] = ""
os.environ["RUNPOD_API_KEY"] = ""      # no RunPod control-plane calls
os.environ["RUNPOD_ENDPOINT_ID"] = ""

# --- config validation -----------------------------------------------
os.environ.setdefault("APP_SECRET", "test-secret-not-real")

# --- belt-and-suspenders ---------------------------------------------
# Hard-fail loudly if the prod DB host ever ends up in a test run (e.g.
# someone points TEST_DATABASE_URL at prod by mistake). Better a crashed
# test run than a silent write to production.
_db = os.environ["DATABASE_URL"]
assert "pooler.supabase.com" not in _db and ".supabase.co" not in _db, (
    "Refusing to run tests: DATABASE_URL points at a production-looking "
    f"Supabase host ({_db.split('@')[-1] if '@' in _db else _db})."
)
