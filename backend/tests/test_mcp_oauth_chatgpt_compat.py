from __future__ import annotations

from mcp.server.auth.provider import AccessToken
from starlette.testclient import TestClient

from app.mcp import server as mcp_server


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

class _AlwaysRejectVerifier:
    """Verifier that always returns None — simulates expired/bad-signature/wrong-aud tokens."""

    async def verify_token(self, token: str) -> None:
        return None


class _AcceptWithScopesVerifier:
    """Verifier that accepts any token and returns an AccessToken with given scopes."""

    def __init__(self, scopes: list[str]) -> None:
        self.scopes = scopes

    async def verify_token(self, token: str) -> AccessToken:
        return AccessToken(
            token=token,
            client_id="test-chatgpt-client",
            scopes=self.scopes,
            expires_at=None,
            resource="https://wis-context-sync-read-api",
        )


def _build_app_with_verifier(monkeypatch, verifier):
    """Build the auth-runtime app, injecting a custom token verifier."""
    monkeypatch.setattr(mcp_server.settings, "mcp_auth_enabled", True)
    monkeypatch.setattr(mcp_server.settings, "mcp_auth_bypass_local", False)
    monkeypatch.setattr(mcp_server.settings, "mcp_auth0_issuer", "https://necktral.us.auth0.com/")
    monkeypatch.setattr(mcp_server.settings, "mcp_auth0_audience", "https://wis-context-sync-read-api")
    monkeypatch.setattr(mcp_server.settings, "mcp_auth0_jwks_url", "https://necktral.us.auth0.com/.well-known/jwks.json")
    monkeypatch.setattr(mcp_server.settings, "mcp_public_base_url", "https://mcp.wiscontext-sync.org")
    monkeypatch.setattr(mcp_server.settings, "mcp_resource_id", "https://wis-context-sync-read-api")
    monkeypatch.setattr(mcp_server.settings, "mcp_allowed_origins", "")
    monkeypatch.setattr(mcp_server, "Auth0JWTTokenVerifier", lambda **kw: verifier)
    runtime_mcp = mcp_server._build_mcp_server()
    return mcp_server.build_observed_streamable_http_app(runtime_mcp)


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
        "wis.context.ratify",
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


# ---------------------------------------------------------------------------
# Task 5 — token inválido (verifier rechaza) → 401 invalid_token
# ---------------------------------------------------------------------------

