from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    project_name: str = "shared-dev-context-layer"
    backend_port: int = 8001
    mcp_port: int = 8002
    database_url: str
    system_mode: str = "delegated_limited"
    mcp_auth_enabled: bool = True
    mcp_auth_bypass_local: bool = False
    mcp_auth0_issuer: str | None = None
    mcp_auth0_audience: str | None = None
    mcp_auth0_jwks_url: str | None = None
    mcp_auth_clock_skew_seconds: int = 60

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @field_validator("database_url", mode="before")
    @classmethod
    def normalize_database_url(cls, value: str) -> str:
        if isinstance(value, str) and value.startswith("postgresql://"):
            return value.replace("postgresql://", "postgresql+psycopg://", 1)
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()
