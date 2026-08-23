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


def _flip_boltz2(user_id: str, target: str, actor: str) -> tuple[bool, str]:
    """Per-feature twin of _flip_status: set user_profile.boltz2_access for
    `user_id` (approved/denied). Returns (changed, user_email). Idempotent —
    the WHERE clause makes a re-delivered tap a no-op."""
    target = target.lower()
    if target not in ("approved", "denied"):
        return False, ""
    try:
        with Session(engine) as s:
            row = s.execute(
                text("SELECT email FROM auth.users WHERE id = :uid"),
                {"uid": user_id},
            ).first()
            user_email = (row[0] if row else "") or ""
            res = s.execute(
                text(
                    "UPDATE public.user_profile "
                    "   SET boltz2_access = :target, "
                    "       boltz2_decided_at = now(), "
                    "       boltz2_decided_by = :actor "
                    " WHERE user_id = :uid AND boltz2_access IS DISTINCT FROM :target"
                ),
                {"target": target, "actor": actor[:80], "uid": user_id},
            )
            s.commit()
            return (res.rowcount or 0) > 0, user_email
    except Exception as e:  # noqa: BLE001
        log.exception("Telegram boltz2 approve/deny DB error for user %s: %s", user_id, e)
        return False, ""


# Generic per-feature access columns (migration 036/037). Allowlist — the
# column is interpolated into SQL below, so it must never be caller input.
_FEATURE_COLUMNS = {
    "boltz2": "boltz2_access",
    "gnina": "gnina_access",
    "screening": "screening_access",
}
_FEATURE_LABELS = {
    "boltz2": "Boltz-2",
    "gnina": "GNINA",
    "screening": "Virtual Screening",
}


def _flip_feature(feature: str, user_id: str, target: str, actor: str) -> tuple[bool, str]:
    """Generic twin of _flip_status: set user_profile.<feature>_access. Returns
    (changed, user_email). Idempotent via the IS DISTINCT FROM guard."""
    target = target.lower()
    col = _FEATURE_COLUMNS.get(feature)
    if target not in ("approved", "denied") or not col:
        return False, ""
    try:
        with Session(engine) as s:
            row = s.execute(
                text("SELECT email FROM auth.users WHERE id = :uid"),
                {"uid": user_id},
            ).first()
            user_email = (row[0] if row else "") or ""
            res = s.execute(
                text(
                    f"UPDATE public.user_profile SET {col} = :target "
                    f" WHERE user_id = :uid AND {col} IS DISTINCT FROM :target"
                ),
                {"target": target, "uid": user_id},
            )
            s.commit()
            return (res.rowcount or 0) > 0, user_email
    except Exception as e:  # noqa: BLE001
        log.exception("Telegram feature(%s) approve/deny DB error for %s: %s", feature, user_id, e)
        return False, ""


# How many extra free dockings a single "Grant" tap adds (out-of-runs flow).
_RUNS_GRANT = 20