def test_mcp_post_with_rejected_token_returns_401_invalid_token(monkeypatch) -> None:
    """Token provided but verifier returns None (bad signature, expired, etc.) → 401."""
    app = _build_app_with_verifier(monkeypatch, _AlwaysRejectVerifier())

    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.post(
            "/mcp",
            headers={"Authorization": "Bearer bad.token.here"},
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
    assert "Bearer" in challenge
    assert 'error="invalid_token"' in challenge


# ---------------------------------------------------------------------------
# Task 6 — token válido sin scope mínimo → 403 insufficient_scope (transport)
# ---------------------------------------------------------------------------

def test_mcp_post_with_token_missing_required_scope_returns_403(monkeypatch) -> None:
    """Token verified but lacks minimum required wis.context.read scope → 403."""
    # Token has no scopes at all — doesn't satisfy required_scopes=["wis.context.read"]
    app = _build_app_with_verifier(monkeypatch, _AcceptWithScopesVerifier([]))

    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.post(
            "/mcp",
            headers={"Authorization": "Bearer valid.but.no.scope"},
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

    assert response.status_code == 403
    challenge = response.headers.get("www-authenticate", "")
    assert "Bearer" in challenge
    assert 'error="insufficient_scope"' in challenge


# ---------------------------------------------------------------------------
# Task 9 — Origin guard no bloquea ChatGPT cuando el origen es esperado
# ---------------------------------------------------------------------------

def _build_app_with_origin(monkeypatch, allowed_origins: str) -> object:
    """Build auth-runtime app with a specific allowed_origins restriction."""
    monkeypatch.setattr(mcp_server.settings, "mcp_auth_enabled", True)
    monkeypatch.setattr(mcp_server.settings, "mcp_auth_bypass_local", False)
    monkeypatch.setattr(mcp_server.settings, "mcp_auth0_issuer", "https://necktral.us.auth0.com/")
    monkeypatch.setattr(mcp_server.settings, "mcp_auth0_audience", "https://wis-context-sync-read-api")
    monkeypatch.setattr(mcp_server.settings, "mcp_auth0_jwks_url", "https://necktral.us.auth0.com/.well-known/jwks.json")
    monkeypatch.setattr(mcp_server.settings, "mcp_public_base_url", "https://mcp.wiscontext-sync.org")
    monkeypatch.setattr(mcp_server.settings, "mcp_resource_id", "https://wis-context-sync-read-api")
    # Set the normalized origin list that the MCPTransportObservabilityASGI will read
    monkeypatch.setattr(mcp_server.settings, "mcp_allowed_origins", allowed_origins)
    monkeypatch.setattr(mcp_server, "Auth0JWTTokenVerifier", lambda **kw: _AlwaysRejectVerifier())
    runtime_mcp = mcp_server._build_mcp_server()
    return mcp_server.build_observed_streamable_http_app(runtime_mcp)


def test_origin_guard_allows_expected_chatgpt_origin(monkeypatch) -> None:
    """Requests from the expected ChatGPT origin pass through the origin guard."""
    app = _build_app_with_origin(monkeypatch, "https://chatgpt.com")

    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.post(
            "/mcp",
            headers={
                "Origin": "https://chatgpt.com",
                "Authorization": "Bearer some.token",
            },
            json={"jsonrpc": "2.0", "id": "1", "method": "initialize", "params": {
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": {"name": "pytest", "version": "1.0"},
            }},
        )

    # Origin passes, but token is rejected → 401 (not 403 invalid_origin)
    assert response.status_code == 401
    assert "invalid_origin" not in response.text


def test_origin_guard_allows_request_with_no_origin_header(monkeypatch) -> None:
    """Requests without an Origin header pass through origin guard (non-browser clients)."""
    app = _build_app_with_origin(monkeypatch, "https://chatgpt.com")

    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.post(
            "/mcp",
            headers={"Authorization": "Bearer some.token"},
            json={"jsonrpc": "2.0", "id": "1", "method": "initialize", "params": {
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": {"name": "pytest", "version": "1.0"},
            }},
        )

    # No origin → guard passes, token rejected → 401 (not 403 invalid_origin)
    assert response.status_code == 401
    assert "invalid_origin" not in response.text


def test_origin_guard_blocks_unexpected_origin(monkeypatch) -> None:
    """Requests from an unexpected origin are rejected with 403 invalid_origin."""
    app = _build_app_with_origin(monkeypatch, "https://chatgpt.com")

    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.post(
            "/mcp",
            headers={
                "Origin": "https://attacker.example.com",
                "Authorization": "Bearer some.token",
            },
            json={"jsonrpc": "2.0", "id": "1", "method": "initialize", "params": {
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": {"name": "pytest", "version": "1.0"},
            }},
        )

    assert response.status_code == 403
    body = response.json()
    assert body.get("error") == "invalid_origin"


def test_origin_guard_default_deny_when_no_origins_and_auth_active(monkeypatch) -> None:
    """WP-0.5(d): con auth runtime activo y MCP_ALLOWED_ORIGINS vacío, un Origin de
    navegador se rechaza (default-deny); una request SIN Origin (no-navegador) pasa."""
    app = _build_app_with_origin(monkeypatch, "")
    body = {
        "jsonrpc": "2.0",
        "id": "1",
        "method": "initialize",
        "params": {
            "protocolVersion": "2025-06-18",
            "capabilities": {},
            "clientInfo": {"name": "pytest", "version": "1.0"},
        },
    }

    with TestClient(app, raise_server_exceptions=False) as client:
        # Navegador cross-origin con allowlist vacía → denegado (default-deny).
        denied = client.post(
            "/mcp",
            headers={"Origin": "https://any-origin.example.com", "Authorization": "Bearer some.token"},
            json=body,
        )
        assert denied.status_code == 403
        assert "invalid_origin" in denied.text

        # Sin cabecera Origin (cliente no-navegador) → pasa el guard; token rechazado → 401.
        passed = client.post("/mcp", headers={"Authorization": "Bearer some.token"}, json=body)
        assert passed.status_code == 401
        assert "invalid_origin" not in passed.text


# ---------------------------------------------------------------------------
# P2 — startup warning when auth enabled but origin guard is permissive
# ---------------------------------------------------------------------------

def test_build_app_emits_origin_guard_permissive_warning_when_origins_not_set(monkeypatch) -> None:
    """build_observed_streamable_http_app emits mcp_origin_guard_permissive when
    auth runtime is active but MCP_ALLOWED_ORIGINS is empty."""

    class _CapturingLogger:
        def __init__(self) -> None:
            self.events: list[str] = []
            self.header_allowlist: set[str] = set()
            self.log_payloads = False

        def emit(self, event_name: str, **fields: object) -> None:
            self.events.append(event_name)

    capturing_logger = _CapturingLogger()

    monkeypatch.setattr(mcp_server.settings, "mcp_auth_enabled", True)
    monkeypatch.setattr(mcp_server.settings, "mcp_auth_bypass_local", False)
    monkeypatch.setattr(mcp_server.settings, "mcp_auth0_issuer", "https://necktral.us.auth0.com/")
    monkeypatch.setattr(mcp_server.settings, "mcp_auth0_audience", "https://wis-context-sync-read-api")
    monkeypatch.setattr(mcp_server.settings, "mcp_auth0_jwks_url", "https://necktral.us.auth0.com/.well-known/jwks.json")
    monkeypatch.setattr(mcp_server.settings, "mcp_public_base_url", "https://mcp.wiscontext-sync.org")
    monkeypatch.setattr(mcp_server.settings, "mcp_resource_id", "https://wis-context-sync-read-api")
    monkeypatch.setattr(mcp_server.settings, "mcp_allowed_origins", "")
    monkeypatch.setattr(mcp_server, "Auth0JWTTokenVerifier", lambda **kw: _AlwaysRejectVerifier())
    monkeypatch.setattr(mcp_server, "mcp_logger", capturing_logger)

    runtime_mcp = mcp_server._build_mcp_server()
    mcp_server.build_observed_streamable_http_app(runtime_mcp)

    assert "mcp_origin_guard_permissive" in capturing_logger.events


def test_build_app_no_permissive_warning_when_origins_configured(monkeypatch) -> None:
    """No mcp_origin_guard_permissive warning when MCP_ALLOWED_ORIGINS is set."""

    class _CapturingLogger:
        def __init__(self) -> None:
            self.events: list[str] = []
            self.header_allowlist: set[str] = set()
            self.log_payloads = False

        def emit(self, event_name: str, **fields: object) -> None:
            self.events.append(event_name)

    capturing_logger = _CapturingLogger()

    monkeypatch.setattr(mcp_server.settings, "mcp_auth_enabled", True)
    monkeypatch.setattr(mcp_server.settings, "mcp_auth_bypass_local", False)
    monkeypatch.setattr(mcp_server.settings, "mcp_auth0_issuer", "https://necktral.us.auth0.com/")
    monkeypatch.setattr(mcp_server.settings, "mcp_auth0_audience", "https://wis-context-sync-read-api")
    monkeypatch.setattr(mcp_server.settings, "mcp_auth0_jwks_url", "https://necktral.us.auth0.com/.well-known/jwks.json")
    monkeypatch.setattr(mcp_server.settings, "mcp_public_base_url", "https://mcp.wiscontext-sync.org")
    monkeypatch.setattr(mcp_server.settings, "mcp_resource_id", "https://wis-context-sync-read-api")
    monkeypatch.setattr(mcp_server.settings, "mcp_allowed_origins", "https://chatgpt.com")
    monkeypatch.setattr(mcp_server, "Auth0JWTTokenVerifier", lambda **kw: _AlwaysRejectVerifier())
    monkeypatch.setattr(mcp_server, "mcp_logger", capturing_logger)

    runtime_mcp = mcp_server._build_mcp_server()
    mcp_server.build_observed_streamable_http_app(runtime_mcp)

    assert "mcp_origin_guard_permissive" not in capturing_logger.events
