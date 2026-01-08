from __future__ import annotations

import secrets
from datetime import datetime, timezone
from urllib.parse import urlparse, urlunparse

import requests
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse, RedirectResponse, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from engyne_api.auth.allowlist import is_email_allowed
from engyne_api.auth.deps import get_current_user
from engyne_api.auth.google import (
    build_google_auth_url,
    exchange_code_for_tokens,
    new_code_verifier,
    new_state,
    pkce_code_challenge,
    verify_google_id_token,
)
from engyne_api.auth.jwt import encode_jwt_hs256
from engyne_api.db.deps import get_db
from engyne_api.db.models import User
from engyne_api.settings import Settings, get_settings


router = APIRouter(prefix="/auth", tags=["auth"])

COOKIE_STATE = "engyne_oauth_state"
COOKIE_VERIFIER = "engyne_oauth_verifier"
COOKIE_RETURN_TO = "engyne_oauth_return_to"


def _origin(url: str) -> str:
    parsed = urlparse(url)
    if not parsed.scheme or not parsed.netloc:
        raise ValueError("invalid url")
    return f"{parsed.scheme}://{parsed.netloc}"


def _validate_return_to(return_to: str | None, settings: Settings) -> str:
    default_return_to = str(settings.public_dashboard_base_url).rstrip("/")
    if return_to is None:
        return default_return_to

    candidate = return_to.strip()
    if not candidate:
        return default_return_to

    try:
        origin = _origin(candidate)
    except ValueError:
        raise HTTPException(status_code=400, detail="invalid return_to url")

    allowed_origins = set(settings.auth_allowed_redirect_origins)
    allowed_origins.add(_origin(default_return_to))

    if origin.lower() not in {o.lower() for o in allowed_origins}:
        raise HTTPException(status_code=400, detail="return_to origin not allowed")

    return candidate


def _append_fragment(url: str, fragment_params: dict[str, str]) -> str:
    parsed = urlparse(url)
    new_fragment_parts = []
    if parsed.fragment:
        new_fragment_parts.append(parsed.fragment)
    for k, v in fragment_params.items():
        new_fragment_parts.append(f"{k}={v}")
    new_fragment = "&".join(new_fragment_parts)
    return urlunparse(parsed._replace(fragment=new_fragment))


class MeResponse(BaseModel):
    user_id: str
    email: str
    role: str
    allowed_slots: list[str]


@router.get("/google/start")
def google_start(
    request: Request,
    return_to: str | None = Query(default=None),
    settings: Settings = Depends(get_settings),
) -> RedirectResponse:
    safe_return_to = _validate_return_to(return_to, settings)

    state = new_state()
    code_verifier = new_code_verifier()
    code_challenge = pkce_code_challenge(code_verifier)

    auth_url = build_google_auth_url(settings=settings, state=state, code_challenge=code_challenge)

    resp = RedirectResponse(auth_url, status_code=302)
    max_age = 10 * 60
    cookie_common = {
        "httponly": True,
        "secure": settings.is_https,
        "samesite": "lax",
        "max_age": max_age,
        "path": "/auth/google",
    }
    resp.set_cookie(COOKIE_STATE, state, **cookie_common)
    resp.set_cookie(COOKIE_VERIFIER, code_verifier, **cookie_common)
    resp.set_cookie(COOKIE_RETURN_TO, safe_return_to, **cookie_common)
    return resp


@router.get("/google/callback")
def google_callback(
    request: Request,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> Response:
    error = request.query_params.get("error")
    if error:
        raise HTTPException(status_code=400, detail=f"google oauth error: {error}")

    state_qs = request.query_params.get("state")
    code = request.query_params.get("code")
    if not state_qs or not code:
        raise HTTPException(status_code=400, detail="missing oauth parameters")

    state_cookie = request.cookies.get(COOKIE_STATE)
    verifier_cookie = request.cookies.get(COOKIE_VERIFIER)
    return_to_cookie = request.cookies.get(COOKIE_RETURN_TO)

    if not state_cookie or not secrets.compare_digest(state_qs, state_cookie):
        raise HTTPException(status_code=400, detail="invalid oauth state")
    if not verifier_cookie:
        raise HTTPException(status_code=400, detail="missing oauth verifier")

    try:
        token_result = exchange_code_for_tokens(settings=settings, code=code, code_verifier=verifier_cookie)
        id_info = verify_google_id_token(settings=settings, id_token=token_result.id_token)
    except requests.HTTPError:
        raise HTTPException(status_code=400, detail="google token exchange failed")
    except Exception:
        raise HTTPException(status_code=400, detail="google oauth verification failed")

    email = id_info.get("email")
    if not isinstance(email, str) or not email:
        raise HTTPException(status_code=400, detail="missing email in id token")
    normalized_email = email.strip().lower()

    if not is_email_allowed(normalized_email, settings):
        raise HTTPException(status_code=403, detail="email not allowlisted")

    user = db.query(User).filter(User.email == normalized_email).one_or_none()
    if user is None:
        if not settings.google_oauth_auto_provision:
            raise HTTPException(status_code=403, detail="user not provisioned")
        role = "admin" if normalized_email in settings.google_oauth_admin_emails else "client"
        user = User(email=normalized_email, role=role, allowed_slots=[])
        db.add(user)
        db.commit()
        db.refresh(user)
    else:
        if normalized_email in settings.google_oauth_admin_emails and user.role != "admin":
            user.role = "admin"
        user.updated_at = datetime.now(timezone.utc)
        db.commit()

    token = encode_jwt_hs256(
        payload={"user_id": user.id, "email": user.email, "role": user.role, "allowed_slots": user.allowed_slots},
        secret=settings.jwt_secret,
        expires_seconds=settings.jwt_expires_seconds,
    )

    return_to = _validate_return_to(return_to_cookie, settings) if return_to_cookie else None

    if return_to:
        redirect_url = _append_fragment(return_to, {"token": token, "token_type": "Bearer"})
        resp = RedirectResponse(redirect_url, status_code=302)
        resp.delete_cookie(COOKIE_STATE, path="/auth/google")
        resp.delete_cookie(COOKIE_VERIFIER, path="/auth/google")
        resp.delete_cookie(COOKIE_RETURN_TO, path="/auth/google")
        return resp

    return JSONResponse({"access_token": token, "token_type": "Bearer"})


@router.get("/me", response_model=MeResponse)
def me(user: User = Depends(get_current_user)) -> MeResponse:
    return MeResponse(user_id=user.id, email=user.email, role=user.role, allowed_slots=list(user.allowed_slots))
