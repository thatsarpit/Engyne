from __future__ import annotations

import subprocess
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, Optional

import psutil

from core.slot_fs import SlotSnapshot, ensure_slots_root, list_slot_paths, read_slot_snapshot, validate_slot_id

HEARTBEAT_TTL_SECONDS = 30
SCAN_INTERVAL_SECONDS = 3
MIN_RESTART_INTERVAL_SECONDS = 5


@dataclass
class ManagedSlot:
    slot_id: str
    process: Optional[subprocess.Popen] = None
    last_snapshot: Optional[SlotSnapshot] = None
    last_start_ts: Optional[datetime] = None
    last_stop_ts: Optional[datetime] = None
    last_restart_ts: Optional[datetime] = None
    pid_alive: Optional[bool] = None
    disabled: bool = False


class SlotManager:
    def __init__(self, slots_root: Path, python_exec: str = sys.executable) -> None:
        self.slots_root = ensure_slots_root(slots_root)
        self.python_exec = python_exec
        self.slots: Dict[str, ManagedSlot] = {}

    def scan_slots(self) -> None:
        """Discover slot directories and register them."""
        for paths in list_slot_paths(self.slots_root):
            if paths.slot_id not in self.slots:
                self.slots[paths.slot_id] = ManagedSlot(slot_id=paths.slot_id)

    def _runner_cmd(self, slot_id: str) -> list[str]:
        runner_path = Path(__file__).parent / "slot_runner.py"
        return [self.python_exec, str(runner_path), str(self.slots_root), slot_id]

    def start_slot(self, slot_id: str) -> None:
        validate_slot_id(slot_id)
        slot_dir = self.slots_root / slot_id
        slot_dir.mkdir(parents=True, exist_ok=True)

        managed = self.slots.setdefault(slot_id, ManagedSlot(slot_id=slot_id))
        managed.disabled = False
        # Avoid rapid restart churn
        now = datetime.now(timezone.utc)
        if managed.last_start_ts and (now - managed.last_start_ts) < timedelta(seconds=MIN_RESTART_INTERVAL_SECONDS):
            return
        if managed.process and managed.process.poll() is None:
            return

        proc = subprocess.Popen(
            self._runner_cmd(slot_id),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        managed.process = proc
        managed.last_start_ts = now

    def stop_slot(self, slot_id: str, force: bool = False) -> None:
        managed = self.slots.get(slot_id)
        if not managed:
            return
        managed.disabled = True
        proc = managed.process
        if proc and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                if force:
                    proc.kill()
                    try:
                        proc.wait(timeout=3)
                    except subprocess.TimeoutExpired:
                        pass
        managed.last_stop_ts = datetime.now(timezone.utc)
        managed.process = None

    def update_snapshot(self, slot_id: str) -> None:
        try:
            paths = next(p for p in list_slot_paths(self.slots_root) if p.slot_id == slot_id)
        except StopIteration:
            return
        snapshot = read_slot_snapshot(paths)
        managed = self.slots.setdefault(slot_id, ManagedSlot(slot_id=slot_id))
        managed.last_snapshot = snapshot
        managed.pid_alive = None
        if snapshot.pid:
            try:
                managed.pid_alive = psutil.pid_exists(snapshot.pid)
            except Exception:
                managed.pid_alive = None

    def refresh_snapshots(self) -> None:
        for slot_id in list(self.slots.keys()):
            self.update_snapshot(slot_id)

    def enforce_heartbeat(self) -> None:
        now = datetime.now(timezone.utc)
        for managed in list(self.slots.values()):
            snap = managed.last_snapshot
            if snap is None:
                continue
            if managed.disabled:
                continue
            stale_hb = snap.heartbeat_ts is None or (now - snap.heartbeat_ts) > timedelta(
                seconds=HEARTBEAT_TTL_SECONDS
            )
            proc_dead = managed.process is None or managed.process.poll() is not None
            pid_dead = managed.pid_alive is False
            if stale_hb or proc_dead or pid_dead:
                self.start_slot(managed.slot_id)

    def tick(self) -> None:
        self.scan_slots()
        self.refresh_snapshots()
        self.enforce_heartbeat()

    def stop_all(self) -> None:
        for slot_id in list(self.slots.keys()):
            self.stop_slot(slot_id, force=True)


def main() -> int:
    slots_root = Path(sys.argv[1]).expanduser().resolve() if len(sys.argv) > 1 else Path("slots").resolve()
    manager = SlotManager(slots_root=slots_root)
    try:
        while True:
            manager.tick()
            time.sleep(SCAN_INTERVAL_SECONDS)
    except KeyboardInterrupt:
        manager.stop_all()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
