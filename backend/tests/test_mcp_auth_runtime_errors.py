from mcp.server.auth.provider import AccessToken

from app.mcp import server as mcp_server


def _enable_auth_runtime(monkeypatch) -> None:
    monkeypatch.setattr(mcp_server.settings, "mcp_auth_enabled", True)
    monkeypatch.setattr(mcp_server.settings, "mcp_auth_bypass_local", False)
    monkeypatch.setattr(mcp_server.settings, "mcp_public_base_url", "https://mcp.wiscontext-sync.org")


def test_scope_guard_unauthorized_preserves_payload_and_emits_www_authenticate(monkeypatch) -> None:
    _enable_auth_runtime(monkeypatch)
    monkeypatch.setattr(mcp_server, "get_access_token", lambda: None)

    payload = mcp_server._scope_guard("get_active_task")
    assert payload is not None
    assert payload["status"] == "unauthorized"
    assert payload["error"] == "invalid_token"
    assert payload["required_scopes"] == ["wis.context.read"]
    assert payload["present_scopes"] == []
    assert "missing_scopes" not in payload

    meta = payload.get("_meta")
    assert isinstance(meta, dict)
    challenge = meta.get("mcp/www_authenticate")
    assert isinstance(challenge, str)
    assert 'error="invalid_token"' in challenge
    assert 'scope="wis.context.read"' in challenge
    assert "https://mcp.wiscontext-sync.org/.well-known/oauth-protected-resource" in challenge


def test_scope_guard_insufficient_scope_preserves_payload_and_emits_www_authenticate(monkeypatch) -> None:
    _enable_auth_runtime(monkeypatch)

    token = AccessToken(
        token="header.payload.signature",
        client_id="auth0|read-only",
        scopes=["wis.context.read", "wis.context.sync.read"],
        expires_at=None,
        resource="https://wis-context-sync-read-api",
    )
    monkeypatch.setattr(mcp_server, "get_access_token", lambda: token)

    payload = mcp_server._scope_guard("upsert_context_item")
    assert payload is not None
    assert payload["status"] == "forbidden"
    assert payload["error"] == "insufficient_scope"
    assert payload["required_scopes"] == ["wis.context.write"]
    assert payload["present_scopes"] == ["wis.context.read", "wis.context.sync.read"]
    assert payload["missing_scopes"] == ["wis.context.write"]

    meta = payload.get("_meta")
    assert isinstance(meta, dict)
    challenge = meta.get("mcp/www_authenticate")
    assert isinstance(challenge, str)
    assert 'error="insufficient_scope"' in challenge
    assert 'scope="wis.context.write"' in challenge
    assert "https://mcp.wiscontext-sync.org/.well-known/oauth-protected-resource" in challenge
