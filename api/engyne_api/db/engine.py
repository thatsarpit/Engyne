from __future__ import annotations

from pathlib import Path

from sqlalchemy import create_engine

from engyne_api.settings import get_settings


def _maybe_ensure_sqlite_parent_dir(database_url: str) -> None:
    if not database_url.startswith("sqlite:///"):
        return
    relative_path = database_url.removeprefix("sqlite:///")
    if not relative_path or relative_path == ":memory:":
        return
    parent = Path(relative_path).expanduser().resolve().parent
    parent.mkdir(parents=True, exist_ok=True)


settings = get_settings()
_maybe_ensure_sqlite_parent_dir(settings.database_url)

connect_args = {}
if settings.database_url.startswith("sqlite:///"):
    connect_args = {"check_same_thread": False}

engine = create_engine(settings.database_url, connect_args=connect_args, pool_pre_ping=True)

