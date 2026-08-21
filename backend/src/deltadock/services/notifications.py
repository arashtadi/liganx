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


def _send(text: str, reply_markup: Optional[dict] = None) -> bool:
    """Send one HTML-formatted message. Returns True on success, False
    on any failure (missing creds, malformed token, HTTP error, network
    timeout). Logs at WARNING for misconfig, ERROR for delivery
    failures so the operator can spot a broken alert pipeline in Fly
    logs even if they're not getting Telegram pings.

    ``reply_markup`` optionally attaches a Telegram inline keyboard
    (e.g. for one-tap admin actions like Approve/Deny). Pass a plain
    dict in Telegram's documented JSON shape — see notify_new_user."""
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
    payload: dict = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": True,
    }
    if reply_markup is not None:
        payload["reply_markup"] = reply_markup
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


def _tg_post(method: str, payload: dict) -> bool:
    """POST to an arbitrary Telegram Bot API method using the same token
    + timeout + error handling as _send. Used by the /telegram/webhook
    handler to acknowledge callback_query presses and edit the original
    message after Approve/Deny. Returns True on 2xx, False otherwise —
    NEVER raises (notifying the operator must not crash a webhook)."""
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    if not token:
        return False
    if not re.match(r"^\d+:[A-Za-z0-9_-]{30,}$", token):
        log.error("Telegram %s skipped: TELEGRAM_BOT_TOKEN looks malformed", method)
        return False
    try:
        with httpx.Client(timeout=TELEGRAM_TIMEOUT_S) as client:
            r = client.post(f"{TELEGRAM_API_BASE}/bot{token}/{method}", json=payload)
        if r.status_code >= 400:
            log.warning("Telegram %s HTTP %d: %s", method, r.status_code, r.text[:200])
            return False
        return True
    except Exception as e:  # noqa: BLE001
        log.warning("Telegram %s failed: %s", method, e)
        return False


def answer_callback(callback_query_id: str, text: str = "") -> bool:
    """Dismiss the loading spinner on a tapped inline button and
    optionally show a short toast to the admin who tapped it."""
    return _tg_post("answerCallbackQuery", {
        "callback_query_id": callback_query_id,
        "text": text[:200],
        "show_alert": False,
    })


def edit_message_after_action(
    chat_id: int | str,
    message_id: int,
    new_text: str,
) -> bool:
    """After Approve/Deny is processed, rewrite the original notification
    so the buttons are gone and the message records the outcome — keeps
    the chat history a clean audit trail of who is approved when."""
    return _tg_post("editMessageText", {
        "chat_id": chat_id,
        "message_id": message_id,
        "text": new_text,
        "parse_mode": "HTML",
        "disable_web_page_preview": True,
        # Empty reply_markup removes the inline keyboard.
        "reply_markup": {"inline_keyboard": []},
    })


def notify_new_user(
    *,
    user_email: Optional[str],
    user_id: Optional[str],
    signup_method: Optional[str] = None,
    full_name: Optional[str] = None,
    organization: Optional[str] = None,
    role: Optional[str] = None,
) -> bool:
    """Fire when a brand-new user lands a row in user_profile for the
    first time. Should be called from update_my_profile's INSERT path
    OR from dismiss_onboarding when no profile row existed yet.

    Idempotency is the caller's responsibility (only call on the
    first-row-creation code path). We don't dedupe here because the
    helper is too low-level to know whether 'first' means first
    profile row, first job, first session, etc."""
    email_e = _escape_html(user_email or "—")
    name_e = _escape_html(full_name or "—") if full_name else None
    org_e = _escape_html(organization) if organization else None
    role_e = _escape_html(role) if role else None
    method_e = _escape_html(signup_method or "—")
    user_id_e = _escape_html(user_id or "—")

    parts = [
        "🎉 <b>New user signed up — awaiting approval</b>",
        "",
        f"📧 Email: <code>{email_e}</code>",
    ]
    if name_e and name_e != "—":
        parts.append(f"👤 Name: {name_e}")
    if org_e:
        parts.append(f"🏢 Org: {org_e}")
    if role_e:
        parts.append(f"💼 Role: {role_e}")
    parts.append(f"🔐 Method: <code>{method_e}</code>")
    parts.append(f"🆔 <code>{user_id_e}</code>")

    # Inline Approve / Deny buttons. callback_data is parsed by the
    # /telegram/webhook handler (see routers/telegram_webhook.py) which
    # flips user_profile.access_status. Telegram caps callback_data at
    # 64 bytes; a UUID is 36 chars so "approve:<uuid>" fits comfortably.
    # If user_id is missing (shouldn't happen — caller always provides
    # one) we omit the buttons rather than sending a broken callback.
    reply_markup: Optional[dict] = None
    if user_id:
        reply_markup = {
            "inline_keyboard": [[
                {"text": "✅ Approve", "callback_data": f"approve:{user_id}"},
                {"text": "❌ Deny",    "callback_data": f"deny:{user_id}"},
            ]],
        }
    return _send("\n".join(parts), reply_markup=reply_markup)