def _grant_runs(user_id: str, amount: int) -> tuple[bool, str, Optional[int]]:
    """Bump a user's job_quota by `amount`, granting more free dockings.
    Returns (changed, user_email, new_quota). NB not idempotent across taps
    by design — each Grant adds another `amount`; the confirmation edit
    removes the buttons after the first tap so accidental double-grants need
    a deliberate re-tap. A Telegram re-delivery could double-grant, but we
    200 fast so that's rare and harmless (operator can adjust in /admin)."""
    try:
        with Session(engine) as s:
            row = s.execute(
                text("SELECT email FROM auth.users WHERE id = :uid"),
                {"uid": user_id},
            ).first()
            user_email = (row[0] if row else "") or ""
            res = s.execute(
                text(
                    "UPDATE public.user_profile "
                    "   SET job_quota = COALESCE(job_quota, 20) + :amt "
                    " WHERE user_id = :uid "
                    " RETURNING job_quota"
                ),
                {"amt": amount, "uid": user_id},
            ).first()
            if res is None:
                # No profile row yet — seed default (20) + the grant.
                s.execute(
                    text(
                        "INSERT INTO public.user_profile (user_id, job_quota) "
                        "VALUES (:uid, :q) "
                        "ON CONFLICT (user_id) DO UPDATE SET job_quota = EXCLUDED.job_quota"
                    ),
                    {"uid": user_id, "q": 20 + amount},
                )
                new_quota: Optional[int] = 20 + amount
            else:
                new_quota = int(res[0]) if res[0] is not None else None
            s.commit()
            return True, user_email, new_quota
    except Exception as e:  # noqa: BLE001
        log.exception("grant_runs DB error for user %s: %s", user_id, e)
        return False, "", None


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

    action, _, rest = data.partition(":")
    action = action.strip().lower()

    # More-free-runs grant/deny (out-of-runs modal). Distinct from access
    # approve/deny: Grant bumps job_quota instead of flipping a status.
    #   grn:<uid>  → grant +_RUNS_GRANT free dockings
    #   drn:<uid>  → deny (no state change, just record + acknowledge)
    if action in ("grn", "drn"):
        runs_uid = rest.strip()
        if not runs_uid:
            _notif.answer_callback(cbq_id, "Unknown action.")
            return {"ok": True, "ignored": "bad_runs_uid"}
        if action == "grn":
            granted, user_email, new_quota = _grant_runs(runs_uid, _RUNS_GRANT)
            if granted and user_email:
                try:
                    from ..services import email as _email
                    _email.notify_user_more_runs_granted(user_email=user_email, granted=_RUNS_GRANT)
                except Exception:  # noqa: BLE001
                    log.exception("more-runs granted email failed (non-fatal)")
            pretty = (f"➕ GRANTED +{_RUNS_GRANT} runs ✅" if granted
                      else "GRANT failed — check /admin ⚠️")
            ack = f"Granted +{_RUNS_GRANT} runs." if granted else "Grant failed."
            quota_line = (f"\n📊 New quota: <b>{new_quota}</b>"
                          if granted and new_quota is not None else "")
        else:
            try:
                with Session(engine) as _s:
                    _r = _s.execute(
                        text("SELECT email FROM auth.users WHERE id = :uid"),
                        {"uid": runs_uid},
                    ).first()
                user_email = (_r[0] if _r else "") or ""
            except Exception:  # noqa: BLE001
                user_email = ""
            pretty = "MORE RUNS DENIED ❌"
            ack = "Denied."
            quota_line = ""
        email_line = f"\n📧 {user_email}" if user_email else ""
        new_text = (
            f"<b>{pretty}</b> by <code>{actor}</code>"
            f"{email_line}"
            f"\n🆔 <code>{runs_uid}</code>"
            f"{quota_line}"
        )
        if chat_id is not None and message_id is not None:
            _notif.edit_message_after_action(chat_id, message_id, new_text)
        _notif.answer_callback(cbq_id, ack)
        log.info("Telegram more-runs: user=%s action=%s by=%s", runs_uid, action, actor)
        return {"ok": True, "user_id": runs_uid, "runs_action": action}

    # Resolve (feature, is_approve, user_id) from the callback_data:
    #   account:        approve|deny : <uid>          (feature=None → access_status)
    #   feature (new):  af|df : <feature> : <uid>     (generic, migrations 036/037)
    #   boltz2 (legacy): approve_bz2|deny_bz2 : <uid>
    feature: Optional[str] = None
    is_approve: Optional[bool] = None
    user_id = ""
    if action in ("af", "df"):
        is_approve = action == "af"
        feat, _, user_id = rest.partition(":")
        feature = feat.strip().lower()
        user_id = user_id.strip()
    else:
        user_id = rest.strip()
        _LEGACY = {
            "approve":     (None,     True),
            "deny":        (None,     False),
            "approve_bz2": ("boltz2", True),
            "deny_bz2":    ("boltz2", False),
        }
        if action in _LEGACY:
            feature, is_approve = _LEGACY[action]

    bad_feature = feature is not None and feature not in _FEATURE_COLUMNS
    if is_approve is None or not user_id or bad_feature:
        _notif.answer_callback(cbq_id, "Unknown action.")
        return {"ok": True, "ignored": "bad_action"}

    target_status = "approved" if is_approve else "denied"
    if feature is None:
        changed, user_email = _flip_status(user_id, target_status, actor)
    else:
        changed, user_email = _flip_feature(feature, user_id, target_status, actor)

    # Email the user so they know — fail-soft, and only on a real state change
    # (re-deliveries shouldn't re-spam).
    if changed and user_email:
        try:
            from ..services import email as _email
            if feature is None:
                (_email.notify_user_approved if is_approve
                 else _email.notify_user_denied)(user_email=user_email)
            else:
                (_email.notify_user_feature_approved if is_approve
                 else _email.notify_user_feature_denied)(feature=feature, user_email=user_email)
        except Exception:  # noqa: BLE001
            log.exception("user-approval email failed (non-fatal)")

    # Build the confirmation text that REPLACES the original notification.
    # Keep the user_id visible so the message remains a useful audit row.
    _flabel = "" if feature is None else (_FEATURE_LABELS.get(feature, feature) + " ")
    pretty = (f"{_flabel}APPROVED ✅" if is_approve else f"{_flabel}DENIED ❌")
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
        "Approved." if is_approve else "Denied.",
    )

    log.info("Telegram approve/deny: user=%s -> %s (changed=%s, by=%s)",
             user_id, target_status, changed, actor)
    return {"ok": True, "user_id": user_id, "status": target_status, "changed": changed}
