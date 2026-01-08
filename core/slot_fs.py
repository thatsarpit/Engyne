from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml

SLOT_ID_PATTERN = re.compile(r"^[A-Za-z0-9._-]+$")


@dataclass(frozen=True)
class SlotPaths:
    slot_id: str
    root: Path
    config_path: Path
    state_path: Path
    status_path: Path
    leads_path: Path


@dataclass(frozen=True)
class SlotSnapshot:
    slot_id: str
    config: dict[str, Any] | None
    state: dict[str, Any] | None
    status: dict[str, Any] | None
    leads_count: int | None
    heartbeat_ts: datetime | None
    heartbeat_age_seconds: float | None
    pid: int | None
    phase: str | None
    paths: SlotPaths


def ensure_slots_root(slots_root: Path) -> Path:
    root = slots_root.expanduser()
    root.mkdir(parents=True, exist_ok=True)
    return root


def validate_slot_id(slot_id: str) -> str:
    if not SLOT_ID_PATTERN.fullmatch(slot_id):
        raise ValueError("invalid slot_id (use alnum, dot, underscore, dash)")
    return slot_id


def slot_paths(slots_root: Path, slot_id: str) -> SlotPaths:
    validate_slot_id(slot_id)
    root = (slots_root / slot_id).resolve()
    root_parent = slots_root.resolve()
    if root_parent != root and root_parent not in root.parents:
        raise ValueError("slot path escapes slots root")
    return SlotPaths(
        slot_id=slot_id,
        root=root,
        config_path=root / "slot_config.yml",
        state_path=root / "slot_state.json",
        status_path=root / "status.json",
        leads_path=root / "leads.jsonl",
    )


def list_slot_paths(slots_root: Path) -> list[SlotPaths]:
    root = ensure_slots_root(slots_root)
    results: list[SlotPaths] = []
    for entry in sorted(root.iterdir()):
        if entry.is_dir():
            try:
                results.append(slot_paths(slots_root=root, slot_id=entry.name))
            except ValueError:
                continue
    return results


def _read_json(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _read_yaml(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        with path.open("r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
            if isinstance(data, dict):
                return data
    except Exception:
        return None
    return None


def _count_lines(path: Path) -> int | None:
    if not path.exists():
        return None
    try:
        count = 0
        with path.open("r", encoding="utf-8") as f:
            for count, _ in enumerate(f, start=1):
                pass
        return count
    except Exception:
        return None


def _parse_dt(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        try:
            return datetime.fromtimestamp(value, tz=timezone.utc)
        except Exception:
            return None
    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return None
        try:
            if raw.endswith("Z"):
                raw = raw[:-1] + "+00:00"
            return datetime.fromisoformat(raw)
        except Exception:
            return None
    return None


def _extract_heartbeat(state: dict[str, Any] | None, status: dict[str, Any] | None) -> datetime | None:
    for doc in (state, status):
        if not isinstance(doc, dict):
            continue
        for key in ("heartbeat_ts", "heartbeat", "last_heartbeat", "heartbeat_at"):
            dt = _parse_dt(doc.get(key))
            if dt:
                return dt
    return None


def _extract_pid(state: dict[str, Any] | None, status: dict[str, Any] | None) -> int | None:
    for doc in (state, status):
        if not isinstance(doc, dict):
            continue
        for key in ("pid", "worker_pid", "runner_pid"):
            val = doc.get(key)
            if isinstance(val, int) and val > 0:
                return val
    return None


def _extract_phase(state: dict[str, Any] | None, status: dict[str, Any] | None) -> str | None:
    for doc in (state, status):
        if not isinstance(doc, dict):
            continue
        for key in ("phase", "status", "state"):
            val = doc.get(key)
            if isinstance(val, str) and val.strip():
                return val
    return None


def read_slot_snapshot(paths: SlotPaths) -> SlotSnapshot:
    config = _read_yaml(paths.config_path)
    state = _read_json(paths.state_path)
    status = _read_json(paths.status_path)
    leads_count = _count_lines(paths.leads_path)

    heartbeat_ts = _extract_heartbeat(state, status)
    pid = _extract_pid(state, status)
    phase = _extract_phase(state, status)

    heartbeat_age_seconds: float | None = None
    if heartbeat_ts:
        now = datetime.now(timezone.utc)
        heartbeat_age_seconds = max(0.0, (now - heartbeat_ts).total_seconds())

    return SlotSnapshot(
        slot_id=paths.slot_id,
        config=config,
        state=state,
        status=status,
        leads_count=leads_count,
        heartbeat_ts=heartbeat_ts,
        heartbeat_age_seconds=heartbeat_age_seconds,
        pid=pid,
        phase=phase,
        paths=paths,
    )

