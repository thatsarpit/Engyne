from __future__ import annotations

import json
import threading
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from sqlalchemy.orm import Session

from core.slot_fs import list_slot_paths
from engyne_api.db.models import SlotMetricsCursor, SlotMetricsDaily
from engyne_api.db.session import SessionLocal
from engyne_api.settings import Settings, get_settings

_thread: Optional[threading.Thread] = None
_lock = threading.Lock()
_stop_event = threading.Event()


def _parse_iso_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    raw = value.strip()
    if not raw:
        return None
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(raw)
    except Exception:
        return None


def _merge_reason_counts(base: dict[str, int], delta: dict[str, int]) -> dict[str, int]:
    merged = dict(base or {})
    for key, count in (delta or {}).items():
        merged[key] = int(merged.get(key, 0)) + int(count)
    return merged


def _rollup_slot_metrics(db: Session, settings: Settings, leads_path: Path, slot_id: str) -> None:
    if not leads_path.exists():
        return

    cursor = db.query(SlotMetricsCursor).filter(SlotMetricsCursor.slot_id == slot_id).one_or_none()
    last_line = cursor.last_line if cursor else 0

    day_counts: dict = defaultdict(lambda: {
        "observed_count": 0,
        "kept_count": 0,
        "rejected_count": 0,
        "clicked_count": 0,
        "verified_count": 0,
        "reject_reasons": defaultdict(int),
    })
    current_line = 0

    with leads_path.open("r", encoding="utf-8") as handle:
        for current_line, line in enumerate(handle, start=1):
            if current_line <= last_line:
                continue
            try:
                record = json.loads(line)
            except Exception:
                continue
            if not isinstance(record, dict):
                continue
            if "kept" not in record:
                continue
            observed_at = _parse_iso_datetime(record.get("observed_at"))
            if not observed_at:
                continue
            day = observed_at.date()
            counts = day_counts[day]
            counts["observed_count"] += 1
            kept = bool(record.get("kept"))
            if kept:
                counts["kept_count"] += 1
            else:
                counts["rejected_count"] += 1
                reason = record.get("reject_reason")
                if isinstance(reason, str) and reason.strip():
                    counts["reject_reasons"][reason.strip()] += 1
            if record.get("clicked") is True:
                counts["clicked_count"] += 1
            if record.get("verified") is True:
                counts["verified_count"] += 1

    if current_line < last_line:
        if cursor is None:
            cursor = SlotMetricsCursor(slot_id=slot_id, last_line=current_line)
            db.add(cursor)
        else:
            cursor.last_line = current_line
        cursor.last_processed_at = datetime.now(timezone.utc)
        db.commit()
        return

    if not day_counts and current_line == last_line:
        return

    for day, counts in day_counts.items():
        existing = (
            db.query(SlotMetricsDaily)
            .filter(SlotMetricsDaily.slot_id == slot_id, SlotMetricsDaily.day == day)
            .one_or_none()
        )
        if existing is None:
            existing = SlotMetricsDaily(
                slot_id=slot_id,
                node_id=settings.node_id,
                day=day,
                observed_count=counts["observed_count"],
                kept_count=counts["kept_count"],
                rejected_count=counts["rejected_count"],
                clicked_count=counts["clicked_count"],
                verified_count=counts["verified_count"],
                reject_reasons=dict(counts["reject_reasons"]),
            )
            db.add(existing)
        else:
            existing.observed_count += counts["observed_count"]
            existing.kept_count += counts["kept_count"]
            existing.rejected_count += counts["rejected_count"]
            existing.clicked_count += counts["clicked_count"]
            existing.verified_count += counts["verified_count"]
            existing.reject_reasons = _merge_reason_counts(existing.reject_reasons, counts["reject_reasons"])
            existing.updated_at = datetime.now(timezone.utc)

    if cursor is None:
        cursor = SlotMetricsCursor(slot_id=slot_id, last_line=current_line)
        db.add(cursor)
    else:
        cursor.last_line = current_line
    cursor.last_processed_at = datetime.now(timezone.utc)
    db.commit()


def rollup_metrics_once(settings: Settings | None = None) -> None:
    settings = settings or get_settings()
    slots = list_slot_paths(settings.slots_root_path)
    if not slots:
        return
    with SessionLocal() as db:
        for paths in slots:
            _rollup_slot_metrics(db, settings, paths.leads_path, paths.slot_id)


def _run_loop() -> None:
    settings = get_settings()
    if not settings.analytics_enabled:
        return
    while not _stop_event.is_set():
        try:
            rollup_metrics_once(settings)
        except Exception:
            pass
        _stop_event.wait(settings.analytics_rollup_seconds)


def start_background_analytics() -> None:
    global _thread
    settings = get_settings()
    if not settings.analytics_enabled:
        return
    with _lock:
        if _thread and _thread.is_alive():
            return
        _stop_event.clear()
        _thread = threading.Thread(target=_run_loop, daemon=True, name="analytics-rollup")
        _thread.start()


def stop_background_analytics() -> None:
    with _lock:
        _stop_event.set()
        if _thread and _thread.is_alive():
            _thread.join(timeout=5)
