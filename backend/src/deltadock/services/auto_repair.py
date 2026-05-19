"""(U23) Sentry-driven auto-repair dispatch.

Pairs with `routers/sentry_webhook.py`. When a Sentry alert fires, the
webhook handler calls `auto_repair_for(title)`. This module looks at
the issue title, matches it against a small dispatch table of known
fingerprints, and runs the matching repair function — but only if
that fingerprint hasn't been fired too many times in the last window
(default: 3 fires per 10 minutes). The cooldown is the safety belt
against auto-fix storms: a repair that itself raises will surface a
new Sentry alert, which would trigger another repair, infinite loop.

Design choices, explicit:

  • In-process cooldown dict (not Redis). Liganx runs a single Fly
    machine. If we scale horizontally we'll lift this into Redis; the
    swap is local to `_is_in_cooldown` / `_record_fire`.

  • Substring match on the issue title — NOT a structured match on
    `event.exception.values[0].type`. Sentry titles are stable for the
    "Interrupted by a backend restart" family because we control the
    string at the source (the reaper sets it). For library-thrown
    exceptions we'd want a stronger fingerprint, but the 3 repairs we
    wire up first all match strings the reapers themselves emit, so
    the cycle is closed.

  • Default OFF. The env-var `SENTRY_AUTO_REPAIR_ENABLED=1` is the
    one switch. Same on/off shape as SENTRY_DISABLED (U15) so the
    operator has a single mental model: flip a Fly secret to silence
    the loop in a hurry.

  • Repairs MUST be idempotent. Every callable below is either a
    no-op when there's nothing to fix, or a SET-WHERE update that's
    safe to re-run.

Adding a new repair:
  1. Write a function that takes no args, runs the repair, returns a
     short human-readable string ("reaped 3 orphan edges").
  2. Append a tuple to `_DISPATCH`: (fingerprint, title_substring, fn).
     `title_substring` is matched case-insensitively against the
     Sentry alert title; first match wins.
  3. Add a test in tests/test_auto_repair.py.
"""
from __future__ import annotations

import logging
import os
import time
from threading import Lock
from typing import Callable, Optional

log = logging.getLogger(__name__)

# ─── Cooldown ──────────────────────────────────────────────────────────────

_COOLDOWN_LOCK = Lock()
_RECENT_FIRES: dict[str, list[float]] = {}

# Conservative: a healthy repair fires once and shuts up. If we're
# seeing 3+ fires in 10 minutes, something has gone wrong (either the
# repair isn't actually fixing the root cause, or it's looping). Pause
# and page a human via the existing Telegram alert (which still fires —
# only the auto-fix step is gated, not the notification).
_MAX_FIRES_PER_WINDOW = 3
_WINDOW_SECONDS = 10 * 60


def _is_in_cooldown(fingerprint: str) -> bool:
    """True if `fingerprint` has fired ≥ _MAX_FIRES_PER_WINDOW times in
    the last _WINDOW_SECONDS. Side-effect-free read."""
    now = time.time()
    with _COOLDOWN_LOCK:
        fires = _RECENT_FIRES.setdefault(fingerprint, [])
        # GC anything older than the window so the list doesn't grow.
        fires[:] = [t for t in fires if now - t < _WINDOW_SECONDS]
        return len(fires) >= _MAX_FIRES_PER_WINDOW


def _record_fire(fingerprint: str) -> None:
    """Stamp a fire-time so future cooldown checks see it."""
    with _COOLDOWN_LOCK:
        _RECENT_FIRES.setdefault(fingerprint, []).append(time.time())


def _reset_cooldown_for_tests() -> None:
    """Test-only — clear the in-memory cooldown state."""
    with _COOLDOWN_LOCK:
        _RECENT_FIRES.clear()


# ─── Repair callables ──────────────────────────────────────────────────────

def _repair_orphan_jobs() -> str:
    """Wraps main._reap_orphan_jobs — manages its own session."""
    from ..main import _reap_orphan_jobs
    _reap_orphan_jobs()
    return "docking-job reaper completed"


