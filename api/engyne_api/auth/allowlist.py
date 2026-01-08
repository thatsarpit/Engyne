from __future__ import annotations

from engyne_api.settings import Settings


def is_email_allowed(email: str, settings: Settings) -> bool:
    normalized = email.strip().lower()
    if not normalized or "@" not in normalized:
        return False

    if settings.google_oauth_allowed_emails:
        return normalized in settings.google_oauth_allowed_emails

    if settings.google_oauth_allowed_domains:
        domain = normalized.rsplit("@", 1)[1]
        return domain in settings.google_oauth_allowed_domains

    return False

