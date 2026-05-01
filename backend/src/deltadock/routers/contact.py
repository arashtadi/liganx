"""POST /contact — accepts a contact-form submission and forwards it to
Telegram so Arash gets a push notification on his phone whenever a real
human (or a bot that beat our defences) reaches out through liganx.com.

Why Telegram and not email?
 - Push notifications are immediate and free, no SMTP infra to babysit.
 - The bot inbox is searchable and survives tab churn.
 - Hitting the Telegram API is one HTTP call with no auth handshake;
   adding email would mean a SMTP secret, a deliverability story, and
   one more thing that breaks silently when DNS records drift.

Anti-spam strategy:
 - Honeypot field: the form ships a hidden text input named "website".
   Real browsers leave it empty (CSS `display:none`, autofocus prevented);
   most form-spam bots fill every input they find. If `website` is non-empty
   we 200 OK with `accepted: true` so the bot never learns its trick failed,
   but we drop the message instead of forwarding it.
 - Per-IP rate limit: 5 submissions per hour per IP via CONTACT_LIMIT.
   Each submission becomes a Telegram notification on Arash's phone, so
   the cost of letting spam through is real (notification fatigue), not
   just bandwidth.

If the Telegram credentials aren't configured (TELEGRAM_BOT_TOKEN /
TELEGRAM_CHAT_ID env missing), we don't 500 — we log loudly and 503 with
a friendly message so the form still feels alive in dev. The frontend
surfaces the message body as an inline error so the page never feels
broken even mid-rollout.
"""

from __future__ import annotations

import logging
import os
import re
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field

from ..services.rate_limit import CONTACT_LIMIT

log = logging.getLogger(__name__)

router = APIRouter(prefix="/contact", tags=["contact"])

# Telegram's sendMessage API is permissive about HTML formatting but only
# accepts a small whitelist of tags (b, i, u, s, code, pre, a). We keep
# the formatting minimal so escaping stays simple.
TELEGRAM_API_BASE = "https://api.telegram.org"

# Hard caps — backend rejects payloads outside these bounds before we
# even try to format them for Telegram. Telegram itself caps message
# length at 4096 chars; our bound on `message` (5000) leaves headroom
# for the surrounding template.
MAX_NAME = 100
MAX_MESSAGE = 5000
MIN_MESSAGE = 10


class ContactSubmission(BaseModel):
    """Payload from the public contact form.

    `website` is the honeypot — a real human leaves it blank because
    the field is hidden from the rendered DOM. If it shows up filled,
    we silently accept and discard.
    """

    name: str = Field(..., min_length=1, max_length=MAX_NAME)
    email: EmailStr
    message: str = Field(..., min_length=MIN_MESSAGE, max_length=MAX_MESSAGE)
    # Optional honeypot — bots fill every input they find; humans don't
    # see this one. Default empty string so legitimate clients don't
    # need to know it exists.
    website: str = Field(default="", max_length=500)


class ContactResponse(BaseModel):
    accepted: bool
    """True if we either forwarded the message OR silently swallowed it
    (honeypot hit). The client gets an indistinguishable success in both
    cases so spam tooling can't probe whether the honeypot caught it."""


def _client_ip(request: Request) -> str:
    """Mirror of services.rate_limit._client_ip — duplicated so we can
    log it on the Telegram message without importing private symbols."""
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    real = request.headers.get("x-real-ip")
    if real:
        return real.strip()
    return request.client.host if request.client else "unknown"


def _escape_html(s: str) -> str:
    """Escape the four characters Telegram HTML mode treats as markup.
    We use HTML rather than MarkdownV2 because MarkdownV2 escapes ~17
    characters and a single missed dot crashes the entire message."""
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _format_telegram_message(sub: ContactSubmission, ip: str, ua: str | None) -> str:
    """Build the HTML-formatted Telegram message body. Layout chosen so
    the FROM line sits at the top of the notification preview on a
    locked phone — `Name <email>` is the most useful 'who is this'
    summary."""
    name_e = _escape_html(sub.name)
    email_e = _escape_html(str(sub.email))
    message_e = _escape_html(sub.message)
    ua_e = _escape_html(ua or "—")
    return (
        f"<b>📨 New contact form message</b>\n"
        f"\n"
        f"<b>From:</b> {name_e} &lt;{email_e}&gt;\n"
        f"<b>IP:</b> <code>{ip}</code>\n"
        f"<b>UA:</b> <code>{ua_e}</code>\n"
        f"\n"
        f"<b>Message:</b>\n"
        f"{message_e}"
    )


async def _send_to_telegram(text: str) -> None:
    """Fire one POST at the Telegram bot API. Raises on misconfigured
    credentials so the caller can return a friendly 503; raises on
    HTTP errors from Telegram so we can log and 502."""
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    chat_id = os.environ.get("TELEGRAM_CHAT_ID", "").strip()
    if not token or not chat_id:
        raise RuntimeError(
            "TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is not set in env"
        )

    # Telegram bot tokens look like 1234567890:AAH... — we sanity-check
    # the shape so a misconfigured secret fails loudly instead of
    # leaking a long error trace from httpx.
    if not re.match(r"^\d+:[A-Za-z0-9_-]{30,}$", token):
        raise RuntimeError("TELEGRAM_BOT_TOKEN looks malformed")

    url = f"{TELEGRAM_API_BASE}/bot{token}/sendMessage"
    payload: dict[str, Any] = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML",
        # Disable link previews so a URL in the message body doesn't
        # generate a giant Telegram unfurl card on the user's phone.
        "disable_web_page_preview": True,
    }
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.post(url, json=payload)
    if r.status_code >= 400:
        # Don't include the bot token in the log — it's in the URL we
        # just hit but we deliberately scrub before logging.
        log.error(
            "Telegram sendMessage failed: status=%d body=%s",
            r.status_code,
            r.text[:500],
        )
        raise HTTPException(
            status_code=502,
            detail="Failed to deliver message; please try again later.",
        )


@router.post(
    "",
    response_model=ContactResponse,
    dependencies=[Depends(CONTACT_LIMIT)],
)
async def submit_contact(
    submission: ContactSubmission,
    request: Request,
) -> ContactResponse:
    # Honeypot: a non-empty `website` is almost certainly a bot. We log
    # so we know our defences are working, but reply with a normal
    # success so the bot doesn't adapt.
    if submission.website.strip():
        log.info(
            "Contact honeypot triggered: ip=%s website=%r",
            _client_ip(request),
            submission.website[:80],
        )
        return ContactResponse(accepted=True)

    ip = _client_ip(request)
    ua = request.headers.get("user-agent")
    text = _format_telegram_message(submission, ip=ip, ua=ua)

    try:
        await _send_to_telegram(text)
    except RuntimeError as e:
        # Misconfigured credentials — still return a sensible message
        # to the user so the page doesn't look broken.
        log.error("Contact form: Telegram not configured: %s", e)
        raise HTTPException(
            status_code=503,
            detail="Contact form delivery is temporarily unavailable. Please try again in a few minutes.",
        )

    log.info("Contact form delivered: from=%s ip=%s", submission.email, ip)
    return ContactResponse(accepted=True)