def _repair_orphan_fep_studies() -> str:
    """Wraps main._reap_orphan_fep_studies — manages its own session."""
    from ..main import _reap_orphan_fep_studies
    _reap_orphan_fep_studies()
    return "FEP-study reaper completed"


def _repair_cancelled_orphan_edges() -> str:
    """Wraps fep_reconciler._reap_cancelled_orphans. That helper expects
    a session passed in; we own the session lifecycle here."""
    from sqlmodel import Session

    from ..db import engine
    from .fep_reconciler import _reap_cancelled_orphans
    with Session(engine) as session:
        n = _reap_cancelled_orphans(session)
        session.commit()
    return f"orphan FEP edges reaped: {n}"


# ─── Dispatch table ────────────────────────────────────────────────────────
# Order matters — first substring match wins. Substrings are matched
# case-insensitively against the Sentry alert title. Keep them specific
# enough that they don't accidentally fire on unrelated issues.

_DISPATCH: list[tuple[str, str, Callable[[], str]]] = [
    # The reaper itself writes this text into job.error_message, and
    # Sentry surfaces it as the issue title via SDK auto-tagging.
    ("orphan_jobs",
     "interrupted by a backend restart — the docking worker",
     _repair_orphan_jobs),

    ("orphan_fep_studies",
     "interrupted by a backend restart — the fep runner",
     _repair_orphan_fep_studies),

    # The U21 reap path writes "[orphan-reaped: parent cancelled >1h ago]"
    # into pod_log_tail. If Sentry sees one of these and we still have
    # MORE stuck orphans, running the reaper again is the right move.
    ("orphan_fep_edges",
     "orphan-reaped",
     _repair_cancelled_orphan_edges),
]


# ─── Public API ────────────────────────────────────────────────────────────

def is_enabled() -> bool:
    """Auto-repair runs ONLY when the operator opts in. The default
    state on Fly is "alerts fire but auto-fix is dormant" so the first
    rollout day is a passive observation — does the dispatch table
    match the right titles? — before we let it actually mutate state."""
    return (os.environ.get("SENTRY_AUTO_REPAIR_ENABLED", "0").strip() == "1")


def auto_repair_for(title: Optional[str]) -> Optional[dict]:
    """Look at a Sentry alert title and try to fire a matching repair.

    Returns:
      None — nothing in the dispatch table matched (the common case;
             most Sentry alerts are NOT auto-repairable)
      {"fingerprint": ..., "outcome": "disabled"}      — kill-switch off
      {"fingerprint": ..., "outcome": "cooldown_skip"} — too many recent fires
      {"fingerprint": ..., "outcome": "<msg>"}         — repair ran ok
      {"fingerprint": ..., "outcome": "failed: ..."}   — repair raised

    Never raises — a failing repair becomes a returned-string outcome.
    """
    if not is_enabled():
        return {"fingerprint": None, "outcome": "disabled"}
    if not title:
        return None
    needle = title.lower()
    for fingerprint, substr, fn in _DISPATCH:
        if substr.lower() in needle:
            if _is_in_cooldown(fingerprint):
                log.warning(
                    "auto_repair: %s in cooldown — skipping (≥%d fires in %ds)",
                    fingerprint, _MAX_FIRES_PER_WINDOW, _WINDOW_SECONDS,
                )
                return {"fingerprint": fingerprint, "outcome": "cooldown_skip"}
            try:
                outcome = fn()
                _record_fire(fingerprint)
                log.info("auto_repair: %s → %s", fingerprint, outcome)
                return {"fingerprint": fingerprint, "outcome": outcome}
            except Exception as e:  # noqa: BLE001
                log.exception("auto_repair: %s failed: %s", fingerprint, e)
                # Still record the fire — a repair that's failing
                # *should* cool down, otherwise we loop on the same
                # broken fix.
                _record_fire(fingerprint)
                return {"fingerprint": fingerprint, "outcome": f"failed: {e}"}
    return None
