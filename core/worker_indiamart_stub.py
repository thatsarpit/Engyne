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

Phase = Literal["BOOT", "INIT", "PARSE_LEADS", "LOGIN_REQUIRED", "COOLDOWN", "STOPPING", "ERROR"]

HEARTBEAT_INTERVAL = 2.0


@dataclass
class WorkerConfig:
    slot_id: str
    slots_root: Path
    run_id: str


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


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


def worker_main(cfg: WorkerConfig) -> int:
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
        write_state(cfg, "PARSE_LEADS")
        time.sleep(HEARTBEAT_INTERVAL)

    write_state(cfg, "STOPPING")
    return 0


def main() -> int:
    if len(sys.argv) < 3:
        print("Usage: worker_indiamart_stub.py <slots_root> <slot_id> [run_id]", file=sys.stderr)
        return 2
    slots_root = Path(sys.argv[1]).expanduser().resolve()
    slot_id = sys.argv[2]
    run_id = sys.argv[3] if len(sys.argv) > 3 else str(uuid.uuid4())
    cfg = WorkerConfig(slot_id=slot_id, slots_root=slots_root, run_id=run_id)
    return worker_main(cfg)


if __name__ == "__main__":
    raise SystemExit(main())

