"""Transactional email via Resend.

Used for two flows right now:
  * Admin sign-up alert  — every new sign-up, parallel to the Telegram
                            notification (services/notifications.py).
                            Belt-and-braces in case admin's phone is muted.
  * User-approved notice — sent to the new user the moment admin flips
                            their access_status to 'approved' (via Telegram
                            webhook or /admin/users/{id}/access). Lets a
                            user who closed the tab know they can come back.

Design rules:
  * **Fail-soft.** Every public function swallows exceptions and logs at
    INFO. A delivery failure must NEVER break the operation that
    triggered it (a sign-up's profile insert, an admin approve tap, etc.).
  * **Config-gated.** When RESEND_API_KEY is unset every helper returns
    False without raising — dev environments and pre-Resend-rollout
    deployments stay silent.
  * **Plaintext + light HTML.** Keep templates inline + small. No
    markup library, no theming. Update copy by editing this file.
  * **From: address** is derived from EMAIL_FROM env (e.g.
    "Liganx <noreply@liganx.com>"). Domain MUST be Resend-verified or
    the API returns 403 — we log the error so misconfig surfaces
    immediately in Fly logs without crashing anything.
"""
from __future__ import annotations

import logging
import os
from typing import Optional

import httpx

log = logging.getLogger(__name__)

RESEND_API = "https://api.resend.com/emails"
RESEND_TIMEOUT_S = 8.0


def _is_configured() -> bool:
    return bool(os.environ.get("RESEND_API_KEY", "").strip())


def _default_from() -> str:
    """From: header. Override via EMAIL_FROM env. The display name keeps
    the email recognisable in inbox previews; noreply@ signals it's
    transactional, not a conversational thread."""
    return os.environ.get("EMAIL_FROM", "Liganx <noreply@liganx.com>").strip()


def _send(*, to: str, subject: str, html: str, reply_to: Optional[str] = None) -> bool:
    """Low-level send. Returns True on 2xx, False on any failure
    (missing key, HTTP error, network). Never raises."""
    api_key = os.environ.get("RESEND_API_KEY", "").strip()
    if not api_key:
        log.info("Resend skipped — RESEND_API_KEY not set (to=%s)", to)
        return False
    if not to or "@" not in to:
        log.warning("Resend skipped — invalid recipient: %r", to)
        return False

    payload: dict = {
        "from": _default_from(),
        "to": [to],
        "subject": subject,
        "html": html,
    }
    if reply_to:
        payload["reply_to"] = reply_to

    try:
        with httpx.Client(timeout=RESEND_TIMEOUT_S) as client:
            r = client.post(
                RESEND_API,
                json=payload,
                headers={"Authorization": f"Bearer {api_key}"},
            )
        if r.status_code >= 400:
            # 403 here almost always means the From: domain isn't verified
            # on Resend — log the body so the operator can fix it via the
            # Resend dashboard without digging.
            log.warning(
                "Resend HTTP %d (to=%s, from=%s): %s",
                r.status_code, to, _default_from(), r.text[:300],
            )
            return False
        return True
    except (httpx.TimeoutException, httpx.RequestError) as e:
        log.warning("Resend network error (to=%s): %s", to, e)
        return False
    except Exception as e:  # noqa: BLE001
        log.exception("Resend unexpected error (to=%s): %s", to, e)
        return False


def _admin_email() -> str:
    """The admin who receives sign-up notifications. Same env var auth.py
    uses for the admin gate; cheap import-free read."""
    return os.environ.get("ADMIN_EMAIL", "").strip()


# ─── Public API ────────────────────────────────────────────────────────

