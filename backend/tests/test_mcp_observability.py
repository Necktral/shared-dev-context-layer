from __future__ import annotations

import anyio
import mcp.types as mcp_types
from mcp.server.auth.provider import AccessToken
from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Route
from starlette.testclient import TestClient

from app.mcp import server as mcp_server
from app.mcp.observability import MCPTransportObservabilityASGI


class _CollectorLogger:
    def __init__(self) -> None:
        self.events: list[dict[str, object]] = []
        self.header_allowlist = {
            "x-request-id",
            "mcp-session-id",
            "user-agent",
            "x-forwarded-for",
            "accept",
            "content-type",
        }
        self.log_payloads = False

    def emit(self, event_name: str, **fields: object) -> None:
        self.events.append({"event_name": event_name, **fields})


def _event_names(events: list[dict[str, object]]) -> list[str]:
    return [str(event["event_name"]) for event in events]


def _build_post_mcp_app(handler):
    async def endpoint(request):
        return await handler(request)

    return Starlette(routes=[Route("/mcp", endpoint=endpoint, methods=["POST"])])


def test_transport_logs_unauthorized_without_auth_header() -> None:
    collector = _CollectorLogger()

    async def unauthorized_handler(_request):
        return JSONResponse(
            {"error": "invalid_token", "error_description": "Authentication required"},
            status_code=401,
            headers={"WWW-Authenticate": 'Bearer error="invalid_token"'},
        )

    wrapped = MCPTransportObservabilityASGI(
        _build_post_mcp_app(unauthorized_handler),
        logger=collector,
        streamable_path="/mcp",
    )

    with TestClient(wrapped) as client:
        response = client.post("/mcp", json={"jsonrpc": "2.0", "id": "1", "method": "ping"})

    assert response.status_code == 401
    names = _event_names(collector.events)
    assert "mcp_request_started" in names
    assert "mcp_request_completed" in names
    assert "mcp_auth_missing" in names


def test_transport_logs_auth_invalid_with_authorization_header() -> None:
    collector = _CollectorLogger()

    async def invalid_auth_handler(_request):
        return JSONResponse(
            {"error": "invalid_token", "error_description": "bad token"},
            status_code=401,
            headers={"WWW-Authenticate": 'Bearer error="invalid_token"'},
        )

    wrapped = MCPTransportObservabilityASGI(
        _build_post_mcp_app(invalid_auth_handler),
        logger=collector,
        streamable_path="/mcp",
    )

    with TestClient(wrapped) as client:
        response = client.post(
            "/mcp",
            json={"jsonrpc": "2.0", "id": "1", "method": "ping"},
            headers={"Authorization": "Bearer test.invalid.token"},
        )

    assert response.status_code == 401
    names = _event_names(collector.events)
    assert "mcp_auth_invalid" in names


def test_transport_logs_initialize_and_contract_drift_when_session_header_missing() -> None:
    collector = _CollectorLogger()

    async def initialize_ok_no_session_header_handler(request):
        await request.body()
        return JSONResponse(
            {
                "jsonrpc": "2.0",
                "id": "1",
                "result": {
                    "protocolVersion": "2025-06-18",
                    "capabilities": {},
                    "serverInfo": {"name": "test", "version": "1.0"},
                },
            },
            status_code=200,
        )

    wrapped = MCPTransportObservabilityASGI(
        _build_post_mcp_app(initialize_ok_no_session_header_handler),
        logger=collector,
        streamable_path="/mcp",
    )

    with TestClient(wrapped) as client:
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

    assert response.status_code == 200
    names = _event_names(collector.events)
    assert "mcp_handshake_initialize_started" in names
    assert "mcp_handshake_initialize_succeeded" in names
    assert "mcp_contract_drift_detected" in names


def test_runtime_logs_list_tools_and_call_tool_success(monkeypatch) -> None:
    events: list[dict[str, object]] = []

    def capture(event_name: str, **fields: object) -> None:
        events.append({"event_name": event_name, **fields})

    monkeypatch.setattr(mcp_server.mcp_logger, "emit", capture)
    monkeypatch.setattr(mcp_server.settings, "mcp_auth_bypass_local", True)

    list_handler = mcp_server.mcp._mcp_server.request_handlers[mcp_types.ListToolsRequest]
    list_req = mcp_types.ListToolsRequest.model_validate(
        {
            "jsonrpc": "2.0",
            "id": "1",
            "method": "tools/list",
            "params": {},
        }
    )
    list_result = anyio.run(list_handler, list_req)
    assert isinstance(list_result.root, mcp_types.ListToolsResult)

    call_handler = mcp_server.mcp._mcp_server.request_handlers[mcp_types.CallToolRequest]
    call_req = mcp_types.CallToolRequest.model_validate(
        {
            "jsonrpc": "2.0",
            "id": "2",
            "method": "tools/call",
            "params": {
                "name": "get_active_task",
                "arguments": {},
            },
        }
    )
    call_result = anyio.run(call_handler, call_req)
    assert isinstance(call_result.root, mcp_types.CallToolResult)

    names = _event_names(events)
    assert "mcp_list_tools_started" in names
    assert "mcp_list_tools_succeeded" in names
    assert "mcp_call_tool_started" in names
    assert "mcp_call_tool_succeeded" in names


