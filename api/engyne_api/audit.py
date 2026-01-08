from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from engyne_api.db.models import AuditLog, User
from engyne_api.settings import Settings


def log_audit(
    db: Session,
    settings: Settings,
    action: str,
    user: User | None = None,
    slot_id: str | None = None,
    details: dict[str, Any] | None = None,
) -> None:
    entry = AuditLog(
        actor_user_id=user.id if user else None,
        actor_email=user.email if user else None,
        actor_role=user.role if user else None,
        action=action,
        slot_id=slot_id,
        details={
            "node_id": settings.node_id,
            "details": details or {},
        },
        created_at=datetime.now(timezone.utc),
    )
    try:
        db.add(entry)
        db.commit()
    except Exception:
        db.rollback()
