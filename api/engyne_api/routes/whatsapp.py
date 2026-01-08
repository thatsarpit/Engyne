from __future__ import annotations

import base64
from urllib.parse import urlencode

import requests
from fastapi import APIRouter, Depends, HTTPException, Response

from engyne_api.auth.deps import get_current_user
from engyne_api.settings import Settings, get_settings

router = APIRouter(prefix="/whatsapp", tags=["whatsapp"])


def _session_name(slot_id: str, settings: Settings) -> str:
    prefix = settings.waha_session_prefix or ""
    return f"{prefix}{slot_id}"


def _waha_headers(settings: Settings) -> dict[str, str]:
    headers: dict[str, str] = {}
    if settings.waha_token:
        if settings.waha_auth_header.lower() == "authorization":
            token = f"{settings.waha_auth_prefix} {settings.waha_token}".strip()
            headers[settings.waha_auth_header] = token
        else:
            headers[settings.waha_auth_header] = settings.waha_token
    return headers


def _waha_url(base_url: str, path: str, session: str | None, session_param: str | None) -> str:
    base = base_url.rstrip("/")
    if "{session}" in path:
        return base + path.replace("{session}", session or "")
    url = base + path
    if session_param and session:
        qs = urlencode({session_param: session})
        sep = "&" if "?" in url else "?"
        return f"{url}{sep}{qs}"
    return url


@router.post("/{slot_id}/session/start")
def start_session(
    slot_id: str,
    settings: Settings = Depends(get_settings),
    _user=Depends(get_current_user),
) -> dict:
    if not settings.waha_base_url:
        raise HTTPException(status_code=400, detail="WAHA_BASE_URL not configured")
    session = _session_name(slot_id, settings)
    url = settings.waha_base_url.rstrip("/") + settings.waha_sessions_path
    payload = {"name": session}
    try:
        resp = requests.post(url, json=payload, headers=_waha_headers(settings), timeout=10)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"WAHA request failed: {exc}")
    if not (200 <= resp.status_code < 300):
        raise HTTPException(status_code=502, detail=f"WAHA error: {resp.status_code}")
    return {"slot_id": slot_id, "session": session, "status": "started"}


@router.get("/{slot_id}/qr")
def get_qr(
    slot_id: str,
    settings: Settings = Depends(get_settings),
    _user=Depends(get_current_user),
) -> Response:
    if not settings.waha_base_url:
        raise HTTPException(status_code=400, detail="WAHA_BASE_URL not configured")
    session = _session_name(slot_id, settings)
    url = _waha_url(settings.waha_base_url, settings.waha_screenshot_path, session, settings.waha_screenshot_session_param)
    try:
        resp = requests.get(url, headers=_waha_headers(settings), timeout=10)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"WAHA request failed: {exc}")
    if not (200 <= resp.status_code < 300):
        raise HTTPException(status_code=502, detail=f"WAHA error: {resp.status_code}")

    content_type = resp.headers.get("content-type", "application/octet-stream")
    if "application/json" in content_type:
        data = resp.json()
        for key in ("data", "base64", "qr"):
            if key in data and isinstance(data[key], str):
                raw = data[key]
                if raw.startswith("data:image"):
                    _, b64 = raw.split(",", 1)
                    return Response(content=base64.b64decode(b64), media_type="image/png")
                return Response(content=base64.b64decode(raw), media_type="image/png")
        raise HTTPException(status_code=502, detail="WAHA QR response missing image payload")

    return Response(content=resp.content, media_type=content_type)
