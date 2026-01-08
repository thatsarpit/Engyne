from __future__ import annotations

from sqlalchemy.orm import Session, sessionmaker

from engyne_api.db.engine import engine

SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False, class_=Session)

