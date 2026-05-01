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
MAX_AFFILIATION = 200
MAX_COUNTRY = 100

# Allowed role buckets — the frontend constrains this with a <select>,
# but we revalidate server-side so a tampered client can't shove
# arbitrary text into the Telegram body. "" is allowed for the
# pre-rollout case where an older bundle hasn't been redeployed yet
# and is still POSTing without the new field; we surface "—" in the
# message instead of failing the whole submission.
ALLOWED_ROLES = {"", "student", "academic", "industry", "other"}
ROLE_LABELS = {
    "student": "Student",
    "academic": "Academic researcher",
    "industry": "Industry / professional",
    "other": "Other",
}


class ContactSubmission(BaseModel):
    """Payload from the public contact form.

    `website` is the honeypot — a real human leaves it blank because
    the field is hidden from the rendered DOM. If it shows up filled,
    we silently accept and discard.

    `turnstile_token` is the Cloudflare Turnstile widget's challenge
    response. Required when TURNSTILE_SECRET_KEY is set in env (prod);
    optional when not set (local dev where the user hasn't bothered
    setting up Turnstile keys).
    """

    name: str = Field(..., min_length=1, max_length=MAX_NAME)
    email: EmailStr
    message: str = Field(..., min_length=MIN_MESSAGE, max_length=MAX_MESSAGE)
    # Who-are-you fields — populated by the new ContactPage form so each
    # Telegram notification arrives with the context needed to triage on
    # the spot (esp. Boltz-2 access requests). Defaults are empty
    # strings so an older frontend bundle (pre-roll-out) can still POST
    # successfully — we just show "—" placeholders in the Telegram body.
    # Constrained to a known set server-side so a tampered client can't
    # inject arbitrary text into the role field.
    role: str = Field(default="", max_length=32)
    # When role == 'other', the frontend reveals a free-text input for
    # the user's actual role. Stored unconstrained (max 200 char) and
    # appended to the role line in the Telegram body for triage.
    role_other: str = Field(default="", max_length=200)
    affiliation: str = Field(default="", max_length=MAX_AFFILIATION)
    country: str = Field(default="", max_length=MAX_COUNTRY)
    # Optional honeypot — bots fill every input they find; humans don't
    # see this one. Default empty string so legitimate clients don't
    # need to know it exists.
    website: str = Field(default="", max_length=500)
    # Cloudflare Turnstile token — verified server-side by POSTing to
    # https://challenges.cloudflare.com/turnstile/v0/siteverify with
    # the secret key. ~2KB tokens are typical; we cap at 4KB to be
    # forgiving of future format changes from Cloudflare.
    turnstile_token: str = Field(default="", max_length=4096)


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


def _ua_emoji(ua: str | None) -> str:
    """Pick a one-emoji glyph for the user's browser/OS so the metadata
    line scans at a glance on a locked phone screen. Best-effort — UA
    strings are notoriously unreliable, but the worst case is the
    fallback laptop emoji which is honest about the uncertainty."""
    if not ua:
        return "💻"
    u = ua.lower()
    if "iphone" in u or "ipad" in u or "ios" in u:
        return "📱"
    if "android" in u:
        return "📱"
    if "mac os" in u or "macintosh" in u:
        return "🍎"
    if "windows" in u:
        return "🪟"
    if "linux" in u:
        return "🐧"
    if "bot" in u or "crawler" in u or "spider" in u:
        return "🤖"
    return "💻"


def _format_telegram_message(sub: ContactSubmission, ip: str, ua: str | None) -> str:
    """Build the HTML-formatted Telegram message body. Layout chosen so
    the FROM line sits at the top of the notification preview on a
    locked phone — `Name <email>` is the most useful 'who is this'
    summary, and emojis at the start of each line give a glanceable
    icon column even before the labels register.

    Role / affiliation / country are surfaced as a compact metadata
    line below the email so the triage decision (accept Boltz-2
    request? respond fast vs. queue?) can happen from the
    notification preview without opening the chat."""
    name_e = _escape_html(sub.name)
    email_e = _escape_html(str(sub.email))
    message_e = _escape_html(sub.message)
    ua_e = _escape_html(ua or "—")
    device = _ua_emoji(ua)

    # Role label — fall back to the raw value if it's an unknown bucket
    # (shouldn't happen given client + server validation, but cheaper
    # than crashing on KeyError). Empty role = older bundle, show "—".
    role_label = ROLE_LABELS.get(sub.role, sub.role) or "—"
    # Append the user's "Other — please specify" text when present so the
    # Telegram body shows e.g. "Other — Pharmaceutical formulation specialist"
    # instead of the unhelpful bare "Other".
    if sub.role == "other" and sub.role_other.strip():
        role_label = f"Other — {sub.role_other.strip()}"
    role_e = _escape_html(role_label)
    affiliation_e = _escape_html(sub.affiliation) if sub.affiliation else "—"
    country_line = (
        f"🌍 <b>Country:</b> {_escape_html(sub.country)}\n" if sub.country else ""
    )

    return (
        f"🎉 <b>New message from liganx.com!</b> 📬\n"
        f"\n"
        f"👤 <b>From:</b> {name_e}\n"
        f"✉️ <b>Email:</b> <code>{email_e}</code>\n"
        f"🎓 <b>Role:</b> {role_e}\n"
        f"🏛 <b>Affiliation:</b> {affiliation_e}\n"
        f"{country_line}"
        f"\n"
        f"💬 <b>Message:</b>\n"
        f"{message_e}\n"
        f"\n"
        f"<i>📍 {ip}  ·  {device} {ua_e}</i>"
    )


TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"


async def _verify_turnstile(token: str, client_ip: str) -> tuple[bool, str | None]:
    """Verify a Turnstile challenge token with Cloudflare.

    Returns (passed, error_message_for_logging).

    If TURNSTILE_SECRET_KEY isn't set in env we skip the check entirely
    and treat all submissions as passing — this lets local dev work
    without Cloudflare credentials, and lets us ship the integration
    BEFORE the real keys are loaded into Fly secrets without breaking
    the contact form mid-rollout.

    Cloudflare's siteverify is itself an HTTP call; we give it 5s. On
    timeout / network failure we fail OPEN (treat as passing) and log
    loudly. The reason: the upstream Telegram delivery still happens,
    so the spam still reaches Arash's phone — but he gets it instead
    of legitimate users being silently blocked because Cloudflare had
    a 30-second blip. Trade-off favors availability over perfect spam
    filtering, given honeypot + rate-limit are still active layers.
    """
    secret = os.environ.get("TURNSTILE_SECRET_KEY", "").strip()
    if not secret:
        # No Turnstile configured — passthrough. Logged at startup
        # via the same "credentials missing" path so the operator
        # knows the form is unprotected by CAPTCHA.
        return True, None

    if not token:
        # Server-enforced: when Turnstile IS configured, the token
        # field must be present. Empty token = treat as bot.
        return False, "missing turnstile token"

    payload = {
        "secret": secret,
        "response": token,
        # remoteip is recommended by Cloudflare so they can correlate
        # the challenge with the client. Optional — the verify call
        # works without it but is slightly less accurate.
        "remoteip": client_ip,
    }
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.post(TURNSTILE_VERIFY_URL, data=payload)
        if r.status_code != 200:
            log.warning("Turnstile siteverify HTTP %d: %s", r.status_code, r.text[:200])
            return True, f"siteverify HTTP {r.status_code} (failing open)"
        body = r.json()
    except (httpx.TimeoutException, httpx.RequestError) as e:
        log.warning("Turnstile siteverify network error (failing open): %s", e)
        return True, f"siteverify network error: {e!r} (failing open)"
    except Exception as e:
        log.exception("Turnstile siteverify unexpected error (failing open): %s", e)
        return True, f"siteverify unexpected error (failing open)"

    if body.get("success") is True:
        return True, None
    # Cloudflare returns error-codes as a list; common ones include
    # "invalid-input-response" (token tampered or expired),
    # "timeout-or-duplicate" (already-redeemed token), and
    # "missing-input-secret" (server misconfig). We log the codes
    # so a real spam wave is debuggable but only return a generic
    # message to the user — same response for all failure modes so
    # spammers can't probe for rule edges.
    err_codes = body.get("error-codes") or []
    log.info("Turnstile rejected: codes=%s ip=%s", err_codes, client_ip)
    return False, f"rejected: {err_codes}"


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
    ip = _client_ip(request)

    # Reject role values outside the known set so a tampered client
    # can't inject arbitrary text into the Telegram body. Empty is
    # allowed (older bundle compatibility); anything else must match
    # the frontend select. Generic 422-equivalent so we don't leak
    # which field tripped the check.
    if submission.role not in ALLOWED_ROLES:
        log.info("Contact: rejected unknown role=%r ip=%s", submission.role, ip)
        raise HTTPException(
            status_code=400,
            detail="Invalid form submission. Please refresh the page and try again.",
        )

    # Honeypot: a non-empty `website` is almost certainly a bot. We log
    # so we know our defences are working, but reply with a normal
    # success so the bot doesn't adapt.
    if submission.website.strip():
        log.info(
            "Contact honeypot triggered: ip=%s website=%r",
            ip,
            submission.website[:80],
        )
        return ContactResponse(accepted=True)

    # Cloudflare Turnstile CAPTCHA verification. When the server is
    # configured with a TURNSTILE_SECRET_KEY this is enforced; without
    # it (local dev) we passthrough so testing still works. We hit
    # this BEFORE the Telegram POST so a failed CAPTCHA never costs
    # us a notification on Arash's phone.
    passed, why = await _verify_turnstile(submission.turnstile_token, ip)
    if not passed:
        log.info("Contact CAPTCHA failed: ip=%s why=%s", ip, why)
        # 400 (not 403) so the frontend reads it as a fixable
        # validation error rather than an authorization issue.
        # Generic message — don't tell spammers which check failed.
        raise HTTPException(
            status_code=400,
            detail="Couldn't verify you're human. Please refresh and try again.",
        )

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
