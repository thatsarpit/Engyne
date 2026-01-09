#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

import requests


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_env(path: Path) -> dict[str, str]:
    data: dict[str, str] = {}
    if not path.exists():
        return data
    for line in path.read_text().splitlines():
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        data[key.strip()] = value.strip()
    return data


def main() -> int:
    env = load_env(Path(".env"))
    parser = argparse.ArgumentParser(description="Emit a verified event for dispatcher testing.")
    parser.add_argument("--api-base", default=env.get("PUBLIC_API_BASE_URL", "http://localhost:8001"))
    parser.add_argument("--worker-secret", default=env.get("ENGYNE_WORKER_SECRET"))
    parser.add_argument("--slot-id", default="slot-1")
    parser.add_argument("--lead-id", default=None)
    parser.add_argument("--title", default="Test lead")
    parser.add_argument("--country", default="India")
    parser.add_argument("--age-hours", type=float, default=1.0)
    parser.add_argument("--member-months", type=int, default=12)
    parser.add_argument("--whatsapp", default=None, help="WhatsApp number (E.164) for WAHA.")
    parser.add_argument("--phone", default=None)
    parser.add_argument("--email", default=None)
    parser.add_argument("--message", default=None, help="Optional custom message for dispatchers.")
    args = parser.parse_args()

    if not args.worker_secret:
        print("ENGYNE_WORKER_SECRET is required (set in .env or pass --worker-secret).", file=sys.stderr)
        return 2

    lead_id = args.lead_id or f"{args.slot_id}-{uuid.uuid4()}"
    payload = {
        "title": args.title,
        "country": args.country,
        "age_hours": args.age_hours,
        "member_months": args.member_months,
    }
    if args.whatsapp:
        payload["whatsapp"] = args.whatsapp
    if args.phone:
        payload["phone"] = args.phone
    if args.email:
        payload["email"] = args.email
    if args.message:
        payload["message"] = args.message

    event = {
        "slot_id": args.slot_id,
        "lead_id": lead_id,
        "observed_at": utc_now(),
        "payload": payload,
    }
    url = args.api_base.rstrip("/") + "/events/verified"
    resp = requests.post(url, json=event, headers={"X-Engyne-Worker-Secret": args.worker_secret}, timeout=10)
    if not (200 <= resp.status_code < 300):
        print(f"API error {resp.status_code}: {resp.text}", file=sys.stderr)
        return 1
    print(json.dumps(resp.json(), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
