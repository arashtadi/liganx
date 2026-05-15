"""Pod auto-failover (S3) — companion to the cost watchdog.

The existing `_runpod_watchdog` task stops the pod when traffic is idle
(cost control). This module does the inverse: if the pod is unreachable
WHILE there's been recent docking activity, automatically resume it via
the RunPod API. Recovery time: ~3-5 minutes (RunPod pod resume cold-
start), versus "hours until you notice and act" without this.

Architecture: one pure-function decision layer (`decide`) makes it easy
to unit-test every condition without faking the network. The async
watchdog task is a thin wrapper that gathers the inputs (pod /health
ping + RunPod GraphQL status + activity timer + cooldown timer) and
acts on the decision.

Safety rails:
  • Only fires when there's BEEN recent activity. Idle pod = "cost
    watchdog probably stopped it on purpose"; let it sleep.
  • Sustained unreachability required (default 5 min). One blip on
    /health doesn't trigger anything.
  • Cooldown after any recovery attempt (default 15 min). Even if the
    pod is genuinely broken, we never spam the RunPod API.
  • Distinguishes "pod is STOPPED" (start it) from "pod is RUNNING but
    uvicorn is dead" (alert humans — auto-restart from outside the pod
    isn't possible without SSH; the boot hook from R1 handles
    container-internal failures).

Telegram alerts (using the same TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID
that R2's monitor uses) fire for both auto-recoveries and the "needs
a human" case. Absent tokens = silent no-op, the failover still works.
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Literal, Optional

import httpx

from ..config import get_settings
from . import runpod_client
from .pod_activity import seconds_since_last_activity

log = logging.getLogger(__name__)


# ────────────────────── Decision layer (pure) ─────────────────────


Action = Literal["none", "start_pod", "alert_only"]


@dataclass
class FailoverDecision:
    action: Action
    reason: str


def decide(
    *,
    pod_reachable: bool,
    pod_desired_status: Optional[str],          # "RUNNING" / "EXITED" / etc.
    seconds_since_last_health_ok: float,
    seconds_since_last_activity: float,
    seconds_since_last_recovery_attempt: Optional[float],
    min_unreachable_seconds: float = 300.0,     # 5 min sustained
    min_recent_activity_seconds: float = 1800.0,  # 30 min
    min_recovery_cooldown_seconds: float = 900.0,  # 15 min
) -> FailoverDecision:
    """Decide whether to trigger pod recovery.

    Returns one of:
      none        — pod is fine, transient blip, or no recent users
      start_pod   — pod is stopped + users need it → resume via API
      alert_only  — pod says it's running but uvicorn unreachable, OR
                    pod state is unknown — humans need to look.
    """
    if pod_reachable:
        return FailoverDecision("none", "pod reachable")
    if seconds_since_last_health_ok < min_unreachable_seconds:
        return FailoverDecision(
            "none",
            f"unreachable for {seconds_since_last_health_ok:.0f}s < threshold "
            f"{min_unreachable_seconds:.0f}s; waiting",
        )
    if seconds_since_last_activity > min_recent_activity_seconds:
        return FailoverDecision(
            "none",
            f"no docking activity in {seconds_since_last_activity:.0f}s "
            f"(threshold {min_recent_activity_seconds:.0f}s); pod-down is acceptable",
        )
    if (
        seconds_since_last_recovery_attempt is not None
        and seconds_since_last_recovery_attempt < min_recovery_cooldown_seconds
    ):
        return FailoverDecision(
            "none",
            f"recovery cooldown active "
            f"({seconds_since_last_recovery_attempt:.0f}s < "
            f"{min_recovery_cooldown_seconds:.0f}s)",
        )
    if pod_desired_status == "RUNNING":
        # The container claims to be up but uvicorn isn't responding. Can't
        # fix from outside the pod (no SSH); needs human attention. The
        # boot hook from R1 handles container-restart cases.
        return FailoverDecision(
            "alert_only",
            "pod desiredStatus=RUNNING but uvicorn unreachable",
        )
    if pod_desired_status in ("EXITED", "STOPPED", "TERMINATED"):
        return FailoverDecision(
            "start_pod",
            f"pod desiredStatus={pod_desired_status}; resuming via RunPod API",
        )
    return FailoverDecision(
        "alert_only",
        f"pod desiredStatus unknown ({pod_desired_status!r}); needs investigation",
    )


# ────────────────────── Side effects ─────────────────────


async def _ping_pod_health(timeout_s: float = 8.0) -> bool:
    """Probe the pod's /health endpoint (auth-exempt; works regardless
    of POD_SHARED_SECRET state). Returns True iff 200."""
    settings = get_settings()
    url = (settings.pod_dock_url or "").rstrip("/") + "/health"
    if not url.startswith("http"):
        return False
    try:
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            r = await client.get(url)
            return r.status_code == 200
    except Exception:
        return False


def _send_telegram(text: str) -> None:
    """Best-effort Telegram alert — silent no-op if tokens absent.

    Synchronous (urllib) so it doesn't compete with the asyncio loop;
    runs inside an executor below.
    """
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    chat = os.environ.get("TELEGRAM_CHAT_ID", "").strip()
    if not token or not chat:
        return
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    data = urllib.parse.urlencode({"chat_id": chat, "text": text}).encode("utf-8")
    try:
        req = urllib.request.Request(
            url, data=data, method="POST",
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        urllib.request.urlopen(req, timeout=10).close()
    except Exception as e:                            # noqa: BLE001
        log.info("pod_failover: Telegram alert send failed: %s", e)


async def alert(text: str) -> None:
    """Async wrapper around _send_telegram — keeps the watchdog non-blocking."""
    log.warning("pod_failover: %s", text)
    await asyncio.get_event_loop().run_in_executor(None, _send_telegram, text)


# ────────────────────── Async watchdog ─────────────────────


async def runpod_failover_watchdog():
    """Long-running task: probe the pod's /health every minute, and when
    sustained unreachability coincides with recent docking activity,
    resume the pod via the RunPod API. Idempotent — running multiple
    iterations against an already-recovering pod just waits politely.

    Wired in from main.py:lifespan alongside the cost watchdog.
    """
    settings = get_settings()
    if not runpod_client.is_configured():
        log.info("pod_failover: RUNPOD_API_KEY / RUNPOD_POD_ID not set — skipping")
        return
    if not settings.runpod_failover_enabled:
        log.info("pod_failover: disabled via RUNPOD_FAILOVER_ENABLED=false — skipping")
        return

    log.info(
        "pod_failover: watching pod %s (unreachable threshold=%ds, "
        "recent-activity window=%ds, recovery cooldown=%ds)",
        settings.runpod_pod_id,
        settings.runpod_failover_unreachable_seconds,
        settings.runpod_failover_recent_activity_seconds,
        settings.runpod_failover_cooldown_seconds,
    )

    last_health_ok = time.monotonic()
    last_recovery_attempt: Optional[float] = None

    while True:
        try:
            await asyncio.sleep(60)
            pod_reachable = await _ping_pod_health()
            now = time.monotonic()
            if pod_reachable:
                last_health_ok = now
                continue

            # Pod is unreachable — gather context.
            seconds_since_health_ok = now - last_health_ok
            seconds_since_activity = seconds_since_last_activity() or 1e9
            seconds_since_recovery = (
                None if last_recovery_attempt is None else (now - last_recovery_attempt)
            )
            try:
                status = await runpod_client.get_pod_status()
                desired = status.get("desiredStatus")
            except Exception as e:                    # noqa: BLE001
                log.info("pod_failover: get_pod_status failed: %s", e)
                desired = None

            decision = decide(
                pod_reachable=False,
                pod_desired_status=desired,
                seconds_since_last_health_ok=seconds_since_health_ok,
                seconds_since_last_activity=seconds_since_activity,
                seconds_since_last_recovery_attempt=seconds_since_recovery,
                min_unreachable_seconds=settings.runpod_failover_unreachable_seconds,
                min_recent_activity_seconds=settings.runpod_failover_recent_activity_seconds,
                min_recovery_cooldown_seconds=settings.runpod_failover_cooldown_seconds,
            )

            if decision.action == "none":
                log.debug("pod_failover: decision=none (%s)", decision.reason)
                continue

            if decision.action == "start_pod":
                log.warning(
                    "pod_failover: TRIGGERING pod resume — %s", decision.reason,
                )
                try:
                    await runpod_client.start_pod()
                    last_recovery_attempt = now
                    await alert(
                        "🟡 Liganx failover: resumed RunPod pod "
                        f"({settings.runpod_pod_id}). Pod was {desired}; "
                        f"recent docking activity {seconds_since_activity:.0f}s ago. "
                        "Cold-start takes 3-5 min before /dock is ready again."
                    )
                except Exception as e:                # noqa: BLE001
                    log.warning("pod_failover: start_pod failed: %s", e)
                    last_recovery_attempt = now       # cooldown the error too
                    await alert(
                        f"🔴 Liganx failover: TRIED to resume RunPod pod "
                        f"({settings.runpod_pod_id}) but the API call failed: {e}"
                    )
            elif decision.action == "alert_only":
                last_recovery_attempt = now           # rate-limit the alert
                await alert(
                    f"🔴 Liganx failover: pod {settings.runpod_pod_id} "
                    f"needs a human — {decision.reason} "
                    f"(unreachable for {seconds_since_health_ok:.0f}s; "
                    f"recent activity {seconds_since_activity:.0f}s ago)"
                )

        except asyncio.CancelledError:
            log.info("pod_failover: cancelled")
            raise
        except Exception as e:                        # noqa: BLE001
            log.warning("pod_failover: iteration error: %s", e)
