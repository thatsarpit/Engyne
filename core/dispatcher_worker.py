from __future__ import annotations

import argparse
import json
import os
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import requests

from core.queues import append_jsonl, utc_now
from core.llm_ollama import generate_message

CHANNELS = ("whatsapp", "telegram", "email", "sheets", "push", "slack")
CONTACT_KEYS = {
    "whatsapp": ("whatsapp", "phone", "mobile", "phone_number"),
    "telegram": ("telegram", "telegram_chat_id", "chat_id"),
    "email": ("email", "email_address"),
    "push": ("subscription", "push_subscription"),
}


@dataclass
class DispatcherConfig:
    channel: str
    runtime_root: Path
    poll_seconds: float
    rate_per_minute: int
    dry_run: bool
    dry_run_advance: bool
    webhook_url: str | None
    webhook_secret: str | None
    waha_base_url: str | None = None
    waha_session: str | None = None
    waha_session_prefix: str | None = None
    waha_token: str | None = None
    waha_send_path: str = "/api/sendText"
    waha_chat_suffix: str = "@c.us"
    waha_auth_header: str = "Authorization"
    waha_auth_prefix: str = "Bearer"


def coerce_bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "y", "on"}
    return default


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text())
    except Exception:
        return default


def save_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2))
    tmp.replace(path)


def read_offset(path: Path) -> int:
    if not path.exists():
        return 0
    try:
        return int(path.read_text().strip() or "0")
    except Exception:
        return 0


