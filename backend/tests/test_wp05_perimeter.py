"""WP-0.5 — cierre de perímetro (backend).

Cubre dos agujeros: /mcp/info filtraba la postura de auth (infoleak), y la API HTTP
interna (/internal/*) era un plano de escritura sin identidad. Ahora /mcp/info no
filtra nada y /internal/* es fail-closed sin INTERNAL_API_TOKEN.
"""

from starlette.testclient import TestClient

from app.main import app


def test_mcp_info_does_not_leak_auth_posture():
    with TestClient(app) as client:
        resp = client.get("/mcp/info")
    assert resp.status_code == 200
    assert "auth_enabled" not in resp.json()  # antes filtraba la postura de auth


def test_internal_api_is_fail_closed_without_token():
    with TestClient(app) as client:
        resp = client.post("/internal/events", json={"event_type": "info", "summary": "x"})
    # Sin INTERNAL_API_TOKEN configurado, la API interna se rechaza (fail-closed, no se abre).
    assert resp.status_code == 503


def test_openapi_docs_disabled_outside_dev():
    with TestClient(app) as client:
        assert client.get("/openapi.json").status_code == 404
        assert client.get("/docs").status_code == 404
