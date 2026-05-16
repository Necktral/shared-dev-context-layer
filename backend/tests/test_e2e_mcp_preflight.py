"""
E2E preflight: MCP server con auth Auth0 real habilitado.

Estos tests validan el comportamiento del servidor MCP real (local o remoto)
contra los contratos esperados por ChatGPT Custom Connector:

    P1. /.well-known/oauth-protected-resource devuelve metadata correcta
    P2. GET /mcp sin token → 401 + WWW-Authenticate Bearer con resource_metadata
    P3. POST /mcp sin token → 401 + WWW-Authenticate Bearer con resource_metadata
    P4. POST /mcp con token Auth0 real y scope → tool list accesible
        (requiere MCP_E2E_TOKEN env var — se omite si no está presente)

Para correr contra el servidor local (puerto 8002):
    MCP_E2E_BASE_URL=http://localhost:8002 pytest tests/test_e2e_mcp_preflight.py -v

Para correr contra el endpoint remoto:
    MCP_E2E_BASE_URL=https://mcp.wiscontext-sync.org pytest tests/test_e2e_mcp_preflight.py -v

Con token Auth0 real para P4:
    MCP_E2E_TOKEN=<access_token> MCP_E2E_BASE_URL=... pytest tests/test_e2e_mcp_preflight.py -v
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any

import pytest

# ---------------------------------------------------------------------------
# Configuración
# ---------------------------------------------------------------------------

_BASE_URL = os.environ.get("MCP_E2E_BASE_URL", "http://localhost:8002").rstrip("/")
_E2E_TOKEN = os.environ.get("MCP_E2E_TOKEN", "")

# Estas constantes deben coincidir con la configuración del servidor
_EXPECTED_RESOURCE = "https://wis-context-sync-read-api"
_EXPECTED_ISSUER = "https://necktral.us.auth0.com/"
_EXPECTED_SCOPES = {"wis.context.read", "wis.context.sync.read", "wis.context.write", "wis.context.sync.write"}
_EXPECTED_PUBLIC_BASE = "https://mcp.wiscontext-sync.org"
_RESOURCE_METADATA_URL = f"{_EXPECTED_PUBLIC_BASE}/.well-known/oauth-protected-resource"

pytestmark = pytest.mark.e2e


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

class _Response:
    """Wrapper mínimo sobre urllib para presentar interfaz similar a requests."""

    def __init__(self, status_code: int, headers: dict[str, str], body: bytes) -> None:
        self.status_code = status_code
        self.headers = headers
        self.body = body

    @property
    def text(self) -> str:
        return self.body.decode("utf-8", errors="replace")

    def json(self) -> Any:
        return json.loads(self.body)


def _http_get(url: str, token: str | None = None, timeout: int = 10) -> _Response:
    req = urllib.request.Request(url, method="GET")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return _Response(resp.status, dict(resp.headers), resp.read())
    except urllib.error.HTTPError as exc:
        return _Response(exc.code, dict(exc.headers), exc.read())


def _http_post_mcp_initialize(token: str | None = None, timeout: int = 10) -> _Response:
    payload = json.dumps({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "e2e-preflight", "version": "1.0"},
        },
    }).encode()
    req = urllib.request.Request(f"{_BASE_URL}/mcp", data=payload, method="POST")
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return _Response(resp.status, dict(resp.headers), resp.read())
    except urllib.error.HTTPError as exc:
        return _Response(exc.code, dict(exc.headers), exc.read())


# ---------------------------------------------------------------------------
# P1: /.well-known/oauth-protected-resource
# ---------------------------------------------------------------------------

def test_oauth_protected_resource_metadata() -> None:
    """El endpoint de resource metadata devuelve payload correcto."""
    resp = _http_get(f"{_BASE_URL}/.well-known/oauth-protected-resource")
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"

    data = resp.json()
    assert data["resource"] == _EXPECTED_RESOURCE, f"resource inesperado: {data['resource']}"
    assert _EXPECTED_ISSUER in data["authorization_servers"], (
        f"Issuer {_EXPECTED_ISSUER} no encontrado en authorization_servers: {data['authorization_servers']}"
    )
    actual_scopes = set(data.get("scopes_supported", []))
    assert _EXPECTED_SCOPES <= actual_scopes, (
        f"Scopes faltantes: {_EXPECTED_SCOPES - actual_scopes}"
    )
    assert "header" in data.get("bearer_methods_supported", [])


# ---------------------------------------------------------------------------
# P2: GET /mcp sin token → 401 + WWW-Authenticate correcto
# ---------------------------------------------------------------------------

def test_get_mcp_without_token_returns_401() -> None:
    """GET /mcp sin Authorization → 401 con WWW-Authenticate Bearer."""
    resp = _http_get(f"{_BASE_URL}/mcp")
    assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"

    www_auth = resp.headers.get("www-authenticate", resp.headers.get("Www-Authenticate", ""))
    assert "Bearer" in www_auth, f"WWW-Authenticate no contiene Bearer: {www_auth}"
    assert 'error="invalid_token"' in www_auth, f"www-authenticate: {www_auth}"
    assert _RESOURCE_METADATA_URL in www_auth, (
        f"resource_metadata URL no encontrada en www-authenticate: {www_auth}"
    )


# ---------------------------------------------------------------------------
# P3: POST /mcp sin token → 401 + WWW-Authenticate correcto
# ---------------------------------------------------------------------------

def test_post_mcp_initialize_without_token_returns_401() -> None:
    """POST /mcp initialize sin token → 401 con WWW-Authenticate Bearer."""
    resp = _http_post_mcp_initialize(token=None)
    assert resp.status_code == 401, f"Expected 401, got {resp.status_code}: {resp.text}"

    www_auth = resp.headers.get("www-authenticate", resp.headers.get("Www-Authenticate", ""))
    assert "Bearer" in www_auth, f"WWW-Authenticate no contiene Bearer: {www_auth}"
    assert 'error="invalid_token"' in www_auth, f"www-authenticate: {www_auth}"
    assert _RESOURCE_METADATA_URL in www_auth, (
        f"resource_metadata URL no encontrada en www-authenticate: {www_auth}"
    )


# ---------------------------------------------------------------------------
# P4: POST /mcp con token Auth0 real → initialize exitoso
# ---------------------------------------------------------------------------

@pytest.mark.skipif(not _E2E_TOKEN, reason="MCP_E2E_TOKEN no definido; test de token real omitido")
def test_post_mcp_initialize_with_real_auth0_token() -> None:
    """POST /mcp initialize con token Auth0 real → servidor responde (no 401/403)."""
    resp = _http_post_mcp_initialize(token=_E2E_TOKEN)
    assert resp.status_code not in (401, 403), (
        f"Token rechazado ({resp.status_code}): {resp.text[:300]}"
    )
    assert resp.status_code < 500, f"Error de servidor ({resp.status_code}): {resp.text[:300]}"


# ---------------------------------------------------------------------------
# Evidencia: imprimir resumen al final (visible con -s)
# ---------------------------------------------------------------------------

def test_print_preflight_summary() -> None:
    """Imprime resumen de configuración E2E para registro de evidencia."""
    print(f"\n[e2e-preflight] BASE_URL       = {_BASE_URL}")
    print(f"[e2e-preflight] RESOURCE       = {_EXPECTED_RESOURCE}")
    print(f"[e2e-preflight] ISSUER         = {_EXPECTED_ISSUER}")
    print(f"[e2e-preflight] PUBLIC_BASE    = {_EXPECTED_PUBLIC_BASE}")
    print(f"[e2e-preflight] TOKEN present  = {bool(_E2E_TOKEN)}")
