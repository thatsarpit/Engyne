from __future__ import annotations

import subprocess
import sys
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, Optional

import psutil
import json
import os

from core.alerts import send_slack_alert
from core.slot_fs import SlotSnapshot, ensure_slots_root, list_slot_paths, read_slot_snapshot, validate_slot_id

HEARTBEAT_TTL_SECONDS_DEFAULT = 30
SCAN_INTERVAL_SECONDS = 3
MIN_RESTART_INTERVAL_SECONDS = 5
RUN_META_FILENAME = "run_meta.json"


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
    run_id: Optional[str] = None
    last_alert_ts: Optional[datetime] = None
    last_alert_reason: Optional[str] = None


class SlotManager:
    def __init__(
        self,
        slots_root: Path,
        python_exec: str = sys.executable,
        api_base: str = "",
        worker_secret: str = "",
        heartbeat_interval: float = 2.0,
        heartbeat_ttl: float = HEARTBEAT_TTL_SECONDS_DEFAULT,
        worker_mode: str = "stub",
        profile_path: Path | None = None,
    ) -> None:
        self.slots_root = ensure_slots_root(slots_root)
        self.python_exec = python_exec
        self.api_base = api_base.rstrip("/") if api_base else ""
        self.worker_secret = worker_secret
        self.heartbeat_interval = heartbeat_interval
        self.heartbeat_ttl = heartbeat_ttl
        self.worker_mode = (worker_mode or "stub").strip().lower()
        self.profile_path_override = profile_path
        self.slots: Dict[str, ManagedSlot] = {}
        self.repo_root = Path(__file__).resolve().parent.parent
        self.node_id = os.environ.get("NODE_ID", "local")
        try:
            self.alert_throttle_seconds = float(os.environ.get("ALERTS_MIN_SECONDS", "300"))
        except Exception:
            self.alert_throttle_seconds = 300.0

    def scan_slots(self) -> None:
        """Discover slot directories and register them."""
        for paths in list_slot_paths(self.slots_root):
            if paths.slot_id not in self.slots:
                self.slots[paths.slot_id] = ManagedSlot(slot_id=paths.slot_id)

    def _runner_cmd(self, slot_id: str, run_id: str) -> list[str]:
        runner_path = Path(__file__).parent / "slot_runner.py"
        return [self.python_exec, str(runner_path), str(self.slots_root), slot_id, run_id]

    def _resolve_profile_path(self, slot_id: str) -> Path:
        if self.profile_path_override:
            path = self.profile_path_override
        else:
            path = self.repo_root / "browser_profiles" / slot_id
        path.mkdir(parents=True, exist_ok=True)
        return path

    def _worker_cmd(self, slot_id: str, run_id: str, profile_path: Path | None = None) -> list[str]:
        mode = self.worker_mode
        if mode == "playwright":
            worker_path = Path(__file__).parent / "worker_indiamart.py"
            if profile_path is None:
                raise ValueError("profile_path is required for Playwright worker mode")
            return [
                self.python_exec,
                str(worker_path),
                str(self.slots_root),
                slot_id,
                run_id,
                self.api_base,
                self.worker_secret,
                str(profile_path),
                str(self.heartbeat_interval),
            ]
        worker_path = Path(__file__).parent / "worker_indiamart_stub.py"
        return [
            self.python_exec,
            str(worker_path),
            str(self.slots_root),
            slot_id,
            run_id,
            self.api_base,
            self.worker_secret,
            str(self.heartbeat_interval),
        ]

    def _write_run_meta(self, slot_id: str, run_id: str) -> None:
        slot_dir = self.slots_root / slot_id
        slot_dir.mkdir(parents=True, exist_ok=True)
        meta_path = slot_dir / RUN_META_FILENAME
        data = {
            "slot_id": slot_id,
            "run_id": run_id,
            "started_at": datetime.now(timezone.utc).isoformat(),
        }
        meta_path.write_text(json.dumps(data, indent=2))

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

        run_id = str(uuid.uuid4())
        self._write_run_meta(slot_id, run_id)

        profile_path: Path | None = None
        if self.worker_mode == "playwright":
            profile_path = self._resolve_profile_path(slot_id)

        env = os.environ.copy()
        py_path_parts = [str(self.repo_root), env.get("PYTHONPATH", "")]
        env["PYTHONPATH"] = ":".join([p for p in py_path_parts if p])

        proc = subprocess.Popen(
            self._worker_cmd(slot_id, run_id, profile_path=profile_path),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            env=env,
        )
        managed.process = proc
        managed.last_start_ts = now
        managed.last_restart_ts = now
        managed.run_id = run_id

    def stop_slot(self, slot_id: str, force: bool = False) -> None:
        managed = self.slots.get(slot_id)
        if not managed:
            return
        managed.disabled = True
        managed.last_restart_ts = datetime.now(timezone.utc)
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
                seconds=self.heartbeat_ttl
            )
            proc_dead = managed.process is None or managed.process.poll() is not None
            pid_dead = managed.pid_alive is False
            if stale_hb or proc_dead or pid_dead:
                reasons = []
                if stale_hb:
                    if snap.heartbeat_ts is None:
                        reasons.append("heartbeat missing")
                    else:
                        age = (now - snap.heartbeat_ts).total_seconds()
                        reasons.append(f"heartbeat stale ({int(age)}s)")
                if proc_dead:
                    reasons.append("process exited")
                if pid_dead:
                    reasons.append("pid not alive")
                reason_text = ", ".join(reasons) if reasons else "unknown"
                should_alert = False
                if managed.last_alert_ts is None:
                    should_alert = True
                else:
                    elapsed = (now - managed.last_alert_ts).total_seconds()
                    if elapsed >= self.alert_throttle_seconds:
                        should_alert = True
                if managed.last_alert_reason != reason_text:
                    should_alert = True
                if should_alert:
                    send_slack_alert(
                        title="ENGYNE slot restart",
                        message=f"node={self.node_id} slot={managed.slot_id} reason={reason_text}",
                    )
                    managed.last_alert_ts = now
                    managed.last_alert_reason = reason_text
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
