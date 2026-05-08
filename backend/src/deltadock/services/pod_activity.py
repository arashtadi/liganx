"""Pod-activity tracker — module-global last-seen timestamp.

Updated by `bump_pod_activity()` from every code path that hands work
to the GPU pod (quick_dock, optimize_loop, runner). Read by the
watchdog asyncio task in main.py to decide when to auto-stop.

In-memory only — survives within a single Fly machine. If the API
restarts (deploy, crash), we treat the timestamp as 'unknown' and
the watchdog conservatively keeps the pod up until traffic resumes
or grace period elapses. Cross-machine sync isn't needed for this
use case: the watchdog stops the pod, and any machine that gets a
job request will read pod status before forwarding (via the existing
quick_dock health-check path).
"""

from __future__ import annotations

import time
from typing import Optional

# Initialized to None so we can distinguish "no traffic yet seen since
# this machine started" from "traffic was at second 0 of unix time".
_LAST_ACTIVITY_TS: Optional[float] = None


def bump_pod_activity() -> None:
    """Mark the pod as having served traffic just now. Cheap — no
    locks, no I/O. Safe to call from sync or async contexts."""
    global _LAST_ACTIVITY_TS
    _LAST_ACTIVITY_TS = time.time()


def last_activity() -> Optional[float]:
    """Return the unix timestamp of the most recent pod-activity bump,
    or None if no traffic since startup."""
    return _LAST_ACTIVITY_TS


def seconds_since_last_activity() -> Optional[float]:
    """Return seconds elapsed since last bump, or None if none yet."""
    if _LAST_ACTIVITY_TS is None:
        return None
    return max(0.0, time.time() - _LAST_ACTIVITY_TS)


def is_idle(threshold_seconds: float) -> bool:
    """True iff we have a baseline timestamp AND it's older than the
    threshold. None ⇒ False (we conservatively assume active until
    we've seen at least one request post-startup)."""
    elapsed = seconds_since_last_activity()
    if elapsed is None:
        return False
    return elapsed >= threshold_seconds
