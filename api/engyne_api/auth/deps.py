from __future__ import annotations

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from engyne_api.auth.jwt import decode_jwt_hs256
from engyne_api.db.deps import get_db
from engyne_api.db.models import User
from engyne_api.settings import Settings, get_settings


bearer_scheme = HTTPBearer(auto_error=False)


def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> User:
    if creds is None or creds.scheme.lower() != "bearer" or not creds.credentials:
        raise HTTPException(status_code=401, detail="missing bearer token")

    try:
        payload = decode_jwt_hs256(token=creds.credentials, secret=settings.jwt_secret)
    except Exception:
        raise HTTPException(status_code=401, detail="invalid token")

    user_id = payload.get("user_id")
    if not isinstance(user_id, str) or not user_id:
        raise HTTPException(status_code=401, detail="invalid token payload")

    user = db.query(User).filter(User.id == user_id).one_or_none()
    if user is None:
        raise HTTPException(status_code=401, detail="user not found")
    return user

