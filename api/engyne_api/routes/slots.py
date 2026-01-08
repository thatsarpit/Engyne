from __future__ import annotations

import psutil
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from engyne_api.settings import Settings, get_settings
from core.slot_fs import (
    SlotSnapshot,
    ensure_slots_root,
    list_slot_paths,
    read_slot_snapshot,
    slot_paths,
)

router = APIRouter(prefix="/slots", tags=["slots"])


class SlotSummary(BaseModel):
    slot_id: str
    phase: str | None
    pid: int | None
    pid_alive: bool | None
    heartbeat_ts: str | None
    heartbeat_age_seconds: float | None
    has_config: bool
    has_state: bool
    has_status: bool
    leads_count: int | None


class SlotDetail(SlotSummary):
    config: dict | None
    state: dict | None
    status: dict | None


def _summary_from_snapshot(snapshot: SlotSnapshot) -> SlotSummary:
    pid_alive = None
    if snapshot.pid:
        try:
            pid_alive = psutil.pid_exists(snapshot.pid)
        except Exception:
            pid_alive = None
    return SlotSummary(
        slot_id=snapshot.slot_id,
        phase=snapshot.phase,
        pid=snapshot.pid,
        pid_alive=pid_alive,
        heartbeat_ts=snapshot.heartbeat_ts.isoformat() if snapshot.heartbeat_ts else None,
        heartbeat_age_seconds=snapshot.heartbeat_age_seconds,
        has_config=snapshot.config is not None,
        has_state=snapshot.state is not None,
        has_status=snapshot.status is not None,
        leads_count=snapshot.leads_count,
    )


def _detail_from_snapshot(snapshot: SlotSnapshot) -> SlotDetail:
    summary = _summary_from_snapshot(snapshot)
    return SlotDetail(
        **summary.model_dump(),
        config=snapshot.config,
        state=snapshot.state,
        status=snapshot.status,
    )


@router.get("", response_model=list[SlotSummary])
def list_slots(settings: Settings = Depends(get_settings)) -> list[SlotSummary]:
    ensure_slots_root(settings.slots_root_path)
    snapshots = [read_slot_snapshot(p) for p in list_slot_paths(settings.slots_root_path)]
    return [_summary_from_snapshot(s) for s in snapshots]


@router.get("/{slot_id}", response_model=SlotDetail)
def get_slot(slot_id: str, settings: Settings = Depends(get_settings)) -> SlotDetail:
    ensure_slots_root(settings.slots_root_path)
    try:
        paths = slot_paths(settings.slots_root_path, slot_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="invalid slot_id")

    if not paths.root.exists():
        raise HTTPException(status_code=404, detail="slot not found")

    snapshot = read_slot_snapshot(paths)
    return _detail_from_snapshot(snapshot)

