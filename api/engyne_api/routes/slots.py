from __future__ import annotations

import psutil
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from engyne_api.audit import log_audit
from engyne_api.auth.deps import get_current_user
from engyne_api.db.deps import get_db
from engyne_api.db.models import User
from engyne_api.manager_service import get_manager
from engyne_api.settings import Settings, get_settings
from core.lead_rules import (
    country_matches,
    extract_member_since_text,
    extract_structured_fields,
    extract_time_text,
    keywords_match,
    normalize_keyword_text,
    normalize_list as normalize_list_rules,
    normalize_method,
    parse_age_hours,
    parse_member_months,
    text_contains_any,
)
from core.quality import quality_mapping
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
    keyword_fuzzy: bool | None = None
    keyword_fuzzy_threshold: float | None = Field(default=None, ge=0.5, le=0.99)
    channels: dict[str, bool] | None = None


class SlotConfigReplace(BaseModel):
    config: dict


class SlotProvisionRequest(BaseModel):
    slot_id: str


class SlotConfigPreviewRequest(BaseModel):
    config: dict | None = None
    limit: int = Field(default=50, ge=1, le=500)


class SlotConfigPreviewDecision(BaseModel):
    keep: bool
    reject_reason: str | None
    country_match: bool | None = None
    missing_contact_methods: list[str] = []


class SlotConfigPreviewLead(BaseModel):
    lead_id: str | None
    observed_at: str | None
    title: str | None
    country: str | None
    category_text: str | None
    time_text: str | None
    age_hours: float | None
    member_months: int | None
    member_since_text: str | None
    availability: list[str] | None
    quantity_text: str | None
    strength_text: str | None
    packaging_text: str | None
    intent_text: str | None
    buys_text: str | None
    retail_hint: bool | None
    engagement_requirements: int | None
    engagement_calls: int | None
    engagement_replies: int | None
    decision: SlotConfigPreviewDecision


class SlotConfigPreviewSummary(BaseModel):
    total: int
    kept: int
    rejected: int
    reject_reasons: dict[str, int]


class SlotConfigPreviewResponse(BaseModel):
    slot_id: str
    limit: int
    evaluated: int
    summary: SlotConfigPreviewSummary
    leads: list[SlotConfigPreviewLead]


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


CLIENT_CONFIG_FIELDS = {
    "quality_level",
    "dry_run",
    "max_clicks_per_cycle",
    "max_run_minutes",
    "allowed_countries",
    "keywords",
    "keywords_exclude",
    "required_contact_methods",
    "channels",
    "keyword_fuzzy",
    "keyword_fuzzy_threshold",
}


def _is_real_lead(record: dict) -> bool:
    return bool(record.get("title") or record.get("country") or record.get("category_text"))


def _build_preview_config(base: dict, override: dict | None, user: User) -> dict:
    config = dict(base or {})
    if override:
        if not isinstance(override, dict):
            raise HTTPException(status_code=400, detail="config override must be an object")
        payload = dict(override)
        if user.role != "admin":
            payload = {k: v for k, v in payload.items() if k in CLIENT_CONFIG_FIELDS}
        for key, value in payload.items():
            if key == "channels":
                normalized = _normalize_channels(value if isinstance(value, dict) else None)
                if normalized is None:
                    continue
                merged = dict(config.get("channels") or {})
                merged.update(normalized)
                config["channels"] = merged
                continue
            config[key] = value

    config["allowed_countries"] = normalize_list_rules(config.get("allowed_countries"))
    config["blocked_countries"] = normalize_list_rules(config.get("blocked_countries"))
    config["keywords"] = normalize_list_rules(config.get("keywords"))
    config["keywords_exclude"] = normalize_list_rules(config.get("keywords_exclude"))
    config["required_contact_methods"] = [
        normalize_method(v)
        for v in normalize_list_rules(config.get("required_contact_methods"))
        if str(v).strip()
    ]
    try:
        config["quality_level"] = int(config.get("quality_level", 0))
    except Exception:
        config["quality_level"] = 0
    config["keyword_fuzzy"] = bool(config.get("keyword_fuzzy", False))
    try:
        config["keyword_fuzzy_threshold"] = float(config.get("keyword_fuzzy_threshold", 0.88))
    except Exception:
        config["keyword_fuzzy_threshold"] = 0.88
    return config


