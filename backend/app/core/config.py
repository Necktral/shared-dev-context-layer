from functools import lru_cache
from urllib.parse import urlparse

from pydantic import field_validator, model_validator
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
    mcp_public_base_url: str | None = None
    mcp_resource_id: str | None = None
    mcp_allowed_origins: str = ""
    mcp_auth_clock_skew_seconds: int = 60
    mcp_log_level: str = "INFO"
    mcp_log_json: bool = True
    mcp_log_payloads: bool = False
    mcp_log_include_headers_allowlist: str = (
        "x-request-id,mcp-session-id,user-agent,x-forwarded-for,traceparent,"
        "mcp-protocol-version,accept,content-type"
    )

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @field_validator("database_url", mode="before")
    @classmethod
    def normalize_database_url(cls, value: str) -> str:
        if isinstance(value, str) and value.startswith("postgresql://"):
            return value.replace("postgresql://", "postgresql+psycopg://", 1)
        return value

    @field_validator("mcp_public_base_url", mode="before")
    @classmethod
    def normalize_public_base_url(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            return None
        return normalized.rstrip("/")

    @field_validator("mcp_resource_id", mode="before")
    @classmethod
    def normalize_resource_id(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = str(value).strip()
        if not normalized:
            return None
        return normalized

    @field_validator("mcp_log_level", mode="before")
    @classmethod
    def normalize_log_level(cls, value: str) -> str:
        normalized = str(value).strip().upper() if value is not None else "INFO"
        valid_levels = {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}
        if normalized not in valid_levels:
            raise ValueError(f"MCP_LOG_LEVEL must be one of: {', '.join(sorted(valid_levels))}.")
        return normalized

    @field_validator("mcp_log_include_headers_allowlist", mode="before")
    @classmethod
    def normalize_headers_allowlist(cls, value: str | None) -> str:
        if value is None:
            return ""
        headers = [header.strip().lower() for header in str(value).split(",") if header.strip()]
        return ",".join(headers)

    @field_validator("mcp_allowed_origins", mode="before")
    @classmethod
    def normalize_allowed_origins(cls, value: str | None) -> str:
        if value is None:
            return ""
        origins: list[str] = []
        for token in str(value).replace("\n", ",").split(","):
            candidate = token.strip()
            if not candidate:
                continue
            normalized = candidate.lower()
            if normalized not in origins:
                origins.append(normalized)
        return ",".join(origins)

    @staticmethod
    def _validate_absolute_http_uri(value: str, env_name: str) -> None:
        parsed = urlparse(value)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError(f"{env_name} must be an absolute URI (http/https).")

    @model_validator(mode="after")
    def validate_auth_runtime_settings(self) -> "Settings":
        if self.mcp_resource_id:
            self._validate_absolute_http_uri(self.mcp_resource_id, "MCP_RESOURCE_ID")

        auth_runtime_enabled = self.mcp_auth_enabled and not self.mcp_auth_bypass_local
        if not auth_runtime_enabled:
            return self

        if not self.mcp_public_base_url:
            raise ValueError(
                "MCP_PUBLIC_BASE_URL is required when MCP auth runtime is enabled "
                "(MCP_AUTH_ENABLED=true and MCP_AUTH_BYPASS_LOCAL=false)."
            )
        if not self.mcp_public_base_url.startswith("https://"):
            raise ValueError("MCP_PUBLIC_BASE_URL must be an https URL.")

        parsed = urlparse(self.mcp_public_base_url)
        if parsed.query or parsed.fragment:
            raise ValueError("MCP_PUBLIC_BASE_URL must not include query params or fragments.")
        if parsed.path not in ("", "/"):
            raise ValueError("MCP_PUBLIC_BASE_URL must not include a path (do not use /mcp).")
        resource_id = self.effective_mcp_resource_id
        if not resource_id:
            raise ValueError(
                "MCP_RESOURCE_ID or MCP_AUTH0_AUDIENCE is required when MCP auth runtime is enabled.",
            )
        self._validate_absolute_http_uri(resource_id, "MCP_RESOURCE_ID")
        return self

    @property
    def effective_mcp_resource_id(self) -> str | None:
        return self.mcp_resource_id or self.mcp_auth0_audience

    @property
    def has_legacy_resource_id_divergence(self) -> bool:
        if not self.mcp_resource_id or not self.mcp_auth0_audience:
            return False
        return self.mcp_resource_id != self.mcp_auth0_audience

    @property
    def mcp_allowed_origins_list(self) -> list[str]:
        if not self.mcp_allowed_origins:
            return []
        return [origin for origin in self.mcp_allowed_origins.split(",") if origin]


@lru_cache
def get_settings() -> Settings:
    return Settings()
