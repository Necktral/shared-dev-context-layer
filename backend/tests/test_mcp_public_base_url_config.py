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
        mcp_auth0_audience="https://wis-context-sync-read-api",
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


def test_mcp_log_level_validation_and_normalization() -> None:
    settings = _build_settings(mcp_auth_enabled=False, mcp_log_level="debug")
    assert settings.mcp_log_level == "DEBUG"

    with pytest.raises(ValidationError, match="MCP_LOG_LEVEL must be one of"):
        _build_settings(mcp_auth_enabled=False, mcp_log_level="TRACE")


def test_mcp_log_header_allowlist_is_normalized() -> None:
    settings = _build_settings(
        mcp_auth_enabled=False,
        mcp_log_include_headers_allowlist="  X-Request-ID , User-Agent  , x-forwarded-for ",
    )
    assert settings.mcp_log_include_headers_allowlist == "x-request-id,user-agent,x-forwarded-for"


def test_mcp_resource_id_is_validated_as_absolute_uri() -> None:
    settings = _build_settings(
        mcp_auth_enabled=False,
        mcp_resource_id=" https://wis-context-sync-read-api ",
    )
    assert settings.mcp_resource_id == "https://wis-context-sync-read-api"

    with pytest.raises(ValidationError, match="MCP_RESOURCE_ID must be an absolute URI"):
        _build_settings(mcp_auth_enabled=False, mcp_resource_id="wis-context-sync-read-api")


def test_effective_resource_id_falls_back_to_auth0_audience() -> None:
    settings = _build_settings(
        mcp_auth_enabled=True,
        mcp_auth_bypass_local=False,
        mcp_public_base_url="https://mcp.wiscontext-sync.org",
        mcp_auth0_audience="https://wis-context-sync-read-api",
        mcp_resource_id=None,
    )
    assert settings.effective_mcp_resource_id == "https://wis-context-sync-read-api"
    assert settings.has_legacy_resource_id_divergence is False


def test_legacy_divergence_is_allowed_without_failing_validation() -> None:
    settings = _build_settings(
        mcp_auth_enabled=True,
        mcp_auth_bypass_local=False,
        mcp_public_base_url="https://mcp.wiscontext-sync.org",
        mcp_auth0_audience="https://wis-context-sync-read-api",
        mcp_resource_id="https://mcp.wiscontext-sync.org",
    )
    assert settings.effective_mcp_resource_id == "https://mcp.wiscontext-sync.org"
    assert settings.has_legacy_resource_id_divergence is True


def test_mcp_allowed_origins_csv_is_normalized() -> None:
    settings = _build_settings(
        mcp_auth_enabled=False,
        mcp_allowed_origins=" https://chatgpt.com,HTTPS://chat.openai.com , https://chatgpt.com ",
    )
    assert settings.mcp_allowed_origins == "https://chatgpt.com,https://chat.openai.com"
    assert settings.mcp_allowed_origins_list == ["https://chatgpt.com", "https://chat.openai.com"]
