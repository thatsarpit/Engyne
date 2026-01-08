from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

from engyne_api.settings import Settings, get_settings
from core.queues import append_jsonl, utc_now

router = APIRouter(prefix="/events", tags=["events"])


class VerifiedEvent(BaseModel):
    slot_id: str
    lead_id: str
    observed_at: str | None = None
    payload: dict | None = None


@router.post("/verified", status_code=202)
def verified_event(
    event: VerifiedEvent,
    worker_secret: str | None = Header(default=None, alias="X-Engyne-Worker-Secret"),
    settings: Settings = Depends(get_settings),
) -> dict:
    if worker_secret is None or worker_secret != settings.worker_secret:
        raise HTTPException(status_code=401, detail="invalid worker secret")
    record = {
        "type": "verified",
        "slot_id": event.slot_id,
        "lead_id": event.lead_id,
        "observed_at": event.observed_at,
        "received_at": utc_now(),
        "payload": event.payload or {},
    }
    queue_path = settings.runtime_path / "verified_queue.jsonl"
    append_jsonl(queue_path, record)
    return {"status": "accepted", "slot_id": event.slot_id, "lead_id": event.lead_id}
