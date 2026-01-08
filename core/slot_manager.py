from __future__ import annotations

import subprocess
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, Optional

from core.slot_fs import SlotSnapshot, ensure_slots_root, list_slot_paths, read_slot_snapshot, validate_slot_id

HEARTBEAT_TTL_SECONDS = 30
SCAN_INTERVAL_SECONDS = 3


@dataclass
class ManagedSlot:
    slot_id: str
    process: Optional[subprocess.Popen] = None
    last_snapshot: Optional[SlotSnapshot] = None
    last_start_ts: Optional[datetime] = None
    last_stop_ts: Optional[datetime] = None


class SlotManager:
    def __init__(self, slots_root: Path, python_exec: str = sys.executable) -> None:
        self.slots_root = ensure_slots_root(slots_root)
        self.python_exec = python_exec
        self.slots: Dict[str, ManagedSlot] = {}

    def scan_slots(self) -> None:
        for paths in list_slot_paths(self.slots_root):
            if paths.slot_id not in self.slots:
                self.slots[paths.slot_id] = ManagedSlot(slot_id=paths.slot_id)

    def start_slot(self, slot_id: str) -> None:
        validate_slot_id(slot_id)
        slot_dir = self.slots_root / slot_id
        slot_dir.mkdir(parents=True, exist_ok=True)
        runner_path = Path(__file__).parent / "slot_runner.py"
        proc = subprocess.Popen(
            [self.python_exec, str(runner_path), str(self.slots_root), slot_id],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        managed = self.slots.setdefault(slot_id, ManagedSlot(slot_id=slot_id))
        managed.process = proc
        managed.last_start_ts = datetime.now(timezone.utc)

    def stop_slot(self, slot_id: str) -> None:
        managed = self.slots.get(slot_id)
        if not managed or not managed.process:
            return
        managed.process.terminate()
        try:
            managed.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            managed.process.kill()
        managed.last_stop_ts = datetime.now(timezone.utc)
        managed.process = None

    def refresh_snapshots(self) -> None:
        for slot_id in list(self.slots.keys()):
            self.update_snapshot(slot_id)

    def update_snapshot(self, slot_id: str) -> None:
        try:
            paths = next(p for p in list_slot_paths(self.slots_root) if p.slot_id == slot_id)
        except StopIteration:
            return
        snapshot = read_slot_snapshot(paths)
        self.slots[slot_id].last_snapshot = snapshot

    def enforce_heartbeat(self) -> None:
        now = datetime.now(timezone.utc)
        for managed in list(self.slots.values()):
            snapshot = managed.last_snapshot
            if snapshot is None:
                continue
            hb = snapshot.heartbeat_ts
            if managed.process and (hb is None or (now - hb) > timedelta(seconds=HEARTBEAT_TTL_SECONDS)):
                self.stop_slot(managed.slot_id)
                self.start_slot(managed.slot_id)

    def tick(self) -> None:
        self.scan_slots()
        self.refresh_snapshots()
        self.enforce_heartbeat()


def main() -> int:
    slots_root = Path(sys.argv[1]).expanduser().resolve() if len(sys.argv) > 1 else Path("slots").resolve()
    manager = SlotManager(slots_root=slots_root)
    while True:
        manager.tick()
        time.sleep(SCAN_INTERVAL_SECONDS)


if __name__ == "__main__":
    raise SystemExit(main())