def _evaluate_lead_preview(record: dict, config: dict) -> tuple[SlotConfigPreviewDecision, dict]:
    text_blob = str(record.get("text") or "")
    time_text = record.get("time_text") or extract_time_text(text_blob)
    age_hours = record.get("age_hours") or parse_age_hours(time_text or text_blob)
    member_since_text = record.get("member_since_text") or extract_member_since_text(text_blob)
    member_months = record.get("member_months") or parse_member_months(member_since_text or text_blob)
    availability = [normalize_method(v) for v in (record.get("availability") or []) if str(v).strip()]
    structured = extract_structured_fields(text_blob)

    quantity_text = record.get("quantity_text") or structured.get("quantity_text")
    strength_text = record.get("strength_text") or structured.get("strength_text")
    packaging_text = record.get("packaging_text") or structured.get("packaging_text")
    intent_text = record.get("intent_text") or structured.get("intent_text")
    buys_text = record.get("buys_text") or structured.get("buys_text")
    retail_hint = record.get("retail_hint")
    if retail_hint is None:
        retail_hint = structured.get("retail_hint")
    engagement_requirements = record.get("engagement_requirements") or structured.get("engagement_requirements")
    engagement_calls = record.get("engagement_calls") or structured.get("engagement_calls")
    engagement_replies = record.get("engagement_replies") or structured.get("engagement_replies")

    quality_level = int(config.get("quality_level", 0))
    policy = quality_mapping(quality_level)
    allowed_countries = config.get("allowed_countries") or []
    blocked_countries = config.get("blocked_countries") or []
    keywords = config.get("keywords") or []
    keywords_exclude = config.get("keywords_exclude") or []
    required_methods = config.get("required_contact_methods") or []
    keyword_fuzzy = bool(config.get("keyword_fuzzy", False))
    try:
        keyword_fuzzy_threshold = float(config.get("keyword_fuzzy_threshold", 0.88))
    except Exception:
        keyword_fuzzy_threshold = 0.88

    keep = True
    reject_reason: str | None = None
    if policy["max_age_hours"] is not None and age_hours is not None and age_hours > policy["max_age_hours"]:
        keep = False
        reject_reason = "max_age_hours"
    if (
        keep
        and policy["min_member_months"] is not None
        and member_months is not None
        and member_months < policy["min_member_months"]
    ):
        keep = False
        reject_reason = "min_member_months"

    country_value = str(record.get("country") or "").strip()
    if keep and blocked_countries and country_value and country_matches(country_value, blocked_countries):
        keep = False
        reject_reason = "blocked_country"

    country_match = None
    if keep and allowed_countries:
        country_match = bool(country_value and country_matches(country_value, allowed_countries))
        if not country_match:
            keep = False
            reject_reason = "allowed_country"

    text_for_keywords = " ".join(
        [
            str(record.get("title") or ""),
            str(record.get("category_text") or ""),
            text_blob,
        ]
    )
    if keep and keywords:
        if not keywords_match(
            text_for_keywords,
            keywords,
            fuzzy_enabled=keyword_fuzzy,
            fuzzy_threshold=keyword_fuzzy_threshold,
        ):
            keep = False
            reject_reason = "keywords"
    if keep and keywords_exclude:
        normalized_text = normalize_keyword_text(text_for_keywords)
        if text_contains_any(normalized_text, keywords_exclude):
            keep = False
            reject_reason = "keywords_exclude"

    has_email = bool(record.get("email")) or "email" in availability
    has_phone = bool(record.get("phone")) or "phone" in availability
    has_whatsapp = "whatsapp" in availability
    missing_methods: list[str] = []
    if keep and required_methods:
        for method in required_methods:
            if method == "email" and not has_email:
                missing_methods.append("email")
            if method == "phone" and not has_phone:
                missing_methods.append("phone")
            if method == "whatsapp" and not has_whatsapp:
                missing_methods.append("whatsapp")
        if missing_methods:
            keep = False
            reject_reason = "required_contact_methods"

    decision = SlotConfigPreviewDecision(
        keep=keep,
        reject_reason=reject_reason,
        country_match=country_match,
        missing_contact_methods=missing_methods,
    )
    fields = {
        "time_text": time_text,
        "age_hours": age_hours,
        "member_since_text": member_since_text,
        "member_months": member_months,
        "availability": availability or None,
        "quantity_text": quantity_text,
        "strength_text": strength_text,
        "packaging_text": packaging_text,
        "intent_text": intent_text,
        "buys_text": buys_text,
        "retail_hint": retail_hint,
        "engagement_requirements": engagement_requirements,
        "engagement_calls": engagement_calls,
        "engagement_replies": engagement_replies,
    }
    return decision, fields