def notify_admin_new_signup(
    *,
    user_email: Optional[str],
    user_id: Optional[str],
    full_name: Optional[str] = None,
    organization: Optional[str] = None,
    role: Optional[str] = None,
) -> bool:
    """Email the admin when a brand-new user signs up. Parallel to the
    Telegram notification — the admin gets both, so a muted phone or a
    dead Telegram doesn't stop them from being aware. The Telegram
    message is the actionable one (it has Approve/Deny buttons); this
    email is just a heads-up + a deep link to the admin page."""
    admin_to = _admin_email()
    if not admin_to:
        log.info("notify_admin_new_signup skipped — ADMIN_EMAIL not set")
        return False
    if not _is_configured():
        return False

    rows = []
    rows.append(f"<tr><td><b>Email</b></td><td><code>{user_email or '—'}</code></td></tr>")
    if full_name:
        rows.append(f"<tr><td><b>Name</b></td><td>{full_name}</td></tr>")
    if organization:
        rows.append(f"<tr><td><b>Org</b></td><td>{organization}</td></tr>")
    if role:
        rows.append(f"<tr><td><b>Role</b></td><td>{role}</td></tr>")
    if user_id:
        rows.append(f"<tr><td><b>User ID</b></td><td><code>{user_id}</code></td></tr>")

    html = f"""
    <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 520px; margin: 0 auto;">
      <h2 style="color: #0f172a;">🎉 New Liganx sign-up</h2>
      <p style="color: #475569;">Awaiting your approval. Tap Approve in Telegram for one-tap action, or open the admin page:</p>
      <p><a href="https://liganx.com/admin" style="background: #0ea5e9; color: #fff; padding: 8px 14px; border-radius: 6px; text-decoration: none;">Open admin page</a></p>
      <table cellpadding="6" style="border-collapse: collapse; margin-top: 16px; font-size: 14px; color: #1e293b;">
        {''.join(rows)}
      </table>
      <p style="color: #94a3b8; font-size: 12px; margin-top: 24px;">
        You're getting this because you're the Liganx admin (ADMIN_EMAIL).
        The user cannot dock until you approve.
      </p>
    </div>
    """
    return _send(
        to=admin_to,
        subject=f"[Liganx] New sign-up · {user_email or 'unknown'} — awaiting approval",
        html=html,
    )


def notify_user_approved(*, user_email: Optional[str]) -> bool:
    """Email the user when their account flips to 'approved'. Triggered
    from the Telegram-webhook callback handler AND from the admin
    PATCH /admin/users/{id}/access endpoint, so both approval paths
    deliver the same email. Lets a user who closed the tab know to
    come back."""
    if not user_email or "@" not in user_email or not _is_configured():
        return False
    html = """
    <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 520px; margin: 0 auto;">
      <h2 style="color: #0f172a;">Your Liganx account is approved 🎉</h2>
      <p style="color: #475569;">
        You're in. You can sign back into Liganx and start docking right away.
      </p>
      <p>
        <a href="https://liganx.com/studio"
           style="background: #0ea5e9; color: #fff; padding: 10px 16px; border-radius: 6px; text-decoration: none;">
          Open Studio →
        </a>
      </p>
      <p style="color: #94a3b8; font-size: 12px; margin-top: 24px;">
        Liganx is currently invite-only to keep GPU costs sustainable.
        Thanks for your patience — and have fun.
      </p>
    </div>
    """
    return _send(
        to=user_email,
        subject="Your Liganx account is approved",
        html=html,
    )


def notify_user_denied(*, user_email: Optional[str]) -> bool:
    """Email the user when their account is denied. Same trigger points
    as notify_user_approved. Keeps the messaging polite and gives them
    a contact link if it was a mistake."""
    if not user_email or "@" not in user_email or not _is_configured():
        return False
    html = """
    <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 520px; margin: 0 auto;">
      <h2 style="color: #0f172a;">About your Liganx account</h2>
      <p style="color: #475569;">
        Thanks for signing up. We're not able to grant your account access
        to the live docking platform right now — Liganx is invite-only
        while we keep GPU costs sustainable.
      </p>
      <p style="color: #475569;">
        If you think this was a mistake or you'd like to request access,
        please reach out via <a href="https://liganx.com/contact">the contact page</a>.
      </p>
    </div>
    """
    return _send(
        to=user_email,
        subject="About your Liganx account",
        html=html,
    )
