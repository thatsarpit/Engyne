from __future__ import annotations

import json
import os
import signal
import sys
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

import requests

from core.queues import append_jsonl
from core.quality import quality_mapping

Phase = Literal["BOOT", "INIT", "PARSE_LEADS", "LOGIN_REQUIRED", "COOLDOWN", "STOPPING", "ERROR"]


@dataclass
class WorkerConfig:
    slot_id: str
    slots_root: Path
    run_id: str
    api_base: str
    worker_secret: str
    heartbeat_interval: float
    leads_limit: int = 10
    cooldown_seconds: float = 2.0


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def read_slot_config(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        import yaml

        data = yaml.safe_load(path.read_text())
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def write_state(cfg: WorkerConfig, phase: Phase, extra: dict | None = None) -> None:
    slot_dir = cfg.slots_root / cfg.slot_id
    slot_dir.mkdir(parents=True, exist_ok=True)
    state_path = slot_dir / "slot_state.json"
    payload = {
        "slot_id": cfg.slot_id,
        "phase": phase,
        "run_id": cfg.run_id,
        "pid": os.getpid(),
        "heartbeat_ts": utc_now(),
    }
    if extra:
        payload.update(extra)
    tmp = state_path.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, indent=2))
    tmp.replace(state_path)


def append_lead(slot_dir: Path, lead: dict) -> None:
    leads_path = slot_dir / "leads.jsonl"
    append_jsonl(leads_path, lead)


def emit_verified(cfg: WorkerConfig, lead_id: str, payload: dict | None = None) -> None:
    url = f"{cfg.api_base}/events/verified"
    headers = {
        "Content-Type": "application/json",
        "X-Engyne-Worker-Secret": cfg.worker_secret,
    }
    body = {
        "slot_id": cfg.slot_id,
        "lead_id": lead_id,
        "observed_at": utc_now(),
        "payload": payload or {},
    }
    try:
        requests.post(url, headers=headers, json=body, timeout=5)
    except Exception:
        pass


def worker_main(cfg: WorkerConfig) -> int:
    slot_dir = cfg.slots_root / cfg.slot_id
    slot_dir.mkdir(parents=True, exist_ok=True)
    slot_config_path = slot_dir / "slot_config.yml"

    stopping = False

    def handle_signal(signum, frame):
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)

    write_state(cfg, "BOOT")
    time.sleep(0.5)
    write_state(cfg, "INIT")

    while not stopping:
        cfg_data = read_slot_config(slot_config_path)
        heartbeat_extra = {"config_version": cfg_data.get("version")}
        quality_level = int(cfg_data.get("quality_level", 0)) if isinstance(cfg_data.get("quality_level"), (int, float)) else 0
        quality_policy = quality_mapping(quality_level)

        # Simulate parsing leads
        leads_found = []
        for i in range(cfg.leads_limit):
            lead_id = f"{cfg.slot_id}-{cfg.run_id}-{i}"
            lead = {
                "lead_id": lead_id,
                "observed_at": utc_now(),
                "meta": {
                    "quality_level": quality_level,
                    **quality_policy,
                },
            }
            leads_found.append(lead)
            append_lead(slot_dir, lead)
            emit_verified(cfg, lead_id=lead_id, payload=lead["meta"])

        write_state(cfg, "PARSE_LEADS", extra=heartbeat_extra)
        time.sleep(cfg.cooldown_seconds)

    write_state(cfg, "STOPPING")
    return 0


def main() -> int:
    if len(sys.argv) < 6:
        print(
            "Usage: worker_indiamart_stub.py <slots_root> <slot_id> <run_id> <api_base> <worker_secret> [heartbeat_interval]",
            file=sys.stderr,
        )
        return 2
    slots_root = Path(sys.argv[1]).expanduser().resolve()
    slot_id = sys.argv[2]
    run_id = sys.argv[3] if len(sys.argv) > 3 else str(uuid.uuid4())
    api_base = sys.argv[4].rstrip("/")
    worker_secret = sys.argv[5]
    heartbeat = float(sys.argv[6]) if len(sys.argv) > 6 else 2.0
    cfg = WorkerConfig(
        slot_id=slot_id,
        slots_root=slots_root,
        run_id=run_id,
        api_base=api_base,
        worker_secret=worker_secret,
        heartbeat_interval=heartbeat,
    )
    return worker_main(cfg)


if __name__ == "__main__":
    raise SystemExit(main())
