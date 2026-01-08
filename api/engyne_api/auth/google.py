from __future__ import annotations

import base64
import hashlib
import secrets
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode

import requests
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token

from engyne_api.settings import Settings


GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_SCOPES = "openid email profile"


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def new_state() -> str:
    return secrets.token_urlsafe(32)


def new_code_verifier() -> str:
    return secrets.token_urlsafe(64)


def pkce_code_challenge(code_verifier: str) -> str:
    digest = hashlib.sha256(code_verifier.encode("utf-8")).digest()
    return _b64url(digest)


def build_google_auth_url(*, settings: Settings, state: str, code_challenge: str) -> str:
    params = {
        "client_id": settings.google_oauth_client_id,
        "redirect_uri": settings.google_oauth_redirect_uri,
        "response_type": "code",
        "scope": GOOGLE_SCOPES,
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
        "prompt": "select_account",
    }
    return f"{GOOGLE_AUTH_URL}?{urlencode(params)}"


@dataclass(frozen=True)
class TokenExchangeResult:
    id_token: str
    raw: dict[str, Any]


def exchange_code_for_tokens(
    *, settings: Settings, code: str, code_verifier: str, timeout_seconds: float = 10.0
) -> TokenExchangeResult:
    resp = requests.post(
        GOOGLE_TOKEN_URL,
        data={
            "code": code,
            "client_id": settings.google_oauth_client_id,
            "client_secret": settings.google_oauth_client_secret,
            "redirect_uri": settings.google_oauth_redirect_uri,
            "grant_type": "authorization_code",
            "code_verifier": code_verifier,
        },
        timeout=timeout_seconds,
    )
    resp.raise_for_status()
    data = resp.json()
    idt = data.get("id_token")
    if not isinstance(idt, str) or not idt:
        raise ValueError("google token exchange missing id_token")
    return TokenExchangeResult(id_token=idt, raw=data)


def verify_google_id_token(*, settings: Settings, id_token: str) -> dict[str, Any]:
    request = google_requests.Request()
    info = google_id_token.verify_oauth2_token(id_token, request, settings.google_oauth_client_id)
    if not isinstance(info, dict):
        raise ValueError("invalid id token payload")
    return info

