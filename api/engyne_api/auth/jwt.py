from __future__ import annotations

from datetime import datetime, timedelta, timezone

import jwt


def encode_jwt_hs256(*, payload: dict, secret: str, expires_seconds: int) -> str:
    now = datetime.now(timezone.utc)
    to_encode = {**payload, "iat": int(now.timestamp()), "exp": int((now + timedelta(seconds=expires_seconds)).timestamp())}
    return jwt.encode(to_encode, secret, algorithm="HS256")


def decode_jwt_hs256(*, token: str, secret: str) -> dict:
    return jwt.decode(token, secret, algorithms=["HS256"])

