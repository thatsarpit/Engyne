from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import FrozenSet

from pydantic import AnyHttpUrl, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        enable_decoding=False,
    )

    node_id: str = Field(default="local", alias="NODE_ID")

    public_api_base_url: AnyHttpUrl = Field(alias="PUBLIC_API_BASE_URL")
    public_dashboard_base_url: AnyHttpUrl = Field(alias="PUBLIC_DASHBOARD_BASE_URL")

    slots_root: str = Field(default="slots", alias="SLOTS_ROOT")
    runtime_root: str = Field(default="runtime", alias="RUNTIME_ROOT")

    cors_allow_origin_regex: str = Field(alias="CORS_ALLOW_ORIGIN_REGEX", min_length=1)

    database_url: str = Field(alias="DATABASE_URL", min_length=1)

    jwt_secret: str = Field(alias="JWT_SECRET", min_length=16)
    jwt_expires_seconds: int = Field(default=60 * 60 * 24, alias="JWT_EXPIRES_SECONDS", ge=60)

    google_oauth_client_id: str = Field(alias="GOOGLE_OAUTH_CLIENT_ID", min_length=1)
    google_oauth_client_secret: str = Field(alias="GOOGLE_OAUTH_CLIENT_SECRET", min_length=1)

    google_oauth_allowed_emails: FrozenSet[str] = Field(default=frozenset(), alias="GOOGLE_OAUTH_ALLOWED_EMAILS")
    google_oauth_allowed_domains: FrozenSet[str] = Field(default=frozenset(), alias="GOOGLE_OAUTH_ALLOWED_DOMAINS")
    google_oauth_admin_emails: FrozenSet[str] = Field(default=frozenset(), alias="GOOGLE_OAUTH_ADMIN_EMAILS")
    google_oauth_auto_provision: bool = Field(default=False, alias="GOOGLE_OAUTH_AUTO_PROVISION")

    auth_allowed_redirect_origins: FrozenSet[str] = Field(
        default=frozenset(), alias="AUTH_ALLOWED_REDIRECT_ORIGINS"
    )
    worker_secret: str = Field(default="CHANGE_ME", alias="ENGYNE_WORKER_SECRET")
    worker_heartbeat_interval: float = Field(default=2.0, alias="WORKER_HEARTBEAT_INTERVAL_SECONDS", ge=1.0)
    worker_heartbeat_ttl: float = Field(default=30.0, alias="WORKER_HEARTBEAT_TTL_SECONDS", ge=5.0)
    worker_api_base_override: str | None = Field(default=None, alias="WORKER_API_BASE_OVERRIDE")

    @field_validator(
        "google_oauth_allowed_emails",
        "google_oauth_allowed_domains",
        "google_oauth_admin_emails",
        "auth_allowed_redirect_origins",
        mode="before",
    )
    @classmethod
    def _parse_csv_set(cls, value):  # type: ignore[no-untyped-def]
        if value is None:
            return frozenset()
        if isinstance(value, (set, frozenset, list, tuple)):
            return frozenset(str(v).strip().lower() for v in value if str(v).strip())
        if isinstance(value, str):
            raw = value.strip()
            if not raw:
                return frozenset()
            if raw.startswith("["):
                import json

                parsed = json.loads(raw)
                if not isinstance(parsed, list):
                    raise TypeError("expected JSON array")
                return frozenset(str(v).strip().lower() for v in parsed if str(v).strip())
            return frozenset(v.strip().lower() for v in raw.split(",") if v.strip())
        raise TypeError("expected CSV string or JSON array")

    @property
    def google_oauth_redirect_uri(self) -> str:
        return f"{str(self.public_api_base_url).rstrip('/')}/auth/google/callback"

    @property
    def is_https(self) -> bool:
        return str(self.public_api_base_url).lower().startswith("https://")

    @property
    def slots_root_path(self) -> Path:
        return Path(self.slots_root).expanduser().resolve()

    @property
    def runtime_path(self) -> Path:
        return Path(self.runtime_root).expanduser().resolve()


@lru_cache
def get_settings() -> Settings:
    return Settings()
