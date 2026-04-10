import pytest
from pydantic import ValidationError

from app.core.config import Settings


BASE_DB_URL = "postgresql://wis_admin:wis_strong_password_change_this@localhost:5432/wis_context"


def _build_settings(**kwargs) -> Settings:
    return Settings(database_url=BASE_DB_URL, **kwargs)


def test_mcp_public_base_url_normalizes_trailing_slash_when_auth_runtime_enabled() -> None:
    settings = _build_settings(
        mcp_auth_enabled=True,
        mcp_auth_bypass_local=False,
        mcp_public_base_url="https://mcp.wiscontext-sync.org/",
    )
    assert settings.mcp_public_base_url == "https://mcp.wiscontext-sync.org"


@pytest.mark.parametrize(
    ("value", "error_match"),
    [
        ("http://mcp.wiscontext-sync.org", "must be an https URL"),
        ("https://mcp.wiscontext-sync.org/mcp", "must not include a path"),
        ("https://mcp.wiscontext-sync.org?x=1", "must not include query params"),
        ("https://mcp.wiscontext-sync.org#frag", "must not include query params"),
    ],
)
def test_mcp_public_base_url_rejects_invalid_formats_when_auth_runtime_enabled(value: str, error_match: str) -> None:
    with pytest.raises(ValidationError, match=error_match):
        _build_settings(
            mcp_auth_enabled=True,
            mcp_auth_bypass_local=False,
            mcp_public_base_url=value,
        )


def test_mcp_public_base_url_is_required_when_auth_runtime_enabled() -> None:
    with pytest.raises(ValidationError, match="MCP_PUBLIC_BASE_URL is required"):
        _build_settings(
            mcp_auth_enabled=True,
            mcp_auth_bypass_local=False,
            mcp_public_base_url=None,
        )


def test_mcp_public_base_url_is_optional_when_auth_runtime_is_bypassed() -> None:
    settings = _build_settings(
        mcp_auth_enabled=True,
        mcp_auth_bypass_local=True,
        mcp_public_base_url=None,
    )
    assert settings.mcp_public_base_url is None
