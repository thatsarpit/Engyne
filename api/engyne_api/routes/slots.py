from __future__ import annotations

import psutil
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from engyne_api.auth.deps import get_current_user
from engyne_api.db.models import User
from engyne_api.manager_service import get_manager
from engyne_api.settings import Settings, get_settings
from core.slot_fs import (
    SlotSnapshot,
    ensure_slots_root,
    list_slot_paths,
    read_leads_tail,
    read_slot_config,
    read_slot_snapshot,
    slot_paths,
    write_slot_config,
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


class SlotActionResponse(BaseModel):
    slot_id: str
    action: str
    status: str


class LeadItem(BaseModel):
    lead_id: str | None
    observed_at: str | None
    title: str | None
    country: str | None
    contact: str | None
    email: str | None
    phone: str | None
    verified: bool | None
    clicked: bool | None
    verification_source: str | None


class SlotConfigUpdate(BaseModel):
    quality_level: int | None = Field(default=None, ge=0, le=100)
    dry_run: bool | None = None
    auto_buy: bool | None = None
    max_leads_per_cycle: int | None = Field(default=None, ge=1, le=1000)
    max_clicks_per_cycle: int | None = Field(default=None, ge=0, le=100)
    max_run_minutes: int | None = Field(default=None, ge=1, le=1440)
    allowed_countries: list[str] | None = None
    blocked_countries: list[str] | None = None
    keywords: list[str] | None = None
    keywords_exclude: list[str] | None = None
    required_contact_methods: list[str] | None = None
    channels: dict[str, bool] | None = None


class SlotConfigReplace(BaseModel):
    config: dict


def _normalize_list(values: list[str] | None) -> list[str] | None:
    if values is None:
        return None
    cleaned = [str(v).strip().lower() for v in values if str(v).strip()]
    return cleaned


def _normalize_channels(channels: dict[str, bool] | None) -> dict[str, bool] | None:
    if channels is None:
        return None
    allowed = {"whatsapp", "telegram", "email", "sheets", "push", "slack"}
    cleaned: dict[str, bool] = {}
    for key, value in channels.items():
        name = str(key).strip().lower()
        if name in allowed:
            cleaned[name] = bool(value)
    return cleaned


def _assert_slot_access(user: User, slot_id: str) -> None:
    if user.role == "admin":
        return
    if slot_id not in user.allowed_slots:
        raise HTTPException(status_code=403, detail="slot access denied")


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
def list_slots(
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> list[SlotSummary]:
    ensure_slots_root(settings.slots_root_path)
    paths = list_slot_paths(settings.slots_root_path)
    if user.role != "admin":
        paths = [p for p in paths if p.slot_id in user.allowed_slots]
    snapshots = [read_slot_snapshot(p) for p in paths]
    return [_summary_from_snapshot(s) for s in snapshots]


@router.get("/{slot_id}", response_model=SlotDetail)
def get_slot(
    slot_id: str,
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> SlotDetail:
    ensure_slots_root(settings.slots_root_path)
    try:
        paths = slot_paths(settings.slots_root_path, slot_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="invalid slot_id")
    _assert_slot_access(user, slot_id)

    if not paths.root.exists():
        raise HTTPException(status_code=404, detail="slot not found")

    snapshot = read_slot_snapshot(paths)
    return _detail_from_snapshot(snapshot)


@router.get("/{slot_id}/leads", response_model=list[LeadItem])
def get_slot_leads(
    slot_id: str,
    limit: int = Query(default=200, ge=1, le=500),
    verified_only: bool = Query(default=False),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> list[LeadItem]:
    ensure_slots_root(settings.slots_root_path)
    try:
        paths = slot_paths(settings.slots_root_path, slot_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="invalid slot_id")
    _assert_slot_access(user, slot_id)

    if not paths.root.exists():
        raise HTTPException(status_code=404, detail="slot not found")

    records = read_leads_tail(paths.leads_path, limit=limit, verified_only=verified_only)
    results: list[LeadItem] = []
    for record in records:
        results.append(
            LeadItem(
                lead_id=record.get("lead_id"),
                observed_at=record.get("observed_at"),
                title=record.get("title"),
                country=record.get("country"),
                contact=record.get("contact"),
                email=record.get("email"),
                phone=record.get("phone"),
                verified=record.get("verified"),
                clicked=record.get("clicked"),
                verification_source=record.get("verification_source"),
            )
        )
    return results


@router.get("/{slot_id}/leads.jsonl")
def download_slot_leads(
    slot_id: str,
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> FileResponse:
    ensure_slots_root(settings.slots_root_path)
    try:
        paths = slot_paths(settings.slots_root_path, slot_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="invalid slot_id")
    _assert_slot_access(user, slot_id)

    if not paths.leads_path.exists():
        raise HTTPException(status_code=404, detail="leads not found")

    return FileResponse(
        path=paths.leads_path,
        media_type="application/jsonl",
        filename=f"{slot_id}_leads.jsonl",
    )


@router.patch("/{slot_id}/config", response_model=SlotDetail)
def patch_slot_config(
    slot_id: str,
    update: SlotConfigUpdate,
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> SlotDetail:
    ensure_slots_root(settings.slots_root_path)
    try:
        paths = slot_paths(settings.slots_root_path, slot_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="invalid slot_id")
    _assert_slot_access(user, slot_id)

    current = read_slot_config(paths.config_path)
    if not current:
        current = {"version": 1}

    payload = update.model_dump(exclude_unset=True)
    payload["allowed_countries"] = _normalize_list(payload.get("allowed_countries"))
    payload["blocked_countries"] = _normalize_list(payload.get("blocked_countries"))
    payload["keywords"] = _normalize_list(payload.get("keywords"))
    payload["keywords_exclude"] = _normalize_list(payload.get("keywords_exclude"))
    payload["required_contact_methods"] = _normalize_list(payload.get("required_contact_methods"))
    payload["channels"] = _normalize_channels(payload.get("channels"))

    if user.role != "admin":
        allowed_fields = {
            "quality_level",
            "dry_run",
            "max_clicks_per_cycle",
            "max_run_minutes",
            "allowed_countries",
            "keywords",
            "channels",
        }
        payload = {k: v for k, v in payload.items() if k in allowed_fields}

    for key, value in payload.items():
        if value is None:
            current.pop(key, None)
        else:
            current[key] = value

    current.setdefault("version", 1)
    write_slot_config(paths.config_path, current)
    snapshot = read_slot_snapshot(paths)
    return _detail_from_snapshot(snapshot)


@router.put("/{slot_id}/config", response_model=SlotDetail)
def replace_slot_config(
    slot_id: str,
    payload: SlotConfigReplace,
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> SlotDetail:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="admin role required")
    ensure_slots_root(settings.slots_root_path)
    try:
        paths = slot_paths(settings.slots_root_path, slot_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="invalid slot_id")

    if not isinstance(payload.config, dict):
        raise HTTPException(status_code=400, detail="config must be an object")

    updated = dict(payload.config)
    updated.setdefault("version", 1)
    write_slot_config(paths.config_path, updated)
    snapshot = read_slot_snapshot(paths)
    return _detail_from_snapshot(snapshot)


@router.post("/{slot_id}/start", response_model=SlotActionResponse)
def start_slot(
    slot_id: str,
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> SlotActionResponse:
    ensure_slots_root(settings.slots_root_path)
    mgr = get_manager()
    _assert_slot_access(user, slot_id)
    try:
        mgr.start_slot(slot_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="invalid slot_id")
    return SlotActionResponse(slot_id=slot_id, action="start", status="ok")


@router.post("/{slot_id}/stop", response_model=SlotActionResponse)
def stop_slot(
    slot_id: str,
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> SlotActionResponse:
    ensure_slots_root(settings.slots_root_path)
    mgr = get_manager()
    _assert_slot_access(user, slot_id)
    mgr.stop_slot(slot_id, force=True)
    return SlotActionResponse(slot_id=slot_id, action="stop", status="ok")


@router.post("/{slot_id}/restart", response_model=SlotActionResponse)
def restart_slot(
    slot_id: str,
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> SlotActionResponse:
    ensure_slots_root(settings.slots_root_path)
    mgr = get_manager()
    _assert_slot_access(user, slot_id)
    try:
        mgr.stop_slot(slot_id, force=True)
        mgr.start_slot(slot_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="invalid slot_id")
    return SlotActionResponse(slot_id=slot_id, action="restart", status="ok")
