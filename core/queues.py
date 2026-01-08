from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
import requests


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def append_jsonl(path: Path, record: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record) + "\n")


def init_queue_files(runtime_root: Path, names: list[str]) -> None:
    runtime_root.mkdir(parents=True, exist_ok=True)
    for name in names:
        (runtime_root / f"{name}_queue.jsonl").touch(exist_ok=True)
        (runtime_root / f"{name}_queue.offset").touch(exist_ok=True)


def fan_out_verified(record: dict[str, Any], runtime_root: Path) -> None:
    """Append verified event to all channel queues."""
    channels = ["whatsapp", "telegram", "email", "sheets", "push"]
    init_queue_files(runtime_root, channels + ["verified"])
    for name in channels:
        append_jsonl(runtime_root / f"{name}_queue.jsonl", {**record, "channel": name})
    append_jsonl(runtime_root / "verified_queue.jsonl", record)


def post_webhook(url: str, secret: str | None, payload: dict[str, Any]) -> None:
    headers = {"Content-Type": "application/json"}
    if secret:
        headers["X-Engyne-Webhook-Secret"] = secret
    try:
        requests.post(url, headers=headers, json=payload, timeout=5)
    except Exception:
        # Webhook failures should not crash event ingestion
        pass
