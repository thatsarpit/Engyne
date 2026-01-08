from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

import requests
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from core.slot_fs import SlotSnapshot, ensure_slots_root, list_slot_paths, read_slot_snapshot
from engyne_api.settings import Settings, get_settings

router = APIRouter(prefix="/cluster", tags=["cluster"])


class ClusterSlotSummary(BaseModel):
    node_id: str
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


@dataclass
class NodeConfig:
    node_id: str
    base_url: str
    secret: str | None
    enabled: bool


def _summary_from_snapshot(snapshot: SlotSnapshot, node_id: str) -> ClusterSlotSummary:
    return ClusterSlotSummary(
        node_id=node_id,
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


def _load_nodes_config(settings: Settings) -> list[NodeConfig]:
    path = settings.nodes_config_path_path
    if not path.exists():
        return []
    try:
        import yaml

        data = yaml.safe_load(path.read_text())
    except Exception:
        return []
    if not isinstance(data, dict):
        return []
    nodes = data.get("nodes")
    if not isinstance(nodes, list):
        return []
    parsed: list[NodeConfig] = []
    for item in nodes:
        if not isinstance(item, dict):
            continue
        node_id = str(item.get("id") or item.get("node_id") or "").strip()
        base_url = str(item.get("base_url") or "").strip().rstrip("/")
        if not node_id or not base_url:
            continue
        enabled = item.get("enabled")
        if enabled is None:
            enabled = True
        parsed.append(
            NodeConfig(
                node_id=node_id,
                base_url=base_url,
                secret=str(item.get("secret") or "").strip() or None,
                enabled=bool(enabled),
            )
        )
    return parsed


@router.get("/slots", response_model=list[ClusterSlotSummary])
def get_cluster_slots(settings: Settings = Depends(get_settings)) -> list[ClusterSlotSummary]:
    results: list[ClusterSlotSummary] = []

    ensure_slots_root(settings.slots_root_path)
    local_snapshots = [read_slot_snapshot(p) for p in list_slot_paths(settings.slots_root_path)]
    results.extend([_summary_from_snapshot(s, settings.node_id) for s in local_snapshots])

    nodes = _load_nodes_config(settings)
    if not nodes:
        return results

    for node in nodes:
        if not node.enabled:
            continue
        headers = {}
        secret = node.secret or settings.node_shared_secret
        if secret:
            headers["X-Engyne-Node-Secret"] = secret
        url = f"{node.base_url}/node/slots/snapshot"
        try:
            resp = requests.post(url, headers=headers, timeout=settings.cluster_request_timeout_seconds)
            resp.raise_for_status()
            payload = resp.json()
        except Exception:
            continue
        if not isinstance(payload, dict):
            continue
        slots = payload.get("slots")
        if not isinstance(slots, list):
            continue
        node_id = str(payload.get("node_id") or node.node_id)
        for slot in slots:
            if not isinstance(slot, dict):
                continue
            slot["node_id"] = node_id
            try:
                results.append(ClusterSlotSummary(**slot))
            except Exception:
                continue
    return results
