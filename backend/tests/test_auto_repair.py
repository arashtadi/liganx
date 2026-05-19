"""(U23) Tests for the Sentry → auto-repair dispatcher.

These are pure-Python tests with no DB dependency — we patch the
repair callables so we can verify the *dispatch logic* (cooldown, kill
switch, fingerprint matching) without exercising the real reapers.
The real reapers have their own tests in tests/test_fep_reaper_*.py.
"""
from __future__ import annotations

import os
from unittest.mock import patch

import pytest

from deltadock.services import auto_repair


@pytest.fixture(autouse=True)
def _clean_state():
    """Each test starts with an empty cooldown table and the kill
    switch in a known state."""
    auto_repair._reset_cooldown_for_tests()
    yield
    auto_repair._reset_cooldown_for_tests()


# ─── Kill switch ─────────────────────────────────────────────────────────

def test_disabled_is_dry_run_when_title_matches():
    """If SENTRY_AUTO_REPAIR_ENABLED isn't set but the title DOES match
    a dispatch entry, we report a dry-run would-fire (so the operator
    sees it in Telegram) but run NO repair."""
    fake_calls = []

    def fake_repair():
        fake_calls.append(1)
        return "should not run"

    with patch.dict(os.environ, {}, clear=False):
        os.environ.pop("SENTRY_AUTO_REPAIR_ENABLED", None)
        with patch.object(auto_repair, "_DISPATCH", [("fake_fp", "needle", fake_repair)]):
            result = auto_repair.auto_repair_for("alert with NEEDLE in it")
    assert result == {"fingerprint": "fake_fp", "outcome": "dry_run_would_fire"}
    # Critically: the repair did NOT execute in dry-run mode.
    assert fake_calls == []


def test_disabled_with_no_match_returns_none():
    """Kill switch off + title matches nothing → None (stay silent),
    same as the enabled no-match case."""
    with patch.dict(os.environ, {}, clear=False):
        os.environ.pop("SENTRY_AUTO_REPAIR_ENABLED", None)
        with patch.object(auto_repair, "_DISPATCH", [("fp", "needle", lambda: "x")]):
            assert auto_repair.auto_repair_for("unrelated alert") is None


def test_enabled_fires_repair():
    """With the kill switch on, a matching title runs the registered
    callable and reports the outcome string."""
    fake_calls = []

    def fake_repair():
        fake_calls.append(1)
        return "fake reaped 7"

    with patch.dict(os.environ, {"SENTRY_AUTO_REPAIR_ENABLED": "1"}):
        with patch.object(
            auto_repair,
            "_DISPATCH",
            [("fake_fp", "needle", fake_repair)],
        ):
            result = auto_repair.auto_repair_for(
                "something something NEEDLE something"
            )

    assert result == {"fingerprint": "fake_fp", "outcome": "fake reaped 7"}
    assert fake_calls == [1]


def test_no_match_returns_none():
    """A title that doesn't match any dispatch entry returns None — so
    the webhook handler can stay silent (no Telegram spam for
    non-repairable alerts)."""
    with patch.dict(os.environ, {"SENTRY_AUTO_REPAIR_ENABLED": "1"}):
        with patch.object(auto_repair, "_DISPATCH", [("fp", "needle", lambda: "x")]):
            assert auto_repair.auto_repair_for("totally unrelated alert") is None


# ─── Cooldown ────────────────────────────────────────────────────────────

def test_cooldown_kicks_in_after_max_fires():
    """First _MAX_FIRES_PER_WINDOW calls run the repair; the next one
    is skipped with 'cooldown_skip' instead."""
    fire_count = [0]

    def counter():
        fire_count[0] += 1
        return f"ran #{fire_count[0]}"

    with patch.dict(os.environ, {"SENTRY_AUTO_REPAIR_ENABLED": "1"}):
        with patch.object(auto_repair, "_DISPATCH", [("fp", "x", counter)]):
            for _ in range(auto_repair._MAX_FIRES_PER_WINDOW):
                r = auto_repair.auto_repair_for("trigger x")
                assert r["outcome"].startswith("ran ")

            blocked = auto_repair.auto_repair_for("trigger x")
            assert blocked == {"fingerprint": "fp", "outcome": "cooldown_skip"}
            # Repair function NOT called again.
            assert fire_count[0] == auto_repair._MAX_FIRES_PER_WINDOW


def test_failed_repair_still_records_fire():
    """A repair that raises must still be counted toward cooldown,
    otherwise a broken fix would loop forever on every Sentry alert."""
    def raiser():
        raise RuntimeError("synthetic failure")

    with patch.dict(os.environ, {"SENTRY_AUTO_REPAIR_ENABLED": "1"}):
        with patch.object(auto_repair, "_DISPATCH", [("fp", "x", raiser)]):
            for _ in range(auto_repair._MAX_FIRES_PER_WINDOW):
                r = auto_repair.auto_repair_for("trigger x")
                assert r["outcome"].startswith("failed: ")

            # Same as the success-path test — the (_MAX_FIRES + 1)-th
            # call is blocked even though all prior calls raised.
            blocked = auto_repair.auto_repair_for("trigger x")
            assert blocked["outcome"] == "cooldown_skip"


# ─── First-match-wins ────────────────────────────────────────────────────

def test_dispatch_table_first_match_wins():
    """Multiple substrings could match a title; only the first entry
    in the dispatch table runs."""
    calls = []

    def repair_a():
        calls.append("a")
        return "a ran"

    def repair_b():
        calls.append("b")
        return "b ran"

    with patch.dict(os.environ, {"SENTRY_AUTO_REPAIR_ENABLED": "1"}):
        with patch.object(
            auto_repair,
            "_DISPATCH",
            [
                ("fp_a", "common", repair_a),
                ("fp_b", "common", repair_b),
            ],
        ):
            r = auto_repair.auto_repair_for("alert with common substring")
    assert r["fingerprint"] == "fp_a"
    assert calls == ["a"]


# ─── Real dispatch table sanity check ────────────────────────────────────

def test_real_dispatch_table_has_at_least_three_entries():
    """Smoke check on the production dispatch table — if someone deletes
    a repair without thinking, this fails."""
    assert len(auto_repair._DISPATCH) >= 3
    fingerprints = {fp for (fp, _, _) in auto_repair._DISPATCH}
    assert "orphan_jobs" in fingerprints
    assert "orphan_fep_studies" in fingerprints
    assert "orphan_fep_edges" in fingerprints
