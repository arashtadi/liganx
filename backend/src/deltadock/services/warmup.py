"""Business-hours keep-alive for the RunPod serverless docking endpoint.

Cold starts are the #1 retention risk: the first user after an idle period
waits for a RunPod worker to boot + pull the image (tens of seconds up to a
couple minutes), which reads as "broken." This module keeps >=1 worker warm
during business hours by firing a cheap request at the endpoint on a short
interval, so real jobs land on an already-running worker.

Cost control: it only pings inside the configured business-hours window
(WARMUP_TZ, weekdays optional, WARMUP_HOUR_START..WARMUP_HOUR_END). Outside
the window it does nothing and the endpoint scales to zero as usual — so the
GPU is only kept warm ~9h/weekday instead of 24/7 (~$150/mo vs ~$400/mo).

The ping POSTs {"input": {"warmup": true}} to the endpoint's async /run. The
worker handler has no 'warmup' branch yet, so it returns a fast
"missing required field" error — but the container still wakes and stays warm
for its idle-timeout window. No worker-image change is required. (A clean
handler branch can be added later to avoid the errored-job noise; note it's
harmless either way.)

IMPORTANT: for the keep-alive to actually HOLD a worker warm between pings,
the endpoint's idle-timeout must be >= the ping interval. That setting lives
in the RunPod console (Endpoint -> Edit -> Idle Timeout). With a ~180s idle
timeout and the default 50s ping, a worker stays warm across the whole
business-hours window. The Studio-open ping (POST /warmup) helps regardless:
it starts a worker booting while the user is still picking a target/compounds.

Flag-gated: WARMUP_ENABLED=false (default) -> the loop is inert.
"""
from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime

try:  # zoneinfo is stdlib on 3.9+, but guard so import can never break boot
    from zoneinfo import ZoneInfo
except Exception:  # noqa: BLE001
    ZoneInfo = None  # type: ignore[assignment]

import httpx

from ..config import get_settings

log = logging.getLogger("deltadock.warmup")

# Debounce so a burst of Studio-open pings (or overlap with the loop) can't
# rack up cost — at most one real ping every _MIN_GAP_S. monotonic() only,
# so it's immune to wall-clock jumps.
_last_ping_mono: float = 0.0
_MIN_GAP_S: float = 15.0


def _within_business_hours(settings) -> bool:
    """True if 'now' falls inside the configured business-hours window."""
    tz = None
    if ZoneInfo is not None:
        try:
            tz = ZoneInfo(settings.warmup_tz)
        except Exception:  # noqa: BLE001 — bad tz name -> fall back to UTC
            tz = None
    now = datetime.now(tz) if tz is not None else datetime.utcnow()
    if settings.warmup_weekdays_only and now.weekday() >= 5:
        return False  # Saturday / Sunday
    return settings.warmup_hour_start <= now.hour < settings.warmup_hour_end


async def fire_warmup_ping(settings=None, *, force: bool = False) -> bool:
    """Fire a single warmup request at the RunPod docking endpoint.

    Returns True if a worker was (or was recently) poked, False if RunPod
    isn't configured or the request errored. Never raises — safe to call
    fire-and-forget from a request handler.
    """
    global _last_ping_mono
    settings = settings or get_settings()
    if not (settings.runpod_api_key and settings.runpod_endpoint_id):
        return False
    now = time.monotonic()
    if not force and (now - _last_ping_mono) < _MIN_GAP_S:
        return True  # pinged very recently — treat the worker as already warm
    _last_ping_mono = now
    url = f"https://api.runpod.ai/v2/{settings.runpod_endpoint_id}/run"
    headers = {"Authorization": f"Bearer {settings.runpod_api_key}"}
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.post(url, headers=headers, json={"input": {"warmup": True}})
            # <500 means RunPod accepted the request and a worker will wake;
            # the handler's field-validation error is expected and harmless.
            return r.status_code < 500
    except Exception as e:  # noqa: BLE001 — warmup is best-effort
        log.info("warmup ping failed (non-fatal): %s", e)
        return False


async def warmup_keepalive_loop() -> None:
    """Background task: during business hours, keep a RunPod worker warm.

    Mirrors the other lifespan asyncio loops (watchdog/reaper). No-op unless
    WARMUP_ENABLED and RunPod is configured.
    """
    settings = get_settings()
    if not settings.warmup_enabled:
        log.info("warmup keep-alive: disabled (WARMUP_ENABLED=false) — skipping")
        return
    if not (settings.runpod_api_key and settings.runpod_endpoint_id):
        log.info("warmup keep-alive: RunPod not configured — skipping")
        return
    log.info(
        "warmup keep-alive: ping %s every %ds during %02d:00-%02d:00 %s%s",
        settings.runpod_endpoint_id, settings.warmup_ping_interval_s,
        settings.warmup_hour_start, settings.warmup_hour_end, settings.warmup_tz,
        " (weekdays only)" if settings.warmup_weekdays_only else "",
    )
    while True:
        try:
            if _within_business_hours(settings):
                await fire_warmup_ping(settings, force=True)
            await asyncio.sleep(settings.warmup_ping_interval_s)
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001 — never let a tick kill the loop
            log.warning("warmup keep-alive tick errored (continuing): %s", e)
            await asyncio.sleep(settings.warmup_ping_interval_s)
