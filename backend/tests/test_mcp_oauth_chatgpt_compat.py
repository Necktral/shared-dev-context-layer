from __future__ import annotations

from starlette.testclient import TestClient

from app.mcp import server as mcp_server


def _build_auth_runtime_app(monkeypatch):
    monkeypatch.setattr(mcp_server.settings, "mcp_auth_enabled", True)
    monkeypatch.setattr(mcp_server.settings, "mcp_auth_bypass_local", False)
    monkeypatch.setattr(mcp_server.settings, "mcp_auth0_issuer", "https://necktral.us.auth0.com/")
    monkeypatch.setattr(mcp_server.settings, "mcp_auth0_audience", "https://wis-context-sync-read-api")
    monkeypatch.setattr(mcp_server.settings, "mcp_auth0_jwks_url", "https://necktral.us.auth0.com/.well-known/jwks.json")
    monkeypatch.setattr(mcp_server.settings, "mcp_public_base_url", "https://mcp.wiscontext-sync.org")
    monkeypatch.setattr(mcp_server.settings, "mcp_resource_id", "https://wis-context-sync-read-api")
    monkeypatch.setattr(mcp_server.settings, "mcp_allowed_origins", "")
    runtime_mcp = mcp_server._build_mcp_server()
    return mcp_server.build_observed_streamable_http_app(runtime_mcp)


def test_protected_resource_metadata_contract(monkeypatch) -> None:
    app = _build_auth_runtime_app(monkeypatch)

    with TestClient(app) as client:
        response = client.get("/.well-known/oauth-protected-resource")

    assert response.status_code == 200
    payload = response.json()
    assert payload["resource"] == "https://wis-context-sync-read-api"
    assert payload["authorization_servers"] == ["https://necktral.us.auth0.com/"]
    assert payload["scopes_supported"] == [
        "wis.context.read",
        "wis.context.sync.read",
        "wis.context.write",
        "wis.context.sync.write",
    ]


def test_mcp_get_without_token_returns_401_www_authenticate(monkeypatch) -> None:
    app = _build_auth_runtime_app(monkeypatch)

    with TestClient(app) as client:
        response = client.get("/mcp", headers={"Accept": "text/event-stream"})

    assert response.status_code == 401
    challenge = response.headers.get("www-authenticate", "")
    assert 'error="invalid_token"' in challenge
    assert 'error_description="Authentication required"' in challenge
    assert 'resource_metadata="' in challenge


def test_mcp_post_without_token_returns_401_www_authenticate(monkeypatch) -> None:
    app = _build_auth_runtime_app(monkeypatch)

    with TestClient(app) as client:
        response = client.post(
            "/mcp",
            json={
                "jsonrpc": "2.0",
                "id": "1",
                "method": "initialize",
                "params": {
                    "protocolVersion": "2025-06-18",
                    "capabilities": {},
                    "clientInfo": {"name": "pytest", "version": "1.0"},
                },
            },
        )

    assert response.status_code == 401
    challenge = response.headers.get("www-authenticate", "")
    assert 'error="invalid_token"' in challenge
    assert 'error_description="Authentication required"' in challenge
    assert 'resource_metadata="' in challenge