def test_runtime_logs_scope_denied_and_tool_exception(monkeypatch) -> None:
    events: list[dict[str, object]] = []

    def capture(event_name: str, **fields: object) -> None:
        events.append({"event_name": event_name, **fields})

    monkeypatch.setattr(mcp_server.mcp_logger, "emit", capture)
    monkeypatch.setattr(mcp_server.settings, "mcp_auth_enabled", True)
    monkeypatch.setattr(mcp_server.settings, "mcp_auth_bypass_local", False)

    read_only_token = AccessToken(
        token="header.payload.signature",
        client_id="auth0|read-only",
        scopes=["wis.context.read", "wis.context.sync.read"],
        expires_at=None,
        resource="https://wis-context-sync-read-api",
    )
    monkeypatch.setattr(mcp_server, "get_access_token", lambda: read_only_token)

    call_handler = mcp_server.mcp._mcp_server.request_handlers[mcp_types.CallToolRequest]
    forbidden_req = mcp_types.CallToolRequest.model_validate(
        {
            "jsonrpc": "2.0",
            "id": "3",
            "method": "tools/call",
            "params": {
                "name": "upsert_context_item",
                "arguments": {
                    "item_key": "scope.denied.item",
                    "item_type": "note",
                    "title": "Scope denied",
                    "dry_run": True,
                },
            },
        }
    )
    forbidden_result = anyio.run(call_handler, forbidden_req)
    assert isinstance(forbidden_result.root, mcp_types.CallToolResult)
    structured = forbidden_result.root.structuredContent
    assert isinstance(structured, dict)
    assert structured.get("status") == "forbidden"
    assert structured.get("error") == "insufficient_scope"

    unknown_tool_req = mcp_types.CallToolRequest.model_validate(
        {
            "jsonrpc": "2.0",
            "id": "4",
            "method": "tools/call",
            "params": {
                "name": "tool_does_not_exist",
                "arguments": {},
            },
        }
    )
    unknown_result = anyio.run(call_handler, unknown_tool_req)
    assert isinstance(unknown_result.root, mcp_types.CallToolResult)
    assert unknown_result.root.isError is True

    failed_events = [event for event in events if event.get("event_name") == "mcp_call_tool_failed"]
    assert failed_events
    assert any(event.get("failure_classification") == "scope_denied" for event in failed_events)
    assert any(event.get("failure_classification") == "unexpected_error" for event in failed_events)


def test_origin_guard_blocks_unlisted_origin() -> None:
    collector = _CollectorLogger()

    async def ok_handler(_request):
        return JSONResponse({"status": "ok"}, status_code=200)

    wrapped = MCPTransportObservabilityASGI(
        _build_post_mcp_app(ok_handler),
        logger=collector,
        streamable_path="/mcp",
        allowed_origins=["https://chatgpt.com"],
    )

    with TestClient(wrapped) as client:
        response = client.post(
            "/mcp",
            json={"jsonrpc": "2.0", "id": "1", "method": "ping"},
            headers={"Origin": "https://evil.example"},
        )

    assert response.status_code == 403
    assert response.json()["error"] == "invalid_origin"
    assert "mcp_origin_denied" in _event_names(collector.events)


def test_origin_guard_allows_listed_origin() -> None:
    collector = _CollectorLogger()

    async def ok_handler(_request):
        return JSONResponse({"status": "ok"}, status_code=200)

    wrapped = MCPTransportObservabilityASGI(
        _build_post_mcp_app(ok_handler),
        logger=collector,
        streamable_path="/mcp",
        allowed_origins=["https://chatgpt.com"],
    )

    with TestClient(wrapped) as client:
        response = client.post(
            "/mcp",
            json={"jsonrpc": "2.0", "id": "1", "method": "ping"},
            headers={"Origin": "https://chatgpt.com"},
        )

    assert response.status_code == 200
    assert "mcp_origin_denied" not in _event_names(collector.events)


def test_origin_guard_is_permissive_when_allowlist_is_empty() -> None:
    collector = _CollectorLogger()

    async def ok_handler(_request):
        return JSONResponse({"status": "ok"}, status_code=200)

    wrapped = MCPTransportObservabilityASGI(
        _build_post_mcp_app(ok_handler),
        logger=collector,
        streamable_path="/mcp",
        allowed_origins=[],
    )

    with TestClient(wrapped) as client:
        response = client.post(
            "/mcp",
            json={"jsonrpc": "2.0", "id": "1", "method": "ping"},
            headers={"Origin": "https://any-origin.example"},
        )

    assert response.status_code == 200
    assert "mcp_origin_denied" not in _event_names(collector.events)
