from __future__ import annotations

import asyncio
import json
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from engyne_api.audit import log_audit
from core.slot_fs import ensure_slots_root, slot_paths
from engyne_api.auth.deps import get_current_user
from engyne_api.db.deps import get_db
from engyne_api.db.models import User
from engyne_api.manager_service import get_manager
from engyne_api.settings import Settings, get_settings

router = APIRouter(tags=["remote-login"])

SESSION_FILENAME = "remote_login.json"


class RemoteLoginStartResponse(BaseModel):
    token: str
    url: str
    slot_id: str
    expires_at: str
    vnc_host: str
    vnc_port: int


class RemoteLoginStopResponse(BaseModel):
    status: str


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _session_path(settings: Settings) -> Path:
    return settings.runtime_path / SESSION_FILENAME


def _parse_ts(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _read_session(settings: Settings) -> dict[str, Any] | None:
    path = _session_path(settings)
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError:
        path.unlink(missing_ok=True)
        return None
    if not isinstance(data, dict):
        path.unlink(missing_ok=True)
        return None
    return data


def _write_session(settings: Settings, data: dict[str, Any]) -> None:
    path = _session_path(settings)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2))
    tmp.replace(path)


def _clear_session(settings: Settings) -> None:
    path = _session_path(settings)
    path.unlink(missing_ok=True)


def _load_active_session(settings: Settings, token: str | None = None) -> dict[str, Any] | None:
    session = _read_session(settings)
    if not session:
        return None
    if not session.get("active"):
        _clear_session(settings)
        return None
    if token and session.get("token") != token:
        return None
    expires_at = _parse_ts(session.get("expires_at"))
    if not expires_at or expires_at <= _now():
        _clear_session(settings)
        return None
    return session


def _remote_login_url(settings: Settings, token: str) -> str:
    base = str(settings.public_api_base_url).rstrip("/")
    return f"{base}/remote-login/{token}"


def _render_html(session: dict[str, Any]) -> str:
    token = session["token"]
    slot_id = session["slot_id"]
    vnc_host = session["vnc_host"]
    vnc_port = session["vnc_port"]
    expires_at = session["expires_at"]
    return f"""<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Engyne Remote Login</title>
    <style>
      body {{
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #f6f7fb;
        margin: 0;
        padding: 40px;
        color: #0f172a;
      }}
      .card {{
        max-width: 680px;
        background: #fff;
        border: 1px solid #e5e7eb;
        border-radius: 16px;
        padding: 24px;
        margin: 0 auto;
        box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08);
      }}
      .mono {{
        font-family: "SFMono-Regular", Menlo, Consolas, monospace;
        font-size: 13px;
      }}
      .muted {{
        color: #64748b;
      }}
      .link {{
        color: #1d4ed8;
        text-decoration: underline;
      }}
      button {{
        border: none;
        background: #2563eb;
        color: #fff;
        padding: 10px 14px;
        border-radius: 10px;
        font-weight: 600;
        cursor: pointer;
      }}
    </style>
  </head>
  <body>
    <div class="card">
      <h2>Engyne Remote Login</h2>
      <p>Slot: <span class="mono">{slot_id}</span></p>
      <p>
        VNC: <a class="link mono" href="vnc://{vnc_host}:{vnc_port}">vnc://{vnc_host}:{vnc_port}</a>
      </p>
      <p>Expires: <span id="expiresAt" class="mono">{expires_at}</span></p>
      <p id="status" class="muted">Connecting...</p>
      <button id="stopBtn">Stop Session</button>
    </div>
    <script>
      const statusEl = document.getElementById("status");
      const expiresEl = document.getElementById("expiresAt");
      const stopBtn = document.getElementById("stopBtn");
      const wsUrl =
        (location.protocol === "https:" ? "wss://" : "ws://") +
        location.host +
        "/remote-login/ws/{token}";

      function setStatus(message) {{
        statusEl.textContent = message;
      }}

      const ws = new WebSocket(wsUrl);
      ws.onmessage = (event) => {{
        try {{
          const data = JSON.parse(event.data);
          if (data.type === "status") {{
            if (data.expires_at) {{
              expiresEl.textContent = data.expires_at;
            }}
            if (typeof data.remaining_seconds === "number") {{
              setStatus(`Session active. Expires in ${{data.remaining_seconds}}s.`);
            }}
          }}
          if (data.type === "expired") {{
              setStatus("Session expired.");
          }}
          if (data.type === "stopped") {{
            setStatus("Session stopped.");
          }}
        }} catch (err) {{
          console.error(err);
        }}
      }};
      ws.onclose = () => {{
        setStatus("Session disconnected.");
      }};

      stopBtn.addEventListener("click", () => {{
        fetch("/remote-login/{token}/stop", {{ method: "POST" }})
          .then((resp) => resp.json())
          .then(() => {{
            setStatus("Session stopping...");
          }})
          .catch((err) => {{
            console.error(err);
            setStatus("Unable to stop session.");
          }});
      }});
    </script>
  </body>
</html>
"""


