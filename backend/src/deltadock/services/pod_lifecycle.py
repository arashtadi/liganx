"""Pod auto-resume — wake the GPU pod on demand before forwarding work.

The watchdog (main.py:_runpod_watchdog) auto-STOPS the pod after 30 min
of zero traffic to avoid the $15/day idle bill. This module is the
matching auto-START half: when a Full Job arrives and the pod is
EXITED, hit RunPod's resume mutation, then poll the pod's /health
until it responds. Returns True on ready, False on timeout.

Intentionally idempotent + side-effect-light:
  - If the pod's already RUNNING, returns immediately (one status call).
  - If RunPod isn't configured (RUNPOD_API_KEY / POD_ID unset), returns
    True without trying — preserves the legacy "always-on pod" path
    for dev environments.
  - Logs but doesn't raise on RunPod API errors. Caller can see the
    bool result and fall through to whatever error handling already
    exists for an unreachable pod (the dock_server HTTP call will
    fail with its own error, which the runner already handles).

Cold-start budget: 5 minutes by default. The /health poll fires every
10 s. From observation, a Blackwell pod resume + start_dock_server.sh
boot takes ~3 min steady-state; 5 min gives headroom for slow boot.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Awaitable, Callable, Optional

import httpx

from ..config import get_settings
from . import runpod_client
from .pod_activity import bump_pod_activity

settings = get_settings()

log = logging.getLogger(__name__)

DEFAULT_TIMEOUT_S = 300  # 5 minutes
HEALTH_POLL_INTERVAL_S = 10


async def _poll_pod_health(deadline: float) -> bool:
    """Hit the pod's /health endpoint until it returns 200 or the
    deadline passes. The pod URL comes from settings.pod_dock_url."""
    url = settings.pod_dock_url.rstrip("/") + "/health"
    while time.time() < deadline:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                r = await client.get(url)
                if r.status_code == 200:
                    return True
        except Exception:
            # Connection errors are expected while the pod is booting.
            pass
        await asyncio.sleep(HEALTH_POLL_INTERVAL_S)
    return False


async def ensure_pod_ready(
    timeout_s: int = DEFAULT_TIMEOUT_S,
    on_stage_change: Optional[Callable[[str], Awaitable[None]]] = None,
) -> bool:
    """Wake the pod if needed and wait until /health is green.

    Args:
      timeout_s: total budget across status check + resume + health poll.
      on_stage_change: optional async callback that receives a short
        slug ('pod_resuming' / 'pod_warming') so the caller can update
        an in-flight job's UI stage label. Passes through to whatever
        the runner uses to update job.stage.

    Returns:
      True if the pod is ready (or RunPod isn't configured / pod is
      already running). False if we couldn't get it warm in time.
    """
    if not runpod_client.is_configured():
        # Feature disabled — assume the operator keeps the pod
        # always-on like in the pre-watchdog days. Caller proceeds
        # straight to its dock_server HTTP call.
        return True

    deadline = time.time() + timeout_s
    try:
        status = await runpod_client.get_pod_status()
    except Exception as e:  # noqa: BLE001
        log.warning("ensure_pod_ready: status check failed: %s", e)
        # Don't block on a transient API failure — let the caller try
        # the dock_server HTTP call; it'll either succeed (pod was
        # actually fine) or fail with its own clear error.
        return True

    desired = (status.get("desiredStatus") or "").upper()
    if desired == "RUNNING":
        # Pod thinks it's running. Still verify dock_server is up —
        # the container could be in start_dock_server.sh's apt
        # install loop after a fresh resume. Cheap one-shot health
        # check; if it's already responding we return immediately.
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                r = await client.get(settings.pod_dock_url.rstrip("/") + "/health")
                if r.status_code == 200:
                    bump_pod_activity()  # extend watchdog timer
                    return True
        except Exception:
            pass
        # Pod is RUNNING but dock_server isn't responding — likely
        # mid-boot. Fall through to health-poll loop.
        if on_stage_change:
            try:
                await on_stage_change("pod_warming")
            except Exception:
                pass
        ready = await _poll_pod_health(deadline)
        if ready:
            bump_pod_activity()
        return ready

    # Pod is EXITED / STOPPED / unknown. Resume + wait for health.
    log.info("ensure_pod_ready: pod desired=%s, resuming", desired)
    if on_stage_change:
        try:
            await on_stage_change("pod_resuming")
        except Exception:
            pass
    try:
        await runpod_client.start_pod()
    except Exception as e:  # noqa: BLE001
        log.warning("ensure_pod_ready: start_pod failed: %s", e)
        return False
    if on_stage_change:
        try:
            await on_stage_change("pod_warming")
        except Exception:
            pass
    ready = await _poll_pod_health(deadline)
    if ready:
        bump_pod_activity()
        log.info("ensure_pod_ready: pod healthy after %.1fs", time.time() - (deadline - timeout_s))
    else:
        log.warning("ensure_pod_ready: pod not ready after %ds", timeout_s)
    return ready


def ensure_pod_ready_sync(
    timeout_s: int = DEFAULT_TIMEOUT_S,
    on_stage_change: Optional[Callable[[str], None]] = None,
) -> bool:
    """Sync wrapper for callers running in a worker thread (runner.py).

    Spins up its own asyncio event loop with asyncio.run(). Each job
    runs in its own thread so this is safe — no nested-loop concerns.
    The on_stage_change callback is sync here; it's adapted to the
    async-callback API of ensure_pod_ready via a small shim.
    """
    async def _async_cb(slug: str) -> None:
        if on_stage_change:
            try:
                on_stage_change(slug)
            except Exception:
                pass

    return asyncio.run(ensure_pod_ready(timeout_s=timeout_s, on_stage_change=_async_cb))
