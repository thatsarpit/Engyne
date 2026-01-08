from __future__ import annotations

def quality_mapping(quality_level: int) -> dict[str, int]:
    q = max(0, min(100, quality_level))
    if q >= 90:
        return {"min_member_months": 24, "max_age_hours": 24}
    if q >= 70:
        return {"min_member_months": 12, "max_age_hours": 36}
    if q >= 40:
        return {"min_member_months": 6, "max_age_hours": 48}
    return {"min_member_months": 0, "max_age_hours": 48}