@router.post("/slots/{slot_id}/remote-login/start", response_model=RemoteLoginStartResponse)
def start_remote_login(
    slot_id: str,
    settings: Settings = Depends(get_settings),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> RemoteLoginStartResponse:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="admin role required")

    ensure_slots_root(settings.slots_root_path)
    try:
        paths = slot_paths(settings.slots_root_path, slot_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="invalid slot_id")
    if not paths.root.exists():
        raise HTTPException(status_code=404, detail="slot not found")

    existing = _load_active_session(settings)
    if existing:
        if existing.get("slot_id") == slot_id:
            return RemoteLoginStartResponse(
                token=existing["token"],
                url=_remote_login_url(settings, existing["token"]),
                slot_id=existing["slot_id"],
                expires_at=existing["expires_at"],
                vnc_host=existing["vnc_host"],
                vnc_port=existing["vnc_port"],
            )
        raise HTTPException(status_code=409, detail="remote login already active")

    mgr = get_manager()
    mgr.stop_slot(slot_id, force=True)

    token = secrets.token_urlsafe(24)
    expires_at = _now() + timedelta(seconds=settings.remote_login_ttl_seconds)
    session = {
        "token": token,
        "slot_id": slot_id,
        "created_at": _now().isoformat(),
        "expires_at": expires_at.isoformat(),
        "active": True,
        "vnc_host": settings.remote_login_vnc_host,
        "vnc_port": settings.remote_login_vnc_port,
    }
    _write_session(settings, session)
    log_audit(
        db,
        settings,
        action="remote_login_start",
        user=user,
        slot_id=slot_id,
        details={"expires_at": session["expires_at"]},
    )

    return RemoteLoginStartResponse(
        token=token,
        url=_remote_login_url(settings, token),
        slot_id=slot_id,
        expires_at=session["expires_at"],
        vnc_host=settings.remote_login_vnc_host,
        vnc_port=settings.remote_login_vnc_port,
    )


@router.get("/remote-login/{token}")
def remote_login_page(token: str, settings: Settings = Depends(get_settings)) -> HTMLResponse:
    session = _load_active_session(settings, token=token)
    if not session:
        raise HTTPException(status_code=404, detail="session not found")
    return HTMLResponse(_render_html(session))


@router.websocket("/remote-login/ws/{token}")
async def remote_login_ws(websocket: WebSocket, token: str) -> None:
    settings = get_settings()
    await websocket.accept()
    try:
        while True:
            session = _load_active_session(settings, token=token)
            if not session:
                await websocket.send_json({"type": "expired"})
                await websocket.close(code=1000)
                return
            expires_at = _parse_ts(session.get("expires_at"))
            remaining = 0
            if expires_at:
                remaining = max(0, int((expires_at - _now()).total_seconds()))
            await websocket.send_json(
                {
                    "type": "status",
                    "slot_id": session.get("slot_id"),
                    "expires_at": session.get("expires_at"),
                    "remaining_seconds": remaining,
                    "vnc_host": session.get("vnc_host"),
                    "vnc_port": session.get("vnc_port"),
                }
            )
            try:
                await asyncio.wait_for(websocket.receive_text(), timeout=5)
            except asyncio.TimeoutError:
                continue
    except WebSocketDisconnect:
        return


@router.post("/remote-login/{token}/stop", response_model=RemoteLoginStopResponse)
def stop_remote_login(
    token: str,
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_db),
) -> RemoteLoginStopResponse:
    session = _load_active_session(settings, token=token)
    if not session:
        raise HTTPException(status_code=404, detail="session not found")
    _clear_session(settings)
    log_audit(
        db,
        settings,
        action="remote_login_stop",
        user=None,
        slot_id=session.get("slot_id"),
    )
    return RemoteLoginStopResponse(status="stopped")
