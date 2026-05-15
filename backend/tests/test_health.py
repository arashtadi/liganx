"""Smoke tests — confirms the app boots and basic routes respond.

Both tests here use `with TestClient(app)`, which runs the app lifespan
(startup migrations + orphan reaper) and therefore needs a live Postgres.
They are marked `requires_db` and excluded from the fast CI gate
(`pytest -m "not requires_db"`) — running them without a real DB would
either fail or, worse, connect to whatever DATABASE_URL is in the
environment. Run them against a throwaway Postgres service container.
"""

import pytest
from fastapi.testclient import TestClient

from deltadock.main import app

# Applies to every test in this module — see the module docstring.
pytestmark = pytest.mark.requires_db


def test_health_returns_ok():
    with TestClient(app) as client:
        r = client.get("/health")
        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "ok"
        assert "version" in body


def test_jobs_post_requires_auth():
    """Regression guard for the Batch-2 auth lockdown.

    Before 2026-05-15, POST /jobs was unauthenticated — anyone with the
    URL could create jobs. Batch 2 wired profile_complete_user into the
    route, so unauthenticated callers must now be rejected at the auth
    dependency before any DB write or background task runs.

    Sends a syntactically plausible payload with NO Authorization header
    and asserts the request is rejected. The most important guarantee
    here is that it never returns 201 — that's the regression we care
    about — and that the rejection is auth-shaped (401/403), not body
    validation.
    """
    payload = {
        "pdb_id": "1M17",
        "chain": "A",
        "uniprot_id": "P00533",
        "mutations": ["T790M"],
        "compounds": [{"name": "ethanol", "smiles": "CCO"}],
    }
    with TestClient(app) as client:
        r = client.post("/jobs", json=payload)
        # The critical regression guard: an unauthenticated POST must
        # never succeed. Anything else (401, 403, even 422) is fine; 201
        # would mean the auth lockdown silently broke.
        assert r.status_code != 201, (
            f"POST /jobs accepted an unauthenticated request — auth gate is gone. "
            f"Got {r.status_code}: {r.text[:200]}"
        )
        # And specifically: it should be the auth dep that rejected it.
        assert r.status_code in (401, 403), (
            f"expected 401/403 from auth, got {r.status_code}: {r.text[:200]}"
        )