def _assert_slot_access(user: User, slot_id: str) -> None:
    if user.role == "admin":
        return
    if slot_id not in user.allowed_slots:
        raise HTTPException(status_code=403, detail="slot access denied")


def _load_template_config() -> dict:
    repo_root = Path(__file__).resolve().parents[3]
    template_path = repo_root / "config" / "slot_config.example.yml"
    if template_path.exists():
        config = read_slot_config(template_path)
        if config:
            return config
    return {
        "version": 1,
        "quality_level": 70,
        "dry_run": True,
        "auto_buy": False,
        "max_leads_per_cycle": 10,
        "max_clicks_per_cycle": 1,
        "allowed_countries": [],
        "blocked_countries": [],
        "keywords": [],
        "keywords_exclude": [],
        "required_contact_methods": [],
        "channels": {
            "whatsapp": False,
            "telegram": False,
            "email": False,
            "sheets": False,
            "push": False,
            "slack": False,
        },
    }


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


@router.post("/provision", response_model=SlotDetail)
def provision_slot(
    request: SlotProvisionRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> SlotDetail:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="admin role required")

    ensure_slots_root(settings.slots_root_path)
    slot_id = request.slot_id.strip()
    try:
        paths = slot_paths(settings.slots_root_path, slot_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="invalid slot_id")
    if paths.root.exists():
        raise HTTPException(status_code=409, detail="slot already exists")

    paths.root.mkdir(parents=True, exist_ok=True)
    template = _load_template_config()
    write_slot_config(paths.config_path, template)
    snapshot = read_slot_snapshot(paths)
    log_audit(db, settings, action="slot_provision", user=user, slot_id=slot_id)
    return _detail_from_snapshot(snapshot)


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


