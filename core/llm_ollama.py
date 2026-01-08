from __future__ import annotations

import os
from typing import Any

import requests


def _coerce_bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "y", "on"}
    return default


def _normalize_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, (list, tuple, set, frozenset)):
        return [str(v).strip().lower() for v in value if str(v).strip()]
    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return []
        return [v.strip().lower() for v in raw.split(",") if v.strip()]
    return [str(value).strip().lower()] if str(value).strip() else []


def _format_details(record: dict[str, Any]) -> str:
    payload = record.get("payload") or {}
    title = payload.get("title") or record.get("title") or "Lead"
    category = payload.get("category_text") or record.get("category_text")
    country = payload.get("country") or record.get("country")
    age = payload.get("age_hours") or record.get("age_hours")
    member_months = payload.get("member_months") or record.get("member_months")
    lines = [f"Title: {title}"]
    if category:
        lines.append(f"Category: {category}")
    if country:
        lines.append(f"Country: {country}")
    if age is not None:
        lines.append(f"Age hours: {age}")
    if member_months is not None:
        lines.append(f"Member months: {member_months}")
    return "\n".join(lines)


def generate_message(record: dict[str, Any], channel: str) -> str | None:
    enabled = _coerce_bool(os.environ.get("OLLAMA_ENABLED", "false"), default=False)
    if not enabled:
        return None
    allowed_channels = _normalize_list(os.environ.get("OLLAMA_CHANNELS", ""))
    if allowed_channels and channel.lower() not in allowed_channels:
        return None

    base_url = (os.environ.get("OLLAMA_BASE_URL") or "http://localhost:11434").rstrip("/")
    model = os.environ.get("OLLAMA_MODEL") or "llama3.1"
    temperature = float(os.environ.get("OLLAMA_TEMPERATURE", "0.4"))
    timeout = float(os.environ.get("OLLAMA_TIMEOUT_SECONDS", "12"))
    max_chars = int(float(os.environ.get("OLLAMA_MAX_CHARS", "480")))

    system_prompt = os.environ.get(
        "OLLAMA_SYSTEM_PROMPT",
        "You are a concise, professional sales representative. Use only the provided facts.",
    )
    details = _format_details(record)
    user_prompt = os.environ.get(
        "OLLAMA_PROMPT_TEMPLATE",
        "Write a short WhatsApp-style message (2-4 lines). "
        "Do not invent facts. Use only these details:\n{details}",
    ).replace("{details}", details)

    payload = {
        "model": model,
        "prompt": f"{system_prompt}\n\n{user_prompt}",
        "stream": False,
        "options": {"temperature": temperature},
    }
    try:
        resp = requests.post(f"{base_url}/api/generate", json=payload, timeout=timeout)
        if not (200 <= resp.status_code < 300):
            return None
        data = resp.json()
        text = (data.get("response") or "").strip()
        if not text:
            return None
        return text[:max_chars]
    except Exception:
        return None
