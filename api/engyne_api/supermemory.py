from __future__ import annotations

from typing import Any

import requests

from engyne_api.settings import Settings


def _auth_headers(settings: Settings) -> dict[str, str] | None:
    if not settings.supermemory_api_key:
        return None
    return {"Authorization": f"Bearer {settings.supermemory_api_key}"}


def push_document(settings: Settings, content: str, metadata: dict[str, Any] | None = None) -> bool:
    headers = _auth_headers(settings)
    if not headers:
        return False
    headers["Content-Type"] = "application/json"
    url = f"{settings.supermemory_base_url.rstrip('/')}/v3/documents"
    payload: dict[str, Any] = {"content": content}
    if metadata:
        payload["metadata"] = metadata
    try:
        resp = requests.post(url, headers=headers, json=payload, timeout=10)
        return 200 <= resp.status_code < 300
    except Exception:
        return False


def search_documents(settings: Settings, query: str, limit: int = 5) -> list[dict[str, Any]]:
    headers = _auth_headers(settings)
    if not headers:
        return []
    headers["Content-Type"] = "application/json"
    url = f"{settings.supermemory_base_url.rstrip('/')}/v3/search"
    payload = {"q": query, "limit": limit}
    try:
        resp = requests.post(url, headers=headers, json=payload, timeout=10)
        if resp.status_code >= 300:
            return []
        data = resp.json()
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            return data.get("results") or data.get("data") or []
    except Exception:
        return []
    return []