@router.post("/{slot_id}/config/preview", response_model=SlotConfigPreviewResponse)
def preview_slot_config(
    slot_id: str,
    request: SlotConfigPreviewRequest,
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> SlotConfigPreviewResponse:
    ensure_slots_root(settings.slots_root_path)
    try:
        paths = slot_paths(settings.slots_root_path, slot_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="invalid slot_id")
    _assert_slot_access(user, slot_id)

    if not paths.root.exists():
        raise HTTPException(status_code=404, detail="slot not found")

    base_config = read_slot_config(paths.config_path)
    config = _build_preview_config(base_config, request.config, user)

    raw = read_leads_tail(paths.leads_path, limit=min(request.limit * 5, 2000))
    records = [r for r in raw if _is_real_lead(r)]
    if len(records) > request.limit:
        records = records[-request.limit :]

    leads: list[SlotConfigPreviewLead] = []
    reject_reasons: dict[str, int] = {}
    kept = 0
    for record in records:
        decision, fields = _evaluate_lead_preview(record, config)
        if decision.keep:
            kept += 1
        elif decision.reject_reason:
            reject_reasons[decision.reject_reason] = reject_reasons.get(decision.reject_reason, 0) + 1
        leads.append(
            SlotConfigPreviewLead(
                lead_id=record.get("lead_id"),
                observed_at=record.get("observed_at"),
                title=record.get("title"),
                country=record.get("country"),
                category_text=record.get("category_text"),
                time_text=fields.get("time_text"),
                age_hours=fields.get("age_hours"),
                member_months=fields.get("member_months"),
                member_since_text=fields.get("member_since_text"),
                availability=fields.get("availability"),
                quantity_text=fields.get("quantity_text"),
                strength_text=fields.get("strength_text"),
                packaging_text=fields.get("packaging_text"),
                intent_text=fields.get("intent_text"),
                buys_text=fields.get("buys_text"),
                retail_hint=fields.get("retail_hint"),
                engagement_requirements=fields.get("engagement_requirements"),
                engagement_calls=fields.get("engagement_calls"),
                engagement_replies=fields.get("engagement_replies"),
                decision=decision,
            )
        )

    summary = SlotConfigPreviewSummary(
        total=len(records),
        kept=kept,
        rejected=max(0, len(records) - kept),
        reject_reasons=reject_reasons,
    )
    return SlotConfigPreviewResponse(
        slot_id=slot_id,
        limit=request.limit,
        evaluated=len(records),
        summary=summary,
        leads=leads,
    )


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
    db: Session = Depends(get_db),
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
    if "allowed_countries" in payload:
        payload["allowed_countries"] = _normalize_list(payload.get("allowed_countries"))
    if "blocked_countries" in payload:
        payload["blocked_countries"] = _normalize_list(payload.get("blocked_countries"))
    if "keywords" in payload:
        payload["keywords"] = _normalize_list(payload.get("keywords"))
    if "keywords_exclude" in payload:
        payload["keywords_exclude"] = _normalize_list(payload.get("keywords_exclude"))
    if "required_contact_methods" in payload:
        payload["required_contact_methods"] = _normalize_list(payload.get("required_contact_methods"))
    if "channels" in payload:
        payload["channels"] = _normalize_channels(payload.get("channels"))

    if user.role != "admin":
        allowed_fields = {
            "quality_level",
            "dry_run",
            "max_clicks_per_cycle",
            "max_run_minutes",
            "allowed_countries",
            "keywords",
            "keywords_exclude",
            "required_contact_methods",
            "keyword_fuzzy",
            "keyword_fuzzy_threshold",
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
    log_audit(
        db,
        settings,
        action="slot_config_patch",
        user=user,
        slot_id=slot_id,
        details={"changes": list(payload.keys())},
    )
    return _detail_from_snapshot(snapshot)


@router.put("/{slot_id}/config", response_model=SlotDetail)
def replace_slot_config(
    slot_id: str,
    payload: SlotConfigReplace,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
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
    log_audit(
        db,
        settings,
        action="slot_config_replace",
        user=user,
        slot_id=slot_id,
        details={"keys": list(updated.keys())},
    )
    return _detail_from_snapshot(snapshot)


@router.post("/{slot_id}/start", response_model=SlotActionResponse)
def start_slot(
    slot_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> SlotActionResponse:
    ensure_slots_root(settings.slots_root_path)
    mgr = get_manager()
    _assert_slot_access(user, slot_id)
    try:
        mgr.start_slot(slot_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="invalid slot_id")
    log_audit(db, settings, action="slot_start", user=user, slot_id=slot_id)
    return SlotActionResponse(slot_id=slot_id, action="start", status="ok")


@router.post("/{slot_id}/stop", response_model=SlotActionResponse)
def stop_slot(
    slot_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> SlotActionResponse:
    ensure_slots_root(settings.slots_root_path)
    mgr = get_manager()
    _assert_slot_access(user, slot_id)
    mgr.stop_slot(slot_id, force=True)
    log_audit(db, settings, action="slot_stop", user=user, slot_id=slot_id)
    return SlotActionResponse(slot_id=slot_id, action="stop", status="ok")


@router.post("/{slot_id}/restart", response_model=SlotActionResponse)
def restart_slot(
    slot_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
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
    log_audit(db, settings, action="slot_restart", user=user, slot_id=slot_id)
    return SlotActionResponse(slot_id=slot_id, action="restart", status="ok")
