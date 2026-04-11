from __future__ import annotations

import json
import logging
import sys
import time
import uuid
from datetime import datetime, timezone
from typing import Any
from typing import Mapping
from urllib.parse import parse_qsl

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.policies.delegated_limited import SENSITIVE_KEYS

DEFAULT_HEADER_ALLOWLIST = (
    "x-request-id,mcp-session-id,user-agent,x-forwarded-for,traceparent,"
    "mcp-protocol-version,accept,content-type"
)

REDACTED = "[REDACTED]"
_MAX_CAPTURE_BYTES = 16384


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def _is_sensitive_key(key: str) -> bool:
    key_lower = key.lower()
    return any(marker in key_lower for marker in SENSITIVE_KEYS)


def _sanitize_scalar(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return value if len(value) <= 2048 else f"{value[:2048]}...[truncated]"
    return str(value)


def sanitize_structure(value: Any, *, parent_key: str = "") -> Any:
    if isinstance(value, dict):
        cleaned: dict[str, Any] = {}
        for key, nested in value.items():
            key_str = str(key)
            nested_key = f"{parent_key}.{key_str}" if parent_key else key_str
            if _is_sensitive_key(key_str):
                cleaned[key_str] = REDACTED
            else:
                cleaned[key_str] = sanitize_structure(nested, parent_key=nested_key)
        return cleaned
    if isinstance(value, list):
        return [sanitize_structure(item, parent_key=parent_key) for item in value]
    return _sanitize_scalar(value)


def parse_headers_allowlist(value: str | None) -> set[str]:
    if not value:
        value = DEFAULT_HEADER_ALLOWLIST
    parsed = {header.strip().lower() for header in value.split(",") if header.strip()}
    return parsed or {"x-request-id", "mcp-session-id", "user-agent"}


def decode_scope_headers(scope: Scope) -> dict[str, str]:
    out: dict[str, str] = {}
    for raw_key, raw_value in scope.get("headers", []):
        out[raw_key.decode("latin-1").lower()] = raw_value.decode("latin-1")
    return out


def sanitize_headers(headers: Mapping[str, str], allowlist: set[str]) -> dict[str, Any]:
    sanitized: dict[str, Any] = {}
    for key, value in headers.items():
        lower_key = key.lower()
        if lower_key not in allowlist:
            continue
        if lower_key in {"authorization", "cookie", "set-cookie"}:
            continue
        if _is_sensitive_key(lower_key):
            sanitized[lower_key] = REDACTED
            continue
        sanitized[lower_key] = _sanitize_scalar(value)
    return sanitized


def sanitize_query_string(query_string: bytes) -> dict[str, Any]:
    sanitized: dict[str, Any] = {}
    for key, value in parse_qsl(query_string.decode("latin-1"), keep_blank_values=True):
        if _is_sensitive_key(key):
            sanitized[key] = REDACTED
        else:
            sanitized[key] = _sanitize_scalar(value)
    return sanitized


def sanitize_auth_claims(claims: Mapping[str, Any] | None) -> dict[str, Any]:
    if not claims:
        return {}

    allowed = {
        "iss": claims.get("iss"),
        "aud": claims.get("aud"),
        "sub": claims.get("sub"),
        "azp": claims.get("azp"),
        "client_id": claims.get("client_id"),
        "scope": claims.get("scope"),
        "scp": claims.get("scp"),
        "permissions": claims.get("permissions"),
        "exp": claims.get("exp"),
    }
    return sanitize_structure(allowed)


def extract_jsonrpc_info(body: bytes) -> tuple[str | None, Any, dict[str, Any] | None]:
    if not body:
        return None, None, None
    try:
        decoded = json.loads(body)
    except Exception:
        return None, None, None

    if isinstance(decoded, list):
        if not decoded:
            return None, None, None
        first = decoded[0]
        if not isinstance(first, dict):
            return None, None, None
        decoded = first

    if not isinstance(decoded, dict):
        return None, None, None

    method = decoded.get("method")
    rpc_id = decoded.get("id")
    params = decoded.get("params") if isinstance(decoded.get("params"), dict) else None

    return (str(method) if isinstance(method, str) else None, rpc_id, params)


def _configure_logger(logger: logging.Logger, *, level: str) -> None:
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(logging.Formatter("%(message)s"))
        logger.addHandler(handler)
    logger.setLevel(getattr(logging, level.upper(), logging.INFO))
    logger.propagate = False


class MCPStructuredLogger:
    def __init__(
        self,
        *,
        level: str,
        json_enabled: bool,
        log_payloads: bool,
        header_allowlist: str | None,
    ) -> None:
        self._json_enabled = json_enabled
        self.log_payloads = log_payloads
        self.header_allowlist = parse_headers_allowlist(header_allowlist)
        self.logger = logging.getLogger("app.mcp.observability")
        _configure_logger(self.logger, level=level)

    def emit(self, event_name: str, *, level: str = "INFO", **fields: Any) -> None:
        payload: dict[str, Any] = {
            "timestamp": _utc_now_iso(),
            "level": level.lower(),
            "event_name": event_name,
        }
        for key, value in fields.items():
            if value is None:
                continue
            payload[key] = sanitize_structure(value) if isinstance(value, (dict, list)) else _sanitize_scalar(value)

        level_int = getattr(logging, level.upper(), logging.INFO)
        if self._json_enabled:
            self.logger.log(level_int, json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
        else:
            as_text = " ".join(f"{key}={value!r}" for key, value in payload.items())
            self.logger.log(level_int, as_text)


def _extract_client_ip(scope: Scope, headers: Mapping[str, str]) -> str | None:
    forwarded_for = headers.get("x-forwarded-for")
    if forwarded_for:
        return _sanitize_scalar(forwarded_for)
    client = scope.get("client")
    if isinstance(client, tuple) and client:
        return _sanitize_scalar(client[0])
    return None


class MCPTransportObservabilityASGI:
    def __init__(self, app: ASGIApp, *, logger: MCPStructuredLogger, streamable_path: str) -> None:
        self.app = app
        self.logger = logger
        self.streamable_path = streamable_path

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope.get("type") != "http" or scope.get("path") != self.streamable_path:
            await self.app(scope, receive, send)
            return

        started_at = time.perf_counter()
        request_headers = decode_scope_headers(scope)
        query_sanitized = sanitize_query_string(scope.get("query_string", b""))
        headers_sanitized = sanitize_headers(request_headers, self.logger.header_allowlist)

        request_id = request_headers.get("x-request-id") or str(uuid.uuid4())
        auth_present = bool(request_headers.get("authorization"))
        remote_addr = _extract_client_ip(scope, request_headers)
        method = str(scope.get("method", "UNKNOWN"))
        path = str(scope.get("path", ""))
        request_mcp_session = request_headers.get("mcp-session-id")

        request_body = bytearray()
        rpc_method: str | None = None
        rpc_id: Any = None
        tool_name: str | None = None

        response_status: int | None = None
        response_headers: dict[str, str] = {}
        response_body = bytearray()

        self.logger.emit(
            "mcp_request_started",
            request_id=request_id,
            path=path,
            method=method,
            query_params=query_sanitized,
            auth_present=auth_present,
            remote_addr=remote_addr,
            user_agent=request_headers.get("user-agent"),
            mcp_session_id=request_mcp_session,
            headers=headers_sanitized,
            auth_stage="transport",
        )

        async def wrapped_receive() -> Message:
            nonlocal rpc_method, rpc_id, tool_name
            message = await receive()
            if message.get("type") == "http.request":
                body = message.get("body", b"")
                if body and len(request_body) < _MAX_CAPTURE_BYTES:
                    request_body.extend(body[: _MAX_CAPTURE_BYTES - len(request_body)])

                if not message.get("more_body", False) and rpc_method is None:
                    rpc_method, rpc_id, params = extract_jsonrpc_info(bytes(request_body))
                    if rpc_method == "tools/call" and isinstance(params, dict):
                        tool_name = params.get("name") if isinstance(params.get("name"), str) else None
                    if rpc_method == "initialize":
                        self.logger.emit(
                            "mcp_handshake_initialize_started",
                            request_id=request_id,
                            path=path,
                            method=method,
                            mcp_session_id=request_mcp_session,
                            rpc_id=rpc_id,
                            auth_stage="transport",
                        )
            return message

        async def wrapped_send(message: Message) -> None:
            nonlocal response_status
            msg_type = message.get("type")
            if msg_type == "http.response.start":
                response_status = int(message.get("status", 0))
                decoded: dict[str, str] = {}
                for raw_key, raw_value in message.get("headers", []):
                    decoded[raw_key.decode("latin-1").lower()] = raw_value.decode("latin-1")
                response_headers.update(decoded)
            elif msg_type == "http.response.body":
                body = message.get("body", b"")
                if body and len(response_body) < _MAX_CAPTURE_BYTES:
                    response_body.extend(body[: _MAX_CAPTURE_BYTES - len(response_body)])
            await send(message)

        try:
            await self.app(scope, wrapped_receive, wrapped_send)
        except Exception as exc:  # noqa: BLE001
            duration_ms = round((time.perf_counter() - started_at) * 1000, 3)
            self.logger.emit(
                "mcp_request_failed",
                level="ERROR",
                request_id=request_id,
                path=path,
                method=method,
                duration_ms=duration_ms,
                auth_present=auth_present,
                auth_stage="transport",
                exception={"class": exc.__class__.__name__, "message": str(exc)},
                rpc_method=rpc_method,
                tool_name=tool_name,
            )
            if rpc_method == "initialize":
                self.logger.emit(
                    "mcp_handshake_initialize_failed",
                    level="ERROR",
                    request_id=request_id,
                    path=path,
                    method=method,
                    duration_ms=duration_ms,
                    auth_stage="transport",
                    exception={"class": exc.__class__.__name__, "message": str(exc)},
                )
            raise

        duration_ms = round((time.perf_counter() - started_at) * 1000, 3)
        response_mcp_session = response_headers.get("mcp-session-id") or request_mcp_session
        www_auth = response_headers.get("www-authenticate")

        self.logger.emit(
            "mcp_request_completed",
            request_id=request_id,
            path=path,
            method=method,
            status_code=response_status,
            duration_ms=duration_ms,
            auth_present=auth_present,
            remote_addr=remote_addr,
            user_agent=request_headers.get("user-agent"),
            mcp_session_id=response_mcp_session,
            auth_stage="transport",
            rpc_method=rpc_method,
            rpc_id=rpc_id,
            tool_name=tool_name,
        )

        if response_status == 401:
            self.logger.emit(
                "mcp_auth_missing" if not auth_present else "mcp_auth_invalid",
                level="WARNING",
                request_id=request_id,
                path=path,
                method=method,
                status_code=response_status,
                duration_ms=duration_ms,
                auth_present=auth_present,
                auth_stage="transport",
                www_authenticate=www_auth,
                mcp_session_id=response_mcp_session,
                rpc_method=rpc_method,
                tool_name=tool_name,
            )
        elif response_status == 403:
            self.logger.emit(
                "mcp_auth_scope_denied",
                level="WARNING",
                request_id=request_id,
                path=path,
                method=method,
                status_code=response_status,
                duration_ms=duration_ms,
                auth_present=auth_present,
                auth_stage="transport",
                www_authenticate=www_auth,
                mcp_session_id=response_mcp_session,
                rpc_method=rpc_method,
                tool_name=tool_name,
            )

        if rpc_method == "initialize":
            if response_status is not None and response_status < 400:
                self.logger.emit(
                    "mcp_handshake_initialize_succeeded",
                    request_id=request_id,
                    path=path,
                    method=method,
                    status_code=response_status,
                    duration_ms=duration_ms,
                    mcp_session_id=response_mcp_session,
                    auth_stage="transport",
                )
            else:
                self.logger.emit(
                    "mcp_handshake_initialize_failed",
                    level="ERROR",
                    request_id=request_id,
                    path=path,
                    method=method,
                    status_code=response_status,
                    duration_ms=duration_ms,
                    auth_stage="transport",
                    mcp_session_id=response_mcp_session,
                )

        if rpc_method in {"initialize", "tools/list", "tools/call"} and response_status and response_status < 400:
            if not response_headers.get("mcp-session-id"):
                self.logger.emit(
                    "mcp_contract_drift_detected",
                    level="WARNING",
                    request_id=request_id,
                    path=path,
                    method=method,
                    status_code=response_status,
                    duration_ms=duration_ms,
                    auth_stage="transport",
                    rpc_method=rpc_method,
                    tool_name=tool_name,
                    reason="missing_mcp_session_id",
                )


def build_mcp_logger(settings: Any) -> MCPStructuredLogger:
    return MCPStructuredLogger(
        level=str(getattr(settings, "mcp_log_level", "INFO")),
        json_enabled=bool(getattr(settings, "mcp_log_json", True)),
        log_payloads=bool(getattr(settings, "mcp_log_payloads", False)),
        header_allowlist=getattr(settings, "mcp_log_include_headers_allowlist", DEFAULT_HEADER_ALLOWLIST),
    )
