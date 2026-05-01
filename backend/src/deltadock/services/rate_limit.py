"""Per-IP rate limiter — sliding-window in-memory implementation.

Why per-IP and not per-account: Liganx Beta has no user accounts. IP is the
only stable identifier we have. This is "good enough" because the platform
is research-grade — abusive throughput is the threat we want to bound, not
account-level fairness.

Why in-memory and not Redis: Fly.io currently runs a single container per
VM (single-replica deploy). One in-memory dict is sufficient. If we ever
scale to multiple replicas, swap the backing store to Redis or a Postgres
window-table without changing the public interface.

Sliding-window vs token-bucket: we use a sliding-window log (a deque of
timestamps) per (key, scope). It's slightly more memory than a counter
but gives accurate "exactly N in the last hour" semantics, which the
agents will be testing for.
"""

from __future__ import annotations

import logging
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from threading import Lock
from typing import Callable

from fastapi import HTTPException, Request, Response

log = logging.getLogger(__name__)


@dataclass
class RateLimit:
    """One bucket: 'X requests per Y seconds'."""
    max_requests: int
    window_seconds: int

    @property
    def label(self) -> str:
        # Human-readable for the 429 detail message.
        if self.window_seconds % 3600 == 0:
            n = self.window_seconds // 3600
            return f"{n} hour" if n == 1 else f"{n} hours"
        if self.window_seconds % 60 == 0:
            return f"{self.window_seconds // 60} minutes"
        return f"{self.window_seconds} seconds"


# Global state, protected by a lock for thread safety. defaultdict so we never
# raise on a fresh IP; the deque holds Unix timestamps of recent requests.
_buckets: dict[tuple[str, str], deque[float]] = defaultdict(deque)
_lock = Lock()


def _client_ip(request: Request) -> str:
    """Best-effort client IP. Behind Fly's proxy, the real client IP is in
    Fly-Client-IP; outside Fly we read X-Forwarded-For. Falls back to the
    socket peer address as a last resort.
    """
    # Fly.io sets this header on every request — most reliable inside Fly.
    fly = request.headers.get("Fly-Client-IP")
    if fly:
        return fly.strip()
    # Generic proxy header — take the LEFTMOST entry which is the original
    # client (per RFC 7239 standard); rightmost entries are intermediate proxies.
    xff = request.headers.get("X-Forwarded-For")
    if xff:
        return xff.split(",")[0].strip()
    # Fallback: socket address. Won't have the real IP behind a proxy, but
    # at least it's stable for local testing.
    return request.client.host if request.client else "unknown"


def rate_limit(scope: str, limit: RateLimit) -> Callable:
    """Build a FastAPI dependency that rate-limits the decorated endpoint.

    Usage:
        rl = rate_limit("jobs", RateLimit(30, 3600))
        @router.post("/jobs", dependencies=[Depends(rl)])
        def create_job(...): ...

    On 429 we set Retry-After so well-behaved clients can back off.
    On 2xx we attach X-RateLimit-Limit / -Remaining / -Reset to EVERY
    response from this scope so well-behaved clients can pre-emptively
    back off before they hit the wall — this addresses the audit
    finding that clients had no signal until they were blocked.
    """
    def dependency(request: Request, response: Response) -> None:
        ip = _client_ip(request)
        # Health checks from Fly's internal proxy and our own monitoring
        # shouldn't count toward the limit. Whitelist the loopback + Fly's
        # internal address space so we don't lock ourselves out.
        if ip in ("127.0.0.1", "::1", "unknown") or ip.startswith("fdaa:"):
            return

        key = (ip, scope)
        # Use BOTH a monotonic clock (for window math — immune to NTP
        # jitter) and the wall clock (for the X-RateLimit-Reset header,
        # which clients expect as a Unix timestamp). Computing a delta
        # off monotonic and adding to wall-clock now keeps both honest.
        mono_now = time.monotonic()
        wall_now = time.time()
        cutoff = mono_now - limit.window_seconds

        with _lock:
            bucket = _buckets[key]
            # Drop entries outside the window from the LEFT (oldest first).
            while bucket and bucket[0] < cutoff:
                bucket.popleft()
            current = len(bucket)
            if current >= limit.max_requests:
                # Compute Retry-After based on when the oldest entry expires.
                retry_after = max(1, int(bucket[0] + limit.window_seconds - mono_now + 1))
                log.info(
                    "rate-limit hit: ip=%s scope=%s count=%d/%d retry_after=%ds",
                    ip, scope, current, limit.max_requests, retry_after,
                )
                raise HTTPException(
                    status_code=429,
                    detail=(
                        f"Rate limit exceeded for {scope}: "
                        f"{limit.max_requests} requests per {limit.label}. "
                        f"Try again in {retry_after} seconds."
                    ),
                    headers={
                        "Retry-After": str(retry_after),
                        "X-RateLimit-Limit": str(limit.max_requests),
                        "X-RateLimit-Remaining": "0",
                        "X-RateLimit-Reset": str(int(wall_now + retry_after)),
                    },
                )
            bucket.append(mono_now)
            # Compute when the OLDEST in-window request will expire — that's
            # when the next slot frees up. If the bucket is now empty
            # (impossible after the append above, but guard for safety),
            # reset is "now + window".
            oldest = bucket[0] if bucket else mono_now
            reset_in = max(0, int(oldest + limit.window_seconds - mono_now))

        # Attach pre-emptive rate-limit headers on every successful call so
        # clients can decide to slow down before being blocked. -1 because
        # we just appended this request — Remaining is what's left AFTER it.
        response.headers["X-RateLimit-Limit"] = str(limit.max_requests)
        response.headers["X-RateLimit-Remaining"] = str(max(0, limit.max_requests - current - 1))
        response.headers["X-RateLimit-Reset"] = str(int(wall_now + reset_in))

    return dependency


# ──────────────────────────────────────────────────────────────────────
# Configured limits — tuned for research-scale usage on the current Pod.
# Bump these once we know real-world traffic patterns.
# ──────────────────────────────────────────────────────────────────────

JOBS_LIMIT = rate_limit("jobs", RateLimit(max_requests=30, window_seconds=3600))
"""30 job submissions per hour per IP. A typical research session might
submit 10-20 jobs (one per target × mutation set), so 30/hr is generous
for legitimate use and tight enough to bound a runaway script."""

UPLOADS_LIMIT = rate_limit("uploads", RateLimit(max_requests=10, window_seconds=3600))
"""10 PDB uploads per hour per IP. Smaller because each upload writes to
the Fly volume; without this an abuser could fill the volume in minutes."""

CONTACT_LIMIT = rate_limit("contact", RateLimit(max_requests=5, window_seconds=3600))
"""5 contact-form submissions per hour per IP. Even a determined human will
not legitimately need more than this — anything past it is almost certainly
a bot grinding past our honeypot. Each submission causes a Telegram push
notification on Arash's phone, so the cost of letting spam through is
real (notification fatigue) not just bandwidth."""
