from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from engyne_api.db.base import Base
from engyne_api.db.engine import engine
from engyne_api.db import models as _models  # noqa: F401
from engyne_api.manager_service import start_background_manager, stop_background_manager
from engyne_api.routes.auth import router as auth_router
from engyne_api.routes.cluster import router as cluster_router
from engyne_api.routes.events import router as events_router
from engyne_api.routes.remote_login import router as remote_login_router
from engyne_api.routes.node import router as node_router
from engyne_api.routes.slots import router as slots_router
from engyne_api.routes.whatsapp import router as whatsapp_router
from engyne_api.settings import get_settings
from core.slot_fs import ensure_slots_root


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(title="ENGYNE API", version="0.1.0")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[],
        allow_origin_regex=settings.cors_allow_origin_regex,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/healthz")
    def healthz() -> dict:
        return {"ok": True, "node_id": settings.node_id}

    app.include_router(auth_router)
    app.include_router(slots_router)
    app.include_router(events_router)
    app.include_router(whatsapp_router)
    app.include_router(remote_login_router)
    app.include_router(node_router)
    app.include_router(cluster_router)

    @app.on_event("startup")
    def _startup() -> None:
        Base.metadata.create_all(bind=engine)
        ensure_slots_root(settings.slots_root_path)
        settings.runtime_path.mkdir(parents=True, exist_ok=True)
        start_background_manager()

    @app.on_event("shutdown")
    def _shutdown() -> None:
        stop_background_manager()

    return app


app = create_app()