def notify_first_dock(
    *,
    job_id: int,
    share_id: str,
    user_email: Optional[str],
    user_id: Optional[str],
    pdb_id: str,
    mutations: str,
    engine: str,
    compound_summary: str,
) -> bool:
    """Fire when a user's first successful dock job lands COMPLETED.
    This is the activation signal — they got real value out of the
    product for the first time."""
    email_e = _escape_html(user_email or user_id or "—")
    pdb_e = _escape_html(pdb_id or "—")
    muts_e = _escape_html(mutations or "WT only")
    engine_e = _escape_html(engine or "—")
    compound_e = _escape_html(_truncate(compound_summary, 200))

    parts = [
        "🚀 <b>First successful dock — user activated!</b>",
        "",
        f"👤 User: <code>{email_e}</code>",
        f"🎯 Target: <b>{pdb_e}</b>  ·  variants: {muts_e}",
        f"⚙️ Engine: {engine_e}",
        f"🧪 Compounds: {compound_e}",
        f"🔗 Job: <code>{job_id}</code>  ·  share: <code>{_escape_html(share_id or '—')}</code>",
    ]
    return _send("\n".join(parts))


def notify_rate_limit_abuse(
    *,
    ip: str,
    scope: str,
    hits_in_window: int,
    window_minutes: int,
) -> bool:
    """Fire when an IP has racked up enough 429s to look like abuse
    (or a runaway client). Caller decides the threshold + dedupes via
    per-IP-per-hour suppression so this doesn't spam during sustained
    abuse — we only need to know it started."""
    ip_e = _escape_html(ip)
    scope_e = _escape_html(scope)
    parts = [
        "🛑 <b>Rate-limit abuse detected</b>",
        "",
        f"📍 IP: <code>{ip_e}</code>",
        f"🎯 Scope: <code>{scope_e}</code>",
        f"📊 {hits_in_window} hits in last {window_minutes} min",
        "",
        "<i>Notifications for this IP+scope are silenced for the next hour.</i>",
    ]
    return _send("\n".join(parts))


def notify_pod_down(
    *,
    reason: str,
    timeout_s: int,
) -> bool:
    """Fire when ensure_pod_ready can't get the pod healthy within its
    deadline. This usually means RunPod's allocation lost the GPU slot
    or the resume failed silently — needs operator attention because
    every Run Dock click in this state will fail."""
    reason_e = _escape_html(_truncate(reason, 300))
    parts = [
        "🟥 <b>GPU pod is unreachable</b>",
        "",
        f"⏱  Tried for {timeout_s}s",
        f"💥 {reason_e}",
        "",
        "User-facing Run Dock buttons are currently broken.",
        "Check RunPod console / Fly logs.",
    ]
    return _send("\n".join(parts))


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