def write_offset(path: Path, value: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(str(value))


def ensure_channel_files(runtime_root: Path, channel: str) -> dict[str, Path]:
    runtime_root.mkdir(parents=True, exist_ok=True)
    paths = {
        "queue": runtime_root / f"{channel}_queue.jsonl",
        "offset": runtime_root / f"{channel}_queue.offset",
        "sent": runtime_root / f"{channel}_queue.sent.jsonl",
        "rate": runtime_root / f"{channel}_queue.rate.json",
        "contact_state": runtime_root / f"{channel}_queue.contact_state.json",
        "proofs": runtime_root / f"{channel}_queue.proofs.jsonl",
    }
    for path in paths.values():
        path.touch(exist_ok=True)
    return paths


def extract_contact(payload: dict[str, Any], channel: str) -> str | None:
    for key in CONTACT_KEYS.get(channel, ()):
        value = payload.get(key)
        if value:
            return str(value)
    return None


def format_message(record: dict[str, Any]) -> str:
    payload = record.get("payload") or {}
    title = payload.get("title") or record.get("title") or "Lead"
    country = payload.get("country") or record.get("country")
    age = payload.get("age_hours") or record.get("age_hours")
    member_months = payload.get("member_months") or record.get("member_months")
    lead_id = record.get("lead_id")
    lines = [f"ENGYNE lead: {title}"]
    if country:
        lines.append(f"Country: {country}")
    if age is not None:
        lines.append(f"Age (hrs): {age}")
    if member_months is not None:
        lines.append(f"Member months: {member_months}")
    if lead_id:
        lines.append(f"Lead ID: {lead_id}")
    return "\n".join(lines)


def build_message(record: dict[str, Any], channel: str) -> str:
    generated = generate_message(record, channel)
    if generated:
        return generated
    return format_message(record)


def normalize_waha_chat_id(contact: str, suffix: str) -> str | None:
    raw = contact.strip()
    if not raw:
        return None
    if "@c.us" in raw or "@g.us" in raw:
        return raw
    digits = "".join(ch for ch in raw if ch.isdigit() or ch == "+")
    digits = digits.lstrip("+")
    if not digits:
        return None
    return f"{digits}{suffix}"


def can_send(rate_state: dict[str, Any], slot_id: str, rate_per_minute: int) -> bool:
    if rate_per_minute <= 0:
        return True
    now = time.time()
    slot_state = rate_state.get(slot_id) or {"window_start": now, "sent": 0}
    window_start = float(slot_state.get("window_start", now))
    sent = int(slot_state.get("sent", 0))
    if now - window_start >= 60:
        slot_state = {"window_start": now, "sent": 0}
    if slot_state["sent"] >= rate_per_minute:
        rate_state[slot_id] = slot_state
        return False
    return True


def mark_sent(rate_state: dict[str, Any], slot_id: str) -> None:
    now = time.time()
    slot_state = rate_state.get(slot_id) or {"window_start": now, "sent": 0}
    window_start = float(slot_state.get("window_start", now))
    if now - window_start >= 60:
        slot_state = {"window_start": now, "sent": 0}
    slot_state["sent"] = int(slot_state.get("sent", 0)) + 1
    rate_state[slot_id] = slot_state


def send_webhook(url: str, secret: str | None, payload: dict[str, Any]) -> bool:
    headers = {"Content-Type": "application/json"}
    if secret:
        headers["X-Engyne-Channel-Secret"] = secret
    resp = requests.post(url, headers=headers, json=payload, timeout=10)
    return 200 <= resp.status_code < 300


def resolve_waha_session(cfg: DispatcherConfig, record: dict[str, Any]) -> str | None:
    if cfg.waha_session:
        return cfg.waha_session
    slot_id = record.get("slot_id")
    if not slot_id:
        return None
    prefix = cfg.waha_session_prefix or "slot-"
    return f"{prefix}{slot_id}"


def send_whatsapp_waha(cfg: DispatcherConfig, contact: str, record: dict[str, Any]) -> bool:
    if not cfg.waha_base_url or not cfg.waha_session:
        session = resolve_waha_session(cfg, record)
    else:
        session = cfg.waha_session
    if not cfg.waha_base_url or not session:
        return False
    chat_id = normalize_waha_chat_id(contact, cfg.waha_chat_suffix)
    if not chat_id:
        return False
    url = cfg.waha_base_url.rstrip("/") + cfg.waha_send_path
    headers = {"Content-Type": "application/json"}
    if cfg.waha_token:
        if cfg.waha_auth_header.lower() == "authorization":
            headers[cfg.waha_auth_header] = f"{cfg.waha_auth_prefix} {cfg.waha_token}".strip()
        else:
            headers[cfg.waha_auth_header] = cfg.waha_token
    message_text = build_message(record, cfg.channel)
    payload = {
        "session": session,
        "chatId": chat_id,
        "text": message_text,
    }
    resp = requests.post(url, headers=headers, json=payload, timeout=10)
    return 200 <= resp.status_code < 300


def log_delivery(paths: dict[str, Path], record: dict[str, Any], status: str, detail: str | None) -> None:
    entry = {
        "status": status,
        "detail": detail,
        "sent_at": utc_now(),
        "record": record,
    }
    append_jsonl(paths["sent"], entry)
    append_jsonl(paths["proofs"], entry)


def process_record(
    cfg: DispatcherConfig,
    paths: dict[str, Path],
    record: dict[str, Any],
    contact_state: dict[str, Any],
    rate_state: dict[str, Any],
) -> tuple[bool, bool]:
    lead_id = record.get("lead_id")
    slot_id = record.get("slot_id") or "unknown"
    if not lead_id:
        log_delivery(paths, record, "invalid", "missing lead_id")
        return True, True

    lead_state = contact_state.get(lead_id)
    if lead_state and lead_state.get("status") in {"sent", "skipped"}:
        return True, False
    if lead_state and lead_state.get("status") in {"blocked", "held"}:
        return False, False

    payload = record.get("payload") or {}
    contact = extract_contact(payload, cfg.channel)

    if cfg.dry_run:
        if cfg.dry_run_advance:
            contact_state[lead_id] = {"status": "skipped", "updated_at": utc_now(), "detail": "dry_run"}
            log_delivery(paths, record, "skipped", "dry_run")
            return True, True
        contact_state[lead_id] = {"status": "held", "updated_at": utc_now(), "detail": "dry_run_hold"}
        return False, True

    if cfg.channel in CONTACT_KEYS and not contact:
        contact_state[lead_id] = {"status": "blocked", "updated_at": utc_now(), "detail": "missing_contact"}
        log_delivery(paths, record, "blocked", "missing_contact")
        return False, True

    if cfg.channel == "whatsapp" and cfg.waha_base_url and cfg.waha_session:
        ok = send_whatsapp_waha(cfg, contact, record)
        if ok:
            mark_sent(rate_state, slot_id)
            contact_state[lead_id] = {"status": "sent", "updated_at": utc_now()}
            log_delivery(paths, record, "sent", "waha")
            return True, True
        contact_state[lead_id] = {"status": "failed", "updated_at": utc_now(), "detail": "waha_error"}
        log_delivery(paths, record, "failed", "waha_error")
        return False, True

    if not cfg.webhook_url:
        contact_state[lead_id] = {"status": "blocked", "updated_at": utc_now(), "detail": "missing_webhook"}
        log_delivery(paths, record, "blocked", "missing_webhook")
        return False, True

    if not can_send(rate_state, slot_id, cfg.rate_per_minute):
        return False, False

    payload_out = {
        "channel": cfg.channel,
        "sent_at": utc_now(),
        "record": record,
        "contact": contact,
        "message": build_message(record, cfg.channel),
    }
    ok = send_webhook(cfg.webhook_url, cfg.webhook_secret, payload_out)
    if ok:
        mark_sent(rate_state, slot_id)
        contact_state[lead_id] = {"status": "sent", "updated_at": utc_now()}
        log_delivery(paths, record, "sent", None)
        return True, True
    contact_state[lead_id] = {"status": "failed", "updated_at": utc_now(), "detail": "webhook_error"}
    log_delivery(paths, record, "failed", "webhook_error")
    return False, True


def process_queue(cfg: DispatcherConfig) -> None:
    paths = ensure_channel_files(cfg.runtime_root, cfg.channel)
    contact_state = load_json(paths["contact_state"], {})
    rate_state = load_json(paths["rate"], {})
    offset = read_offset(paths["offset"])

    processed = 0
    with paths["queue"].open("r", encoding="utf-8") as f:
        for idx, line in enumerate(f):
            if idx < offset:
                continue
            line = line.strip()
            if not line:
                offset = idx + 1
                continue
            try:
                record = json.loads(line)
            except Exception:
                log_delivery(paths, {"raw": line}, "invalid", "json_parse_error")
                offset = idx + 1
                continue

            advance, mutated = process_record(cfg, paths, record, contact_state, rate_state)
            if mutated:
                save_json(paths["contact_state"], contact_state)
                save_json(paths["rate"], rate_state)
            if advance:
                offset = idx + 1
                write_offset(paths["offset"], offset)
                processed += 1
                continue
            break

    if processed == 0:
        time.sleep(cfg.poll_seconds)


def load_cfg(args: argparse.Namespace) -> DispatcherConfig:
    channel = args.channel
    runtime_root = Path(args.runtime_root).expanduser().resolve()
    poll_seconds = float(os.environ.get("DISPATCHER_POLL_SECONDS", "2.0"))
    rate_per_minute = int(os.environ.get("DISPATCHER_RATE_PER_MINUTE", "6"))
    dry_run = coerce_bool(os.environ.get("DISPATCHER_DRY_RUN", "true"), default=True)
    dry_run_advance = coerce_bool(os.environ.get("DISPATCHER_DRY_RUN_ADVANCE", "false"), default=False)

    webhook_url = os.environ.get(f"{channel.upper()}_WEBHOOK_URL") or None
    webhook_secret = os.environ.get(f"{channel.upper()}_WEBHOOK_SECRET") or None
    waha_base_url = os.environ.get("WAHA_BASE_URL") or None
    waha_session = os.environ.get("WAHA_SESSION") or None
    waha_session_prefix = os.environ.get("WAHA_SESSION_PREFIX") or "slot-"
    waha_token = os.environ.get("WAHA_TOKEN") or None
    waha_send_path = os.environ.get("WAHA_SEND_PATH") or "/api/sendText"
    waha_chat_suffix = os.environ.get("WAHA_CHAT_SUFFIX") or "@c.us"
    waha_auth_header = os.environ.get("WAHA_AUTH_HEADER") or "Authorization"
    waha_auth_prefix = os.environ.get("WAHA_AUTH_PREFIX") or "Bearer"

    return DispatcherConfig(
        channel=channel,
        runtime_root=runtime_root,
        poll_seconds=poll_seconds,
        rate_per_minute=rate_per_minute,
        dry_run=dry_run,
        dry_run_advance=dry_run_advance,
        webhook_url=webhook_url,
        webhook_secret=webhook_secret,
        waha_base_url=waha_base_url,
        waha_session=waha_session,
        waha_session_prefix=waha_session_prefix,
        waha_token=waha_token,
        waha_send_path=waha_send_path,
        waha_chat_suffix=waha_chat_suffix,
        waha_auth_header=waha_auth_header,
        waha_auth_prefix=waha_auth_prefix,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="ENGYNE dispatcher worker")
    parser.add_argument("channel", choices=CHANNELS)
    parser.add_argument("--runtime-root", default=os.environ.get("RUNTIME_ROOT", "runtime"))
    args = parser.parse_args()

    cfg = load_cfg(args)
    try:
        while True:
            process_queue(cfg)
    except KeyboardInterrupt:
        return 0
    except Exception as exc:
        print(f"[dispatcher] fatal: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
