from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any

import requests


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def send_slack_alert(title: str, message: str) -> None:
    url = os.environ.get("ALERTS_SLACK_WEBHOOK_URL", "").strip()
    if not url:
        return
    payload: dict[str, Any] = {
        "text": f"*{title}*\\n{message}\\nTime: {utc_now()}",
    }
    try:
        requests.post(url, json=payload, timeout=5)
    except Exception:
        # Alert failures should never crash the manager.
        return
