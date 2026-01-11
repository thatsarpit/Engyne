from __future__ import annotations

import logging
from typing import Iterable

import requests

from engyne_api.settings import Settings

logger = logging.getLogger(__name__)


def _render_invite_email(
    settings: Settings,
    to_email: str,
    slot_ids: Iterable[str],
    invited_by: str | None,
) -> tuple[str, str, str]:
    dashboard_url = str(settings.public_dashboard_base_url).rstrip("/")
    slots_text = ", ".join(sorted(slot_ids))
    inviter_line = f"Invited by: {invited_by}" if invited_by else "Invited by: Engyne Admin"

    subject = "You're invited to Engyne"
    text = (
        "Welcome to Engyne.\n\n"
        f"You have been granted access to slots: {slots_text}\n"
        f"{inviter_line}\n\n"
        f"Sign in here: {dashboard_url}\n\n"
        "If access is denied, ask your admin to allowlist this email."
    )
    html = (
        "<div style=\"font-family:Arial,sans-serif;line-height:1.6;color:#0f172a;\">"
        "<h2 style=\"margin:0 0 12px 0;\">You're invited to Engyne</h2>"
        "<p>Welcome to Engyne. Your account has been provisioned with access to the slots below.</p>"
        f"<p><strong>Slots:</strong> {slots_text}</p>"
        f"<p><strong>{inviter_line}</strong></p>"
        f"<p><a href=\"{dashboard_url}\" style=\"color:#16a34a;font-weight:600;\">Open Engyne Dashboard</a></p>"
        "<p style=\"font-size:12px;color:#64748b;\">"
        "If access is denied, ask your admin to allowlist this email."
        "</p>"
        "</div>"
    )
    return subject, html, text


def _send_brevo_email(
    settings: Settings,
    *,
    to_email: str,
    subject: str,
    html: str,
    text: str,
    sender_email: str,
    sender_name: str,
) -> bool:
    if not settings.brevo_api_key:
        logger.warning("Brevo API key missing; skipping email send.")
        return False

    payload = {
        "sender": {"name": sender_name, "email": sender_email},
        "to": [{"email": to_email}],
        "subject": subject,
        "htmlContent": html,
        "textContent": text,
    }
    headers = {
        "accept": "application/json",
        "content-type": "application/json",
        "api-key": settings.brevo_api_key,
    }
    url = settings.brevo_base_url.rstrip("/") + "/v3/smtp/email"
    try:
        response = requests.post(url, json=payload, headers=headers, timeout=10)
    except requests.RequestException as exc:
        logger.warning("Brevo email request failed: %s", exc)
        return False

    if not response.ok:
        logger.warning("Brevo email send failed: %s %s", response.status_code, response.text[:500])
        return False
    return True


def send_invite_email(
    settings: Settings,
    to_email: str,
    slot_ids: Iterable[str],
    invited_by: str | None,
) -> bool:
    sender_email = settings.brevo_invite_sender_email
    if not sender_email:
        logger.warning("Brevo invite sender email missing; skipping invite email.")
        return False
    sender_name = settings.brevo_invite_sender_name or "Engyne"
    subject, html, text = _render_invite_email(settings, to_email, slot_ids, invited_by)
    return _send_brevo_email(
        settings,
        to_email=to_email,
        subject=subject,
        html=html,
        text=text,
        sender_email=sender_email,
        sender_name=sender_name,
    )
