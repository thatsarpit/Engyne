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
from typing import Any

HEARTBEAT_INTERVAL_SEC = 2.0


@dataclass
class RunnerConfig:
    slot_id: str
    slots_root: Path
    run_id: str


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_slot_config(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        import yaml

        return yaml.safe_load(path.read_text())
    except Exception:
        return None


def write_state(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2))
    tmp.replace(path)


def runner_main(cfg: RunnerConfig) -> int:
    state_path = cfg.slots_root / cfg.slot_id / "slot_state.json"
    pid_path = cfg.slots_root / cfg.slot_id / "slot_state.pid"
    config_path = cfg.slots_root / cfg.slot_id / "slot_config.yml"

    stopping = False

    def handle_signal(signum, frame):
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)

    pid = os.getpid()
    pid_path.write_text(str(pid))
    while not stopping:
        slot_config = load_slot_config(config_path) or {}
        state = {
            "slot_id": cfg.slot_id,
            "phase": "RUNNING",
            "pid": pid,
            "heartbeat_ts": utc_now(),
            "config_version": slot_config.get("version"),
            "run_id": cfg.run_id,
        }
        write_state(state_path, state)
        time.sleep(HEARTBEAT_INTERVAL_SEC)

    state = {
        "slot_id": cfg.slot_id,
        "phase": "STOPPING",
        "pid": pid,
        "heartbeat_ts": utc_now(),
        "run_id": cfg.run_id,
    }
    write_state(state_path, state)
    try:
        pid_path.unlink(missing_ok=True)
    except Exception:
        pass
    return 0


def main() -> int:
    if len(sys.argv) < 3:
        print("Usage: slot_runner.py <slots_root> <slot_id> [run_id]", file=sys.stderr)
        return 2
    slots_root = Path(sys.argv[1]).expanduser().resolve()
    slot_id = sys.argv[2]
    run_id = sys.argv[3] if len(sys.argv) > 3 else str(uuid.uuid4())
    cfg = RunnerConfig(slot_id=slot_id, slots_root=slots_root, run_id=run_id)
    return runner_main(cfg)


if __name__ == "__main__":
    raise SystemExit(main())