def notify_fep_failed(
    *,
    fep_job_id: int,
    share_id: str,
    pdb_id: str,
    variant: str,
    user_email: Optional[str],
    user_id: Optional[str],
    hit_name: Optional[str],
    n_analogs: int,
    edges_completed: int,
    edges_total: int,
    error_message: str,
    error_kind: Optional[str] = None,
    cost_usd_so_far: Optional[float] = None,
) -> bool:
    """(M10) Fire-and-forget Telegram alert when a FEP study lands in
    FAILED state. Includes how much GPU time was consumed before the
    failure so the operator knows the dollar impact.

    Same layout philosophy as notify_job_failed — most-useful triage
    info at the top of the lock-screen notification preview."""
    pdb_e = _escape_html(pdb_id or "—")
    variant_e = _escape_html(variant or "WT")
    user_e = _escape_html(user_email or user_id or "—")
    hit_e = _escape_html(hit_name or "—")
    err_e = _escape_html(_truncate(error_message or "(no message)", 600))
    kind_e = _escape_html(error_kind or "runtime")

    cost_line = ""
    if cost_usd_so_far is not None:
        cost_line = f"💸 GPU spent so far: <b>${cost_usd_so_far:.2f}</b>"

    parts = [
        "❌ <b>FEP Study FAILED</b>",
        "",
        f"🆔 FEP id: <code>{fep_job_id}</code>  ·  share: <code>{_escape_html(share_id or '—')}</code>",
        f"🎯 Target: <b>{pdb_e}</b>  ·  variant: {variant_e}",
        f"🧪 Hit: <b>{hit_e}</b>  +  {n_analogs} analog(s)",
        f"📊 Progress: <b>{edges_completed}/{edges_total}</b> edges converged before crash",
        f"👤 User: <code>{user_e}</code>",
    ]
    if cost_line:
        parts.append(cost_line)
    parts.extend([
        "",
        f"💥 <b>Error</b> ({kind_e}):",
        f"<code>{err_e}</code>",
    ])

    return _send("\n".join(parts))


def notify_fep_pod_unhealthy(
    *,
    detail: str,
    pod_url: str,
) -> bool:
    """(M10) Fire when an FEP study fails because the pod is unreachable
    or /health returns deps_ok=false. Distinct from a per-edge failure
    because the action is different — operator needs to look at the pod,
    not at the user's molecule."""
    parts = [
        "⚠️ <b>FEP pod unhealthy</b>",
        "",
        f"🔗 Pod URL: <code>{_escape_html(pod_url)}</code>",
        "",
        f"📋 Detail: <code>{_escape_html(_truncate(detail, 500))}</code>",
        "",
        "🧰 Operator: SSH/web-terminal in, check fep_server process + /workspace/fep_server_boot.log",
    ]
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


def notify_auto_repair(
    *,
    fingerprint: str,
    outcome: str,
    triggered_by_title: Optional[str] = None,
) -> bool:
    """(U23) Fired immediately after the auto-repair dispatcher runs a
    repair in response to a Sentry alert. Sent as a follow-up message
    so the operator can see the alert *and* see what the bot did about
    it, in the same Telegram thread.

    `outcome` is the human-readable result string returned by the
    repair callable (e.g. "orphan FEP edges reaped: 3"). For
    cooldown-skipped / disabled outcomes, the message still goes out
    so the operator knows the bot saw the alert and chose not to act."""
    fp_e = _escape_html(fingerprint or "unknown")
    out_e = _escape_html(_truncate(outcome, 300))
    tb_e = _escape_html(_truncate(triggered_by_title, 180)) if triggered_by_title else None

    # Dry-run match (kill switch off) reads very differently from an
    # actual mutation — make the difference unmissable in the thread.
    if outcome == "dry_run_would_fire":
        parts = [
            f"👀 <b>Auto-repair DRY-RUN</b>: <code>{fp_e}</code> would have fired",
            "<i>(SENTRY_AUTO_REPAIR_ENABLED is off — no action taken)</i>",
        ]
    else:
        parts = [f"🔧 <b>Auto-repair fired</b>: <code>{fp_e}</code>", f"↳ {out_e}"]
    if tb_e:
        parts.append(f"<i>in response to:</i> {tb_e}")
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


# ─────────────────────────────────────────────────────────────────────
# Watched-user live activity monitor
# ─────────────────────────────────────────────────────────────────────
# When the operator wants a real-time feed of one specific user's
# activity (e.g. a high-touch demo user being onboarded), list their
# email in the WATCH_USER_EMAILS env var (comma-separated). Every login,
# dock submission, and dock result for a watched user then fires a
# Telegram ping to the same operator chat used everywhere else in this
# module. All helpers are side-effect only: they short-circuit to False
# for non-watched users and never raise.
import time as _time

