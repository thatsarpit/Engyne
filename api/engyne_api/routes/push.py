from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from engyne_api.auth.deps import get_current_user
from engyne_api.db.deps import get_db
from engyne_api.db.models import PushSubscription, User
from engyne_api.settings import Settings, get_settings

router = APIRouter(prefix="/push", tags=["push"])


class PushSubscriptionKeys(BaseModel):
    p256dh: str
    auth: str


class PushSubscriptionRequest(BaseModel):
    endpoint: str
    keys: PushSubscriptionKeys
    expirationTime: float | None = None


class PushUnsubscribeRequest(BaseModel):
    endpoint: str


@router.get("/vapid-public-key")
def get_vapid_public_key(
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> dict:
    if not settings.vapid_public_key:
        raise HTTPException(status_code=503, detail="vapid public key not configured")
    return {"publicKey": settings.vapid_public_key}


@router.post("/subscribe")
def subscribe_push(
    payload: PushSubscriptionRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    user_agent: str | None = Header(default=None, alias="User-Agent"),
) -> dict:
    endpoint = payload.endpoint.strip()
    if not endpoint:
        raise HTTPException(status_code=400, detail="missing endpoint")

    existing = db.query(PushSubscription).filter(PushSubscription.endpoint == endpoint).one_or_none()
    if existing:
        existing.user_id = user.id
        existing.p256dh = payload.keys.p256dh
        existing.auth = payload.keys.auth
        existing.user_agent = user_agent
        existing.updated_at = datetime.now(timezone.utc)
        db.commit()
        return {"status": "updated", "endpoint": endpoint}

    sub = PushSubscription(
        user_id=user.id,
        endpoint=endpoint,
        p256dh=payload.keys.p256dh,
        auth=payload.keys.auth,
        user_agent=user_agent,
    )
    db.add(sub)
    db.commit()
    return {"status": "created", "endpoint": endpoint}


@router.post("/unsubscribe")
def unsubscribe_push(
    payload: PushUnsubscribeRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    endpoint = payload.endpoint.strip()
    if not endpoint:
        raise HTTPException(status_code=400, detail="missing endpoint")
    existing = (
        db.query(PushSubscription)
        .filter(PushSubscription.endpoint == endpoint, PushSubscription.user_id == user.id)
        .one_or_none()
    )
    if not existing:
        return {"status": "missing", "endpoint": endpoint}
    db.delete(existing)
    db.commit()
    return {"status": "removed", "endpoint": endpoint}
