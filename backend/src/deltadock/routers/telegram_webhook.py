"""Telegram bot webhook — Approve / Deny inline-button callbacks.

Telegram pushes a JSON payload here every time the operator taps an
inline button on a notification (e.g. "✅ Approve" on a new-sign-up
alert). This handler flips the user's access_status, edits the original
message so the buttons disappear and the outcome is recorded, and
acknowledges the tap so the spinner goes away on the operator's phone.

Security model
--------------
Telegram allows configuring a secret token via setWebhook's
``secret_token`` parameter; Telegram then forwards it on every webhook
call in the ``X-Telegram-Bot-Api-Secret-Token`` header. We compare it
constant-time against TELEGRAM_WEBHOOK_SECRET. Any other caller is
rejected with 401. This is the only auth path — the endpoint is
otherwise unauthenticated, since Telegram has no way to send a JWT.

Idempotency
-----------
A callback can be re-delivered if Telegram doesn't get a quick 200 back.
We make the status flip itself idempotent (UPDATE ... WHERE access_status
!= target_status is a no-op when already flipped) so a double-tap or a
re-delivery can't accidentally toggle state back and forth.

Fail-soft
---------
EVERY error path returns 200 with an internal log line — Telegram retries
on non-2xx, and we'd rather log a problem than get hammered by retries
for a transient issue. The operator can always re-approve manually via
the admin web page if a webhook hiccup means the flip didn't happen.
"""
from __future__ import annotations

import hmac
import logging
import os
from typing import Any, Optional

from fastapi import APIRouter, Header, Request, status
from sqlalchemy import text
from sqlmodel import Session

from ..db import engine
from ..services import notifications as _notif

log = logging.getLogger(__name__)

router = APIRouter(prefix="/telegram", tags=["telegram"])


def _secret_ok(provided: Optional[str]) -> bool:
    """Constant-time compare the inbound X-Telegram-Bot-Api-Secret-Token
    header against TELEGRAM_WEBHOOK_SECRET. If the env var isn't set we
    refuse all calls — opening this endpoint without a secret would let
    anyone toggle approval state by guessing a user_id."""
    expected = os.environ.get("TELEGRAM_WEBHOOK_SECRET", "").strip()
    if not expected:
        log.error("Telegram webhook called but TELEGRAM_WEBHOOK_SECRET is not set — refusing")
        return False
    if not provided:
        return False
    return hmac.compare_digest(expected, provided.strip())


def _flip_status(user_id: str, target: str, actor: str) -> tuple[bool, str]:
    """Set user_profile.access_status to `target` for `user_id`. Returns
    (changed, current_email). ``changed`` is True only if the row was
    actually updated (no-op when already at target → False so we can
    short-circuit the message edit). Reads the user's email back so the
    edited Telegram message can show whose account was actioned."""
    target = target.lower()
    if target not in ("approved", "denied"):
        return False, ""
    try:
        with Session(engine) as s:
            # Look up the email first so we can show it in the confirmation
            # message even when the row was already at the target status
            # (re-delivery case).
            row = s.execute(
                text("SELECT email FROM auth.users WHERE id = :uid"),
                {"uid": user_id},
            ).first()
            user_email = (row[0] if row else "") or ""

            # Idempotent flip — no-op when already at target.
            res = s.execute(
                text(
                    "UPDATE public.user_profile "
                    "   SET access_status = :target, "
                    "       access_decided_at = now(), "
                    "       access_decided_by = :actor "
                    " WHERE user_id = :uid AND access_status IS DISTINCT FROM :target"
                ),
                {"target": target, "actor": actor[:80], "uid": user_id},
            )
            s.commit()
            return (res.rowcount or 0) > 0, user_email
    except Exception as e:  # noqa: BLE001
        log.exception("Telegram approve/deny DB error for user %s: %s", user_id, e)
        return False, ""


@router.post("/webhook", status_code=status.HTTP_200_OK)
async def telegram_webhook(
    req: Request,
    x_telegram_bot_api_secret_token: Optional[str] = Header(default=None),
) -> dict[str, Any]:
    """Handle inline-button taps from Telegram. We only care about
    callback_query events with our Approve/Deny callback_data; all other
    updates (text messages, /commands the bot doesn't implement, etc.)
    are acknowledged with 200 and ignored. ALWAYS return 200 — see the
    module docstring for the fail-soft rationale."""
    if not _secret_ok(x_telegram_bot_api_secret_token):
        # Don't return 401 because then Telegram retries hard. Return 200
        # with an error in the logs so the noise stays out of the bot's
        # delivery queue.
        log.warning("Telegram webhook: bad/missing secret token — ignoring")
        return {"ok": False, "ignored": "bad_secret"}

    try:
        body = await req.json()
    except Exception:  # noqa: BLE001
        log.warning("Telegram webhook: non-JSON body — ignoring")
        return {"ok": False, "ignored": "bad_json"}

    cbq = body.get("callback_query")
    if not cbq:
        # Some other update type — not ours to handle.
        return {"ok": True, "ignored": "no_callback_query"}

    data = (cbq.get("data") or "").strip()
    cbq_id = cbq.get("id") or ""
    msg = cbq.get("message") or {}
    chat_id = (msg.get("chat") or {}).get("id")
    message_id = msg.get("message_id")
    from_user = cbq.get("from") or {}
    actor = (
        from_user.get("username")
        or str(from_user.get("id") or "telegram")
    )

    if ":" not in data:
        _notif.answer_callback(cbq_id, "Unrecognized button.")
        return {"ok": True, "ignored": "bad_data"}

    action, _, user_id = data.partition(":")
    action = action.strip().lower()
    user_id = user_id.strip()
    if action not in ("approve", "deny") or not user_id:
        _notif.answer_callback(cbq_id, "Unknown action.")
        return {"ok": True, "ignored": "bad_action"}

    target_status = "approved" if action == "approve" else "denied"
    changed, user_email = _flip_status(user_id, target_status, actor)

    # Build the confirmation text that REPLACES the original notification.
    # Keep the user_id visible so the message remains a useful audit row.
    pretty = "APPROVED ✅" if action == "approve" else "DENIED ❌"
    email_line = f"\n📧 {user_email}" if user_email else ""
    note = "" if changed else "\n<i>(already in that state — no change)</i>"
    new_text = (
        f"<b>{pretty}</b> by <code>{actor}</code>"
        f"{email_line}"
        f"\n🆔 <code>{user_id}</code>"
        f"{note}"
    )

    # Edit the original notification (silently ignore if Telegram refuses,
    # e.g. message too old to edit) and acknowledge the tap.
    if chat_id is not None and message_id is not None:
        _notif.edit_message_after_action(chat_id, message_id, new_text)
    _notif.answer_callback(
        cbq_id,
        "Approved." if action == "approve" else "Denied.",
    )

    log.info("Telegram approve/deny: user=%s -> %s (changed=%s, by=%s)",
             user_id, target_status, changed, actor)
    return {"ok": True, "user_id": user_id, "status": target_status, "changed": changed}
