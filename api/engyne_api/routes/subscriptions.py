from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from core.slot_fs import ensure_slots_root, slot_paths
from engyne_api.audit import log_audit
from engyne_api.auth.deps import get_current_user
from engyne_api.db.deps import get_db
from engyne_api.db.models import SlotSubscription, User
from engyne_api.settings import Settings, get_settings

router = APIRouter(prefix="/subscriptions", tags=["subscriptions"])


class SubscriptionEntry(BaseModel):
    slot_id: str
    user_id: str
    email: str
    plan: str
    status: str
    starts_at: datetime | None
    ends_at: datetime | None
    notes: str | None
    created_at: datetime
    updated_at: datetime


class SubscriptionUpsertRequest(BaseModel):
    email: str
    slot_id: str
    plan: str = "yearly"
    status: str = "active"
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    notes: str | None = None


def _normalize_email(value: str) -> str:
    email = value.strip().lower()
    if not email or "@" not in email or "." not in email:
        raise HTTPException(status_code=400, detail="invalid email")
    return email


@router.get("", response_model=list[SubscriptionEntry])
def list_subscriptions(
    email: str | None = Query(default=None),
    slot_id: str | None = Query(default=None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[SubscriptionEntry]:
    query = db.query(SlotSubscription)
    if user.role != "admin":
        query = query.filter(SlotSubscription.user_id == user.id)
    else:
        if email:
            target = db.query(User).filter(User.email == _normalize_email(email)).one_or_none()
            if target is None:
                return []
            query = query.filter(SlotSubscription.user_id == target.id)
        if slot_id:
            query = query.filter(SlotSubscription.slot_id == slot_id)

    subscriptions = query.all()
    user_ids = {sub.user_id for sub in subscriptions}
    users = {u.id: u.email for u in db.query(User).filter(User.id.in_(user_ids)).all()} if user_ids else {}

    results: list[SubscriptionEntry] = []
    for sub in subscriptions:
        results.append(
            SubscriptionEntry(
                slot_id=sub.slot_id,
                user_id=sub.user_id,
                email=users.get(sub.user_id, ""),
                plan=sub.plan,
                status=sub.status,
                starts_at=sub.starts_at,
                ends_at=sub.ends_at,
                notes=sub.notes,
                created_at=sub.created_at,
                updated_at=sub.updated_at,
            )
        )
    return results


@router.post("", response_model=SubscriptionEntry)
def upsert_subscription(
    payload: SubscriptionUpsertRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> SubscriptionEntry:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="admin role required")

    email = _normalize_email(payload.email)
    slot_id = payload.slot_id.strip()
    if not slot_id:
        raise HTTPException(status_code=400, detail="slot_id required")

    ensure_slots_root(settings.slots_root_path)
    paths = slot_paths(settings.slots_root_path, slot_id)
    if not paths.root.exists():
        raise HTTPException(status_code=404, detail="slot not found")

    target = db.query(User).filter(User.email == email).one_or_none()
    created_user = False
    if target is None:
        target = User(email=email, role="client", allowed_slots=[slot_id])
        db.add(target)
        created_user = True
    else:
        allowed = set(target.allowed_slots or [])
        if slot_id not in allowed:
            allowed.add(slot_id)
            target.allowed_slots = sorted(allowed)
        target.updated_at = datetime.now(timezone.utc)

    existing = (
        db.query(SlotSubscription)
        .filter(SlotSubscription.slot_id == slot_id, SlotSubscription.user_id == target.id)
        .one_or_none()
    )
    if existing is None:
        existing = SlotSubscription(
            slot_id=slot_id,
            user_id=target.id,
            plan=payload.plan,
            status=payload.status,
            starts_at=payload.starts_at,
            ends_at=payload.ends_at,
            notes=payload.notes,
        )
        db.add(existing)
    else:
        existing.plan = payload.plan
        existing.status = payload.status
        existing.starts_at = payload.starts_at
        existing.ends_at = payload.ends_at
        existing.notes = payload.notes
        existing.updated_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(existing)
    db.refresh(target)

    log_audit(
        db,
        settings,
        action="subscription_upsert",
        user=user,
        details={
            "slot_id": slot_id,
            "email": email,
            "plan": payload.plan,
            "status": payload.status,
            "created_user": created_user,
        },
    )

    return SubscriptionEntry(
        slot_id=existing.slot_id,
        user_id=existing.user_id,
        email=target.email,
        plan=existing.plan,
        status=existing.status,
        starts_at=existing.starts_at,
        ends_at=existing.ends_at,
        notes=existing.notes,
        created_at=existing.created_at,
        updated_at=existing.updated_at,
    )