_WATCH_DEFAULT = "konstantinnom@gmail.com"
_LOGIN_PING_GAP_S = 1800  # re-announce a login at most once per 30 min
_last_login_ping: dict[str, float] = {}


def _watched_emails() -> set[str]:
    """Lower-cased set of emails to watch. Defaults to the current demo
    user so the feature works out-of-the-box; override with the
    WATCH_USER_EMAILS secret (comma-separated) without a redeploy."""
    raw = os.environ.get("WATCH_USER_EMAILS", _WATCH_DEFAULT)
    return {e.strip().lower() for e in raw.split(",") if e.strip()}


def is_watched_user(email: Optional[str]) -> bool:
    if not email:
        return False
    return email.strip().lower() in _watched_emails()


def notify_watch_login(
    *,
    user_email: Optional[str],
    full_name: Optional[str] = None,
    org: Optional[str] = None,
    role: Optional[str] = None,
) -> bool:
    """Ping when a watched user's app is active (fires from the on-load
    access-status poll). Deduped per-email to once / 30 min so a polling
    frontend doesn't spam — in-memory, so a machine restart may emit one
    extra ping (acceptable)."""
    if not is_watched_user(user_email):
        return False
    key = user_email.strip().lower()  # type: ignore[union-attr]
    now = _time.time()
    if now - _last_login_ping.get(key, 0.0) < _LOGIN_PING_GAP_S:
        return False
    _last_login_ping[key] = now
    parts = [
        "👀 <b>Watched user is active</b>",
        "",
        f"👤 <code>{_escape_html(user_email or '—')}</code>",
    ]
    if full_name:
        parts.append(f"📛 {_escape_html(full_name)}")
    if org:
        parts.append(f"🏢 {_escape_html(org)}")
    if role:
        parts.append(f"💼 {_escape_html(role)}")
    parts.append("🟢 Signed in / app open")
    return _send("\n".join(parts))


def notify_watch_dock_started(
    *,
    user_email: Optional[str],
    pdb_id: str,
    mutations: str,
    engine: str,
    compound_summary: str,
    share_id: Optional[str] = None,
) -> bool:
    """Ping when a watched user submits a docking job."""
    if not is_watched_user(user_email):
        return False
    parts = [
        "🧬 <b>Watched user started a dock</b>",
        "",
        f"👤 <code>{_escape_html(user_email or '—')}</code>",
        f"🎯 Target: <b>{_escape_html(pdb_id or '—')}</b>  ·  variants: {_escape_html(mutations or 'WT only')}",
        f"⚙️ Engine: {_escape_html(engine or '—')}",
        f"🧪 Compounds: {_escape_html(_truncate(compound_summary or '—', 240))}",
    ]
    if share_id:
        parts.append(f"🔗 https://liganx.com/jobs/{_escape_html(share_id)}")
    return _send("\n".join(parts))


def notify_watch_dock_completed(
    *,
    user_email: Optional[str],
    pdb_id: str,
    mutations: str,
    engine: str,
    share_id: Optional[str],
    results_summary: str,
    duration_s: Optional[float] = None,
) -> bool:
    """Ping when a watched user's docking job lands COMPLETED, carrying
    the per-compound best scores so the operator sees the result without
    opening the app."""
    if not is_watched_user(user_email):
        return False
    parts = [
        "✅ <b>Watched user's dock finished</b>",
        "",
        f"👤 <code>{_escape_html(user_email or '—')}</code>",
        f"🎯 Target: <b>{_escape_html(pdb_id or '—')}</b>  ·  variants: {_escape_html(mutations or 'WT only')}",
        f"⚙️ Engine: {_escape_html(engine or '—')}",
    ]
    if duration_s is not None:
        parts.append(f"⏱ Took: <b>{duration_s:.0f}s</b>")
    parts += [
        "",
        "📊 <b>Best scores</b> (kcal/mol):",
        f"<code>{_escape_html(_truncate(results_summary or '(no results)', 1400))}</code>",
    ]
    if share_id:
        parts.append(f"🔗 https://liganx.com/jobs/{_escape_html(share_id)}")
    return _send("\n".join(parts))
