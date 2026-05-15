"""Regression guard: the test suite stays hermetically isolated from prod.

conftest.py overrides DATABASE_URL and the external-service env vars
before the app config loads. If that ever silently stops working — a
refactor, a pydantic-settings upgrade, someone deleting conftest.py —
these tests fail loudly, *before* a test run can write to the production
database or spend GPU time on the real pod.

Pure config reads, no connections — runs in the DB-free CI gate.
"""
from deltadock.config import get_settings


def test_database_is_not_production():
    url = get_settings().effective_database_url
    host = url.split("@")[-1] if "@" in url else url
    assert "pooler.supabase.com" not in url and ".supabase.co" not in url, (
        f"test run resolved a production-looking DATABASE_URL ({host}) — "
        "conftest.py isolation is not taking effect"
    )


def test_external_pods_are_disabled():
    s = get_settings()
    assert s.pod_dock_url == "", f"POD_DOCK_URL must be empty in tests, got {s.pod_dock_url!r}"
    assert not s.runpod_api_key, "RUNPOD_API_KEY must be empty in tests"
    assert not s.pod_dock_enabled, "pod docking must be disabled in tests"
