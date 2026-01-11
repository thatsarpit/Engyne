from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from core.slot_fs import ensure_slots_root, slot_paths
from engyne_api.audit import log_audit
from engyne_api.auth.deps import get_current_user
from engyne_api.db.deps import get_db
from engyne_api.db.models import User
from engyne_api.email import send_invite_email
from engyne_api.settings import Settings, get_settings

router = APIRouter(prefix="/admin", tags=["admin"])


class InviteRequest(BaseModel):
    email: str
    slots: list[str]


class InviteResponse(BaseModel):
    email: str
    role: str
    allowed_slots: list[str]
    created: bool


class ClientSummary(BaseModel):
    id: str
    email: str
    role: str
    allowed_slots: list[str]
    created_at: datetime
    updated_at: datetime


@router.post("/invite", response_model=InviteResponse)
def invite_user(
    payload: InviteRequest,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> InviteResponse:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="admin role required")

    email = payload.email.strip().lower()
    if not email or "@" not in email or "." not in email:
        raise HTTPException(status_code=400, detail="invalid email")

    slots = [slot.strip() for slot in payload.slots if slot.strip()]
    if not slots:
        raise HTTPException(status_code=400, detail="at least one slot is required")

    ensure_slots_root(settings.slots_root_path)
    valid_slots: list[str] = []
    missing: list[str] = []
    for slot_id in slots:
        try:
            paths = slot_paths(settings.slots_root_path, slot_id)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"invalid slot_id: {slot_id}")
        if not paths.root.exists():
            missing.append(slot_id)
        else:
            valid_slots.append(slot_id)

    if missing:
        raise HTTPException(status_code=404, detail=f"slots not found: {', '.join(sorted(missing))}")
    if not valid_slots:
        raise HTTPException(status_code=400, detail="no valid slots available")

    target = db.query(User).filter(User.email == email).one_or_none()
    created = False
    if target is None:
        target = User(email=email, role="client", allowed_slots=sorted(set(valid_slots)))
        db.add(target)
        created = True
    else:
        allowed = set(target.allowed_slots or [])
        allowed.update(valid_slots)
        target.allowed_slots = sorted(allowed)

    target.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(target)

    email_queued = False
    if settings.brevo_api_key and settings.brevo_invite_sender_email:
        background_tasks.add_task(
            send_invite_email,
            settings,
            target.email,
            valid_slots,
            user.email,
        )
        email_queued = True

    log_audit(
        db,
        settings,
        action="user_invite",
        user=user,
        details={
            "email": target.email,
            "slots": valid_slots,
            "created": created,
            "role": target.role,
            "invite_email_queued": email_queued,
        },
    )

    return InviteResponse(
        email=target.email,
        role=target.role,
        allowed_slots=list(target.allowed_slots or []),
        created=created,
    )


@router.get("/clients", response_model=list[ClientSummary])
def list_clients(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ClientSummary]:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="admin role required")

    rows = db.query(User).order_by(User.created_at.desc()).all()
    return [
        ClientSummary(
            id=row.id,
            email=row.email,
            role=row.role,
            allowed_slots=list(row.allowed_slots or []),
            created_at=row.created_at,
            updated_at=row.updated_at,
        )
        for row in rows
    ]
