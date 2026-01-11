from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from core.slot_fs import validate_slot_id
from engyne_api.auth.deps import get_current_user
from engyne_api.db.deps import get_db
from engyne_api.db.models import SlotMetricsDaily, User

router = APIRouter(prefix="/analytics", tags=["analytics"])


class Metrics(BaseModel):
    observed: int = 0
    kept: int = 0
    rejected: int = 0
    clicked: int = 0
    verified: int = 0


class SlotSummary(BaseModel):
    slot_id: str
    metrics: Metrics


class AnalyticsSummary(BaseModel):
    range_start: str
    range_end: str
    totals: Metrics
    per_slot: list[SlotSummary]


class SlotDailyMetrics(BaseModel):
    day: str
    metrics: Metrics
    reject_reasons: dict[str, int] | None = None


class SlotAnalyticsResponse(BaseModel):
    slot_id: str
    range_start: str
    range_end: str
    totals: Metrics
    series: list[SlotDailyMetrics]


def _parse_date(value: str | None) -> date | None:
    if value is None:
        return None
    raw = value.strip()
    if not raw:
        return None
    try:
        return date.fromisoformat(raw)
    except ValueError:
        raise HTTPException(status_code=400, detail="invalid date format (YYYY-MM-DD)")


def _date_range(
    start_date: str | None,
    end_date: str | None,
    default_days: int = 30,
) -> tuple[date, date]:
    end = _parse_date(end_date)
    if end is None:
        end = datetime.now(timezone.utc).date()
    start = _parse_date(start_date)
    if start is None:
        start = end - timedelta(days=default_days - 1)
    if start > end:
        raise HTTPException(status_code=400, detail="start_date must be <= end_date")
    return start, end


def _slot_scope(user: User) -> list[str] | None:
    if user.role == "admin":
        return None
    return list(user.allowed_slots or [])


@router.get("/summary", response_model=AnalyticsSummary)
def analytics_summary(
    start_date: str | None = Query(default=None),
    end_date: str | None = Query(default=None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AnalyticsSummary:
    start, end = _date_range(start_date, end_date)
    scope = _slot_scope(user)
    query = db.query(SlotMetricsDaily).filter(SlotMetricsDaily.day >= start, SlotMetricsDaily.day <= end)
    if scope is not None:
        if not scope:
            return AnalyticsSummary(
                range_start=start.isoformat(),
                range_end=end.isoformat(),
                totals=Metrics(),
                per_slot=[],
            )
        query = query.filter(SlotMetricsDaily.slot_id.in_(scope))

    totals = Metrics()
    per_slot_map: dict[str, Metrics] = {}
    for row in query.all():
        totals.observed += row.observed_count
        totals.kept += row.kept_count
        totals.rejected += row.rejected_count
        totals.clicked += row.clicked_count
        totals.verified += row.verified_count
        slot_metrics = per_slot_map.setdefault(row.slot_id, Metrics())
        slot_metrics.observed += row.observed_count
        slot_metrics.kept += row.kept_count
        slot_metrics.rejected += row.rejected_count
        slot_metrics.clicked += row.clicked_count
        slot_metrics.verified += row.verified_count

    per_slot = [SlotSummary(slot_id=slot_id, metrics=metrics) for slot_id, metrics in sorted(per_slot_map.items())]
    return AnalyticsSummary(
        range_start=start.isoformat(),
        range_end=end.isoformat(),
        totals=totals,
        per_slot=per_slot,
    )


@router.get("/slots/{slot_id}", response_model=SlotAnalyticsResponse)
def analytics_slot(
    slot_id: str,
    start_date: str | None = Query(default=None),
    end_date: str | None = Query(default=None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SlotAnalyticsResponse:
    validate_slot_id(slot_id)
    if user.role != "admin" and slot_id not in (user.allowed_slots or []):
        raise HTTPException(status_code=403, detail="slot access denied")

    start, end = _date_range(start_date, end_date)
    rows = (
        db.query(SlotMetricsDaily)
        .filter(SlotMetricsDaily.slot_id == slot_id, SlotMetricsDaily.day >= start, SlotMetricsDaily.day <= end)
        .all()
    )
    row_map = {row.day: row for row in rows}
    series: list[SlotDailyMetrics] = []
    totals = Metrics()

    current = start
    while current <= end:
        row = row_map.get(current)
        if row:
            metrics = Metrics(
                observed=row.observed_count,
                kept=row.kept_count,
                rejected=row.rejected_count,
                clicked=row.clicked_count,
                verified=row.verified_count,
            )
            totals.observed += row.observed_count
            totals.kept += row.kept_count
            totals.rejected += row.rejected_count
            totals.clicked += row.clicked_count
            totals.verified += row.verified_count
            series.append(
                SlotDailyMetrics(
                    day=current.isoformat(),
                    metrics=metrics,
                    reject_reasons=row.reject_reasons or {},
                )
            )
        else:
            series.append(SlotDailyMetrics(day=current.isoformat(), metrics=Metrics(), reject_reasons={}))
        current += timedelta(days=1)

    return SlotAnalyticsResponse(
        slot_id=slot_id,
        range_start=start.isoformat(),
        range_end=end.isoformat(),
        totals=totals,
        series=series,
    )
