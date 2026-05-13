"""Telegram operational alerts.

This module owns push-notification-style alerts to the operator
(currently Arash) when something happens in production that they need
to look at without opening the dashboard:

  * notify_job_failed   — fires from the runner when a job lands in
                          status=FAILED. Carries enough context to
                          triage on the spot from a phone (target,
                          mutations, compound, engine, error, plus a
                          short stack trace tail).
  * notify_user_report  — fires when a user clicks "Report issue" on a
                          failed job. Carries the user's free-form
                          comment plus the job context.

Both helpers use the same Telegram bot/chat as the public contact form
(TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID env vars). They're SYNC because
they're called from sync code paths — the runner's exception handler
and the request handler for /jobs/{share_id}/report. Sync httpx with a
short timeout is fine; we don't need parallelism for a single message.

If credentials are missing OR the POST fails, every helper logs and
returns False (never raises). A failure to notify must NOT take down
the operation that triggered it — a job that already failed shouldn't
also fail at the alert step.
"""
from __future__ import annotations

import logging
import os
import re
from typing import Iterable, Optional

import httpx

log = logging.getLogger(__name__)

TELEGRAM_API_BASE = "https://api.telegram.org"
TELEGRAM_TIMEOUT_S = 6.0


def _escape_html(s: str) -> str:
    """Same four-character HTML escape as routers/contact.py. We use
    HTML mode (not MarkdownV2) because MarkdownV2 escapes 17 characters
    and one missed dot crashes the whole message."""
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _truncate(s: str, n: int) -> str:
    """Soft cap a string to N chars with an explicit ellipsis suffix.
    Telegram's hard cap is 4096 chars per message — we keep individual
    fields short so the surrounding template never crowds them out."""
    if not s:
        return ""
    if len(s) <= n:
        return s
    return s[: n - 1] + "…"


def _send(text: str) -> bool:
    """Send one HTML-formatted message. Returns True on success, False
    on any failure (missing creds, malformed token, HTTP error, network
    timeout). Logs at WARNING for misconfig, ERROR for delivery
    failures so the operator can spot a broken alert pipeline in Fly
    logs even if they're not getting Telegram pings."""
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    chat_id = os.environ.get("TELEGRAM_CHAT_ID", "").strip()
    if not token or not chat_id:
        log.warning("Telegram alert skipped: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set")
        return False

    # Sanity-check the token shape so a misconfigured secret fails
    # loudly instead of leaking a long httpx error.
    if not re.match(r"^\d+:[A-Za-z0-9_-]{30,}$", token):
        log.error("Telegram alert skipped: TELEGRAM_BOT_TOKEN looks malformed")
        return False

    url = f"{TELEGRAM_API_BASE}/bot{token}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": True,
    }
    try:
        with httpx.Client(timeout=TELEGRAM_TIMEOUT_S) as client:
            r = client.post(url, json=payload)
        if r.status_code >= 400:
            log.error(
                "Telegram alert HTTP %d (token redacted): %s",
                r.status_code,
                r.text[:300],
            )
            return False
        return True
    except (httpx.TimeoutException, httpx.RequestError) as e:
        log.error("Telegram alert network error: %s", e)
        return False
    except Exception as e:
        log.exception("Telegram alert unexpected error: %s", e)
        return False


def notify_job_failed(
    *,
    job_id: int,
    share_id: str,
    pdb_id: str,
    mutations: str,
    engine: str,
    user_email: Optional[str],
    user_id: Optional[str],
    compound_summary: str,
    error_message: str,
    traceback_tail: Optional[str] = None,
) -> bool:
    """Fire-and-forget Telegram alert when a job lands in FAILED.

    Layout chosen so the most-useful triage info (job ID + error) sits
    at the top of the locked-screen notification preview. Stack trace
    goes last and gets truncated aggressively; we only need the bottom
    of the trace to know which line raised."""
    pdb_e = _escape_html(pdb_id or "—")
    muts_e = _escape_html(mutations or "WT only")
    engine_e = _escape_html(engine or "—")
    user_e = _escape_html(user_email or user_id or "—")
    compound_e = _escape_html(_truncate(compound_summary, 240))
    err_e = _escape_html(_truncate(error_message or "(no message)", 600))

    parts = [
        "❌ <b>Job FAILED</b>",
        "",
        f"🆔 Job: <code>{job_id}</code>  ·  share: <code>{_escape_html(share_id or '—')}</code>",
        f"🎯 Target: <b>{pdb_e}</b>  ·  variants: {muts_e}",
        f"⚙️ Engine: {engine_e}",
        f"🧪 Compounds: {compound_e}",
        f"👤 User: <code>{user_e}</code>",
        "",
        "💥 <b>Error:</b>",
        f"<code>{err_e}</code>",
    ]

    if traceback_tail:
        tb_e = _escape_html(_truncate(traceback_tail, 1000))
        parts.append("")
        parts.append("📜 <b>Stack tail:</b>")
        parts.append(f"<pre>{tb_e}</pre>")

    return _send("\n".join(parts))


