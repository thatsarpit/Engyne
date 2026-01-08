from __future__ import annotations

import json
from typing import Any

from pywebpush import WebPushException, webpush
from sqlalchemy.orm import Session

from core.slot_fs import read_slot_config, slot_paths
from engyne_api.db.models import PushSubscription, User
from engyne_api.settings import Settings


def _push_enabled(settings: Settings) -> bool:
    return bool(settings.vapid_private_key and settings.vapid_public_key and settings.vapid_subject)


def _build_payload(record: dict[str, Any], settings: Settings) -> dict[str, Any]:
    payload = record.get("payload") or {}
    slot_id = record.get("slot_id") or "unknown"
    title = payload.get("title") or record.get("title") or "Verified lead"
    country = payload.get("country") or record.get("country")
    contact = payload.get("contact") or payload.get("email") or payload.get("phone")
    body_parts = [f"Slot {slot_id}"]
    if country:
        body_parts.append(str(country))
    if contact:
        body_parts.append(str(contact))
    body = " · ".join(body_parts)
    return {
        "title": title,
        "body": body,
        "slot_id": slot_id,
        "lead_id": record.get("lead_id"),
        "url": str(settings.public_dashboard_base_url),
    }


def send_web_push_for_verified(
    db: Session,
    settings: Settings,
    record: dict[str, Any],
) -> None:
    if not _push_enabled(settings):
        return
    slot_id = record.get("slot_id")
    if not slot_id:
        return
    try:
        paths = slot_paths(settings.slots_root_path, slot_id)
    except ValueError:
        return
    slot_config = read_slot_config(paths.config_path)
    channels = slot_config.get("channels")
    if not isinstance(channels, dict) or not channels.get("push"):
        return

    payload = _build_payload(record, settings)
    payload_json = json.dumps(payload)
    vapid_claims = {"sub": settings.vapid_subject}

    users = db.query(User).all()
    removed = False
    for user in users:
        if user.role != "admin" and slot_id not in user.allowed_slots:
            continue
        subs = db.query(PushSubscription).filter(PushSubscription.user_id == user.id).all()
        for sub in subs:
            subscription_info = {
                "endpoint": sub.endpoint,
                "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
            }
            try:
                webpush(
                    subscription_info=subscription_info,
                    data=payload_json,
                    vapid_private_key=settings.vapid_private_key,
                    vapid_claims=vapid_claims,
                )
            except WebPushException as exc:
                status = exc.response.status_code if exc.response else None
                if status in {404, 410}:
                    db.delete(sub)
                    removed = True
                continue

    if removed:
        db.commit()
