from __future__ import annotations

import secrets
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from core.slot_fs import SlotSnapshot, ensure_slots_root, list_slot_paths, read_slot_snapshot
from engyne_api.db.deps import get_db
from engyne_api.db.models import NodeRegistry
from engyne_api.settings import Settings, get_settings

router = APIRouter(prefix="/node", tags=["node"])


class NodeInfo(BaseModel):
    node_id: str
    slots_count: int


class NodeSlotSnapshot(BaseModel):
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


class NodeSnapshotResponse(BaseModel):
    node_id: str
    slots: list[NodeSlotSnapshot]


def _summary_from_snapshot(snapshot: SlotSnapshot) -> NodeSlotSnapshot:
    return NodeSlotSnapshot(
        slot_id=snapshot.slot_id,
        phase=snapshot.phase,
        pid=snapshot.pid,
        pid_alive=snapshot.pid_alive,
        heartbeat_ts=snapshot.heartbeat_ts.isoformat() if snapshot.heartbeat_ts else None,
        heartbeat_age_seconds=snapshot.heartbeat_age_seconds,
        has_config=snapshot.config is not None,
        has_state=snapshot.state is not None,
        has_status=snapshot.status is not None,
        leads_count=snapshot.leads_count,
    )


def _require_node_secret(request: Request, settings: Settings) -> None:
    if not settings.node_shared_secret:
        return
    token = request.headers.get("X-Engyne-Node-Secret", "")
    if not secrets.compare_digest(token, settings.node_shared_secret):
        raise HTTPException(status_code=403, detail="invalid node secret")


def _update_node_registry(db: Session, settings: Settings, slots_count: int) -> None:
    now = datetime.now(timezone.utc)
    existing = db.query(NodeRegistry).filter(NodeRegistry.node_id == settings.node_id).one_or_none()
    payload = {
        "public_api_base_url": str(settings.public_api_base_url),
        "public_dashboard_base_url": str(settings.public_dashboard_base_url),
    }
    if existing:
        existing.slots_count = slots_count
        existing.node_metadata = payload
        existing.last_seen_at = now
    else:
        db.add(
            NodeRegistry(
                node_id=settings.node_id,
                slots_count=slots_count,
                node_metadata=payload,
                last_seen_at=now,
            )
        )
    db.commit()


@router.get("", response_model=NodeInfo)
def get_node_info(
    request: Request,
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_db),
) -> NodeInfo:
    _require_node_secret(request, settings)
    ensure_slots_root(settings.slots_root_path)
    count = len(list_slot_paths(settings.slots_root_path))
    _update_node_registry(db, settings, count)
    return NodeInfo(node_id=settings.node_id, slots_count=count)


@router.post("/slots/snapshot", response_model=NodeSnapshotResponse)
def get_slot_snapshot(
    request: Request,
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_db),
) -> NodeSnapshotResponse:
    _require_node_secret(request, settings)
    ensure_slots_root(settings.slots_root_path)
    snapshots = [read_slot_snapshot(p) for p in list_slot_paths(settings.slots_root_path)]
    _update_node_registry(db, settings, len(snapshots))
    return NodeSnapshotResponse(
        node_id=settings.node_id, slots=[_summary_from_snapshot(s) for s in snapshots]
    )