def notify_sentry_alert(
    *,
    title: str,
    project: Optional[str] = None,
    env: Optional[str] = None,
    level: Optional[str] = None,
    culprit: Optional[str] = None,
    url: Optional[str] = None,
    action: Optional[str] = None,
) -> bool:
    """Fire when Sentry's "Issue Alert" / "Internal Integration"
    webhook reports a new error. Designed to be called from
    /internal/sentry-webhook with fields already extracted from
    Sentry's varying payload shapes (see routers/sentry_webhook.py
    for the shape-tolerant parser).

    Compact layout: emoji + title at the top so the locked-screen
    preview is useful. Project / env / level on one line each so
    they wrap cleanly on a phone screen. URL last with an explicit
    'Open in Sentry' anchor."""
    title_e = _escape_html(_truncate(title or "Sentry alert", 250))
    project_e = _escape_html(project) if project else None
    env_e = _escape_html(env) if env else None
    level_e = _escape_html(level) if level else None
    culprit_e = _escape_html(_truncate(culprit, 200)) if culprit else None
    action_e = _escape_html(action) if action else None
    url_e = _escape_html(url) if url else None

    parts = [f"🚨 <b>{title_e}</b>"]
    if project_e:
        parts.append(f"📦 Project: <code>{project_e}</code>")
    if env_e:
        parts.append(f"🌍 Env: <code>{env_e}</code>")
    if level_e:
        parts.append(f"⚠️ Level: <code>{level_e}</code>")
    if culprit_e:
        parts.append(f"📍 In: <code>{culprit_e}</code>")
    if action_e:
        parts.append(f"({action_e})")
    if url_e:
        parts.append(f'<a href="{url_e}">Open in Sentry</a>')

    return _send("\n".join(parts))


def notify_user_report(
    *,
    job_id: int,
    share_id: str,
    pdb_id: str,
    mutations: str,
    engine: str,
    job_status: str,
    user_email: Optional[str],
    user_id: Optional[str],
    user_comment: str,
    error_message: Optional[str],
) -> bool:
    """Fire when a user clicks "Report issue" on the JobPage and types
    a comment. Includes both the user's note and the job context so we
    can act without bouncing back and forth.

    The user's comment is prominent (top of the body) — that's the
    novel info; the job context is the supporting data so we don't
    have to look it up in the dashboard."""
    pdb_e = _escape_html(pdb_id or "—")
    muts_e = _escape_html(mutations or "WT only")
    engine_e = _escape_html(engine or "—")
    user_e = _escape_html(user_email or user_id or "—")
    status_e = _escape_html(job_status or "—")
    comment_e = _escape_html(_truncate(user_comment or "(empty)", 1500))
    err_e = _escape_html(_truncate(error_message or "—", 400))

    parts = [
        "📣 <b>User reported a job issue</b>",
        "",
        f"💬 <b>Comment:</b>",
        f"<i>{comment_e}</i>",
        "",
        f"👤 User: <code>{user_e}</code>",
        f"🆔 Job: <code>{job_id}</code>  ·  share: <code>{_escape_html(share_id or '—')}</code>  ·  status: {status_e}",
        f"🎯 Target: <b>{pdb_e}</b>  ·  variants: {muts_e}  ·  engine: {engine_e}",
        f"💥 Error: <code>{err_e}</code>",
    ]

    return _send("\n".join(parts))
