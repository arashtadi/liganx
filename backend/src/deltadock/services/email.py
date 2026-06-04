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
    # Branded, email-client-safe template: table layout + inline styles only
    # (no external CSS/JS — clients strip them), ~560px, dark gradient header
    # + light body + gradient CTA. Mirrors the Liganx violet→blue brand.
    html = """
    <div style="background:#0b1020;padding:32px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,0.25);">
        <tr><td style="background:linear-gradient(135deg,#6d28d9 0%,#2563eb 100%);padding:28px 32px;">
          <div style="font-family:'SF Mono',ui-monospace,Menlo,monospace;font-size:20px;font-weight:700;letter-spacing:3px;color:#ffffff;">LIGANX</div>
          <div style="color:rgba(255,255,255,0.85);font-size:13px;margin-top:5px;">Mutation-aware molecular docking</div>
        </td></tr>
        <tr><td style="padding:32px;">
          <div style="display:inline-block;background:#ecfdf5;color:#047857;font-size:12px;font-weight:600;padding:5px 12px;border-radius:999px;">&#10003; Account approved</div>
          <h1 style="color:#0f172a;font-size:24px;margin:16px 0 8px;">You're in &#127881;</h1>
          <p style="color:#475569;font-size:15px;line-height:1.65;margin:0 0 22px;">
            Your Liganx account is approved. Sign in and start docking right away &mdash; pick a target and mutation, add a molecule, and dock it against the wild-type and mutant pockets in seconds on GPU.
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 26px;"><tr><td style="border-radius:10px;background:linear-gradient(135deg,#6d28d9,#2563eb);">
            <a href="https://liganx.com/studio" style="display:inline-block;padding:13px 30px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">Open Studio &rarr;</a>
          </td></tr></table>
          <div style="border-top:1px solid #e2e8f0;padding-top:20px;">
            <div style="color:#0f172a;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;margin-bottom:12px;">Get started in 30 seconds</div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr><td style="padding:5px 0;color:#475569;font-size:14px;line-height:1.5;"><b style="color:#6d28d9;">1.</b>&nbsp;&nbsp;Pick a target &amp; mutation &mdash; e.g. EGFR T790M</td></tr>
              <tr><td style="padding:5px 0;color:#475569;font-size:14px;line-height:1.5;"><b style="color:#6d28d9;">2.</b>&nbsp;&nbsp;Add a molecule by name or SMILES</td></tr>
              <tr><td style="padding:5px 0;color:#475569;font-size:14px;line-height:1.5;"><b style="color:#6d28d9;">3.</b>&nbsp;&nbsp;Run the GPU dock &mdash; compare wild-type vs mutant scores</td></tr>
            </table>
          </div>
        </td></tr>
        <tr><td style="background:#f8fafc;padding:20px 32px;border-top:1px solid #e2e8f0;">
          <p style="color:#94a3b8;font-size:12px;line-height:1.55;margin:0;">
            Liganx is invite-only while we keep GPU costs sustainable. Questions? Reply to this email or visit <a href="https://liganx.com/contact" style="color:#6d28d9;text-decoration:none;">liganx.com/contact</a>.
          </p>
        </td></tr>
      </table>
    </div>
    """
    return _send(
        to=user_email,
        subject="Welcome to Liganx — your account is approved 🎉",
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
