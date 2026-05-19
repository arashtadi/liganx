"""Sentry → Telegram bridge endpoint.

Sentry has no native Telegram integration. We piggyback on the existing
Telegram bot (already wired into Fly via TELEGRAM_BOT_TOKEN/CHAT_ID for
the contact form + failed-job alerts) and add one more channel: new
Sentry issues from liganx-frontend (and liganx-backend, once that's
emitting events).

Configure in Sentry:
  Settings → Alerts → New Alert Rule → "When a new issue is created" →
  Action: "Send a notification via an integration" → Webhook →
  URL: https://api.liganx.com/internal/sentry-webhook?secret=YOUR_SECRET

The `secret` query param matches the SENTRY_WEBHOOK_SECRET Fly secret.
If the env var isn't set the endpoint is wide open — we log a warning
once on startup so the operator notices.

Payload shape is intentionally forgiving:
  - "Internal Integration" webhooks send {action, data: {issue, event}}
  - "Issue Alert" rule's generic Webhook action sends a different
    shape with top-level `event` and `project_slug`
We probe both shapes plus a few fallbacks. If we can't extract anything
useful we still send a "Sentry webhook fired" alert with the raw URL
so the operator can dig into Sentry directly — silence is worse than
ugly.

Always responds 200 (even on internal failure) so Sentry doesn't
retry-bomb the endpoint. We log on failure for after-the-fact debug.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, Optional

from fastapi import APIRouter, Request

from ..services.auto_repair import auto_repair_for, is_enabled as _auto_repair_enabled
from ..services.notifications import notify_auto_repair, notify_sentry_alert

log = logging.getLogger(__name__)

router = APIRouter(prefix="/internal", tags=["internal"])


def _check_secret(provided: Optional[str]) -> bool:
    """Validate the webhook secret with a constant-time compare.

    FAILS CLOSED: if SENTRY_WEBHOOK_SECRET isn't set, reject every call.
    The old behaviour ("unset ⇒ accept anything") left the endpoint wide
    open — and it forwards straight to the operator's Telegram, so "open"
    means "anyone can spam your phone". An unconfigured secret should mean
    "no Sentry alerts", not "no auth". Set the Fly secret to enable it.
    """
    import hmac
    expected = (os.environ.get("SENTRY_WEBHOOK_SECRET") or "").strip()
    if not expected:
        log.warning(
            "sentry-webhook: SENTRY_WEBHOOK_SECRET not set — rejecting call "
            "(fail-closed). Set the Fly secret to enable Sentry → Telegram alerts."
        )
        return False
    # Constant-time compare — a plain == leaks secret length/prefix via timing.
    return hmac.compare_digest((provided or "").strip(), expected)


def _summarise(payload: Dict[str, Any]) -> Dict[str, Optional[str]]:
    """Pull the useful fields out of whatever Sentry sent. Returns a
    dict with keys: title, url, project, env, level, culprit, action.
    Any missing field comes back as None."""
    # Internal Integration webhook
    issue = (payload.get("data") or {}).get("issue")
    if isinstance(issue, dict):
        return {
            "title": issue.get("title")
            or (issue.get("metadata") or {}).get("value")
            or "Sentry issue",
            "url": issue.get("web_url") or issue.get("permalink"),
            "project": (issue.get("project") or {}).get("slug")
            or (payload.get("actor") or {}).get("name"),
            "env": ((payload.get("data") or {}).get("event") or {}).get("environment"),
            "level": issue.get("level"),
            "culprit": issue.get("culprit"),
            "action": payload.get("action"),
        }

    # Issue Alert generic-webhook shape
    event = payload.get("event")
    if isinstance(event, dict):
        return {
            "title": event.get("title") or event.get("message") or "Sentry event",
            "url": event.get("web_url") or event.get("url"),
            "project": payload.get("project_slug") or payload.get("project_name"),
            "env": event.get("environment"),
            "level": event.get("level"),
            "culprit": event.get("culprit"),
            "action": None,
        }

    # Last-resort: at least say something
    return {
        "title": payload.get("message") or payload.get("title") or "Sentry webhook",
        "url": payload.get("url"),
        "project": payload.get("project_slug"),
        "env": payload.get("environment"),
        "level": payload.get("level"),
        "culprit": None,
        "action": None,
    }


@router.post("/sentry-webhook")
async def sentry_webhook(request: Request) -> Dict[str, Any]:
    """Receive a Sentry webhook payload and forward a Telegram alert.

    Always returns 200 + {"ok": True/False, "reason": ...} so Sentry
    doesn't see a failure-retry signal. Reason field is for our own
    debugging — Sentry ignores the body."""
    secret = request.query_params.get("secret")
    if not _check_secret(secret):
        # Still 200 — don't leak the existence of the endpoint with a
        # 401. But log + skip the telegram send.
        log.warning("sentry-webhook: bad secret, dropping")
        return {"ok": False, "reason": "bad_secret"}

    try:
        payload = await request.json()
    except Exception as e:  # noqa: BLE001
        log.error("sentry-webhook: invalid JSON: %s", e)
        return {"ok": False, "reason": "bad_json"}

    s = _summarise(payload if isinstance(payload, dict) else {})
    sent = notify_sentry_alert(
        title=s["title"] or "Sentry alert",
        project=s["project"],
        env=s["env"],
        level=s["level"],
        culprit=s["culprit"],
        url=s["url"],
        action=s["action"],
    )

    # (U23) Layer 2 — try to auto-repair. Default OFF; gated on
    # SENTRY_AUTO_REPAIR_ENABLED. The dispatcher returns None if
    # nothing in the dispatch table matched, or a dict describing
    # the outcome (ran / failed / cooldown_skip / disabled).
    repair_outcome: Optional[Dict[str, Any]] = None
    try:
        repair_outcome = auto_repair_for(s["title"])
    except Exception as e:  # noqa: BLE001
        # auto_repair_for is documented as never-raises, but belt-and-
        # braces: we never want this branch to break the Sentry-→-Telegram
        # forward. Log + carry on.
        log.exception("auto_repair_for raised unexpectedly: %s", e)
        repair_outcome = {"fingerprint": None, "outcome": f"dispatcher_error: {e}"}

    # Post a follow-up Telegram only when the repair actually had
    # something to say (skip the silent "no match" case to avoid spam).
    if repair_outcome is not None and repair_outcome.get("outcome") not in (None,):
        try:
            notify_auto_repair(
                fingerprint=repair_outcome.get("fingerprint") or "unknown",
                outcome=repair_outcome.get("outcome") or "",
                triggered_by_title=s.get("title"),
            )
        except Exception:  # noqa: BLE001
            log.exception("notify_auto_repair failed (non-fatal)")

    return {
        "ok": bool(sent),
        "auto_repair_enabled": _auto_repair_enabled(),
        "auto_repair": repair_outcome,
    }
