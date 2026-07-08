from __future__ import annotations

import uuid
from typing import Any
from typing import cast

import mcp.types as mcp_types
from mcp.server.auth.middleware.auth_context import get_access_token
from mcp.server.auth.routes import build_resource_metadata_url, cors_middleware
from mcp.server.auth.settings import AuthSettings
from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations
from sqlalchemy import select
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from app.audit.service import record_publish_audit
from app.audit.write_audit_service import get_existing_request_audit, record_write_audit
from app.auth.jwt_verifier import Auth0JWTTokenVerifier, decode_unverified_claims
from app.core.config import Settings, get_settings
from app.db.session import SessionLocal
from app.mcp.observability import MCPTransportObservabilityASGI
from app.mcp.observability import build_mcp_logger
from app.mcp.observability import sanitize_auth_claims
from app.mcp.observability import sanitize_structure
from app.mcp.governed_write import (
    RatificationSpec,
    WriteOutcome,
    _ensure_idempotency_key,
    _existing_replay_payload,
    _extract_actor_context,
    _invalid_request,
    _require_ratification,
    _write_audit_and_filter,
    run_governed_write,
)
from app.models.context_item import ContextItem
from app.models.context_snapshot import ContextSnapshot
from app.models.event import Event
from app.models.task import Task
from app.models.validation_run import ValidationRun
from app.policies.delegated_limited import apply_delegated_limited_policy
from app.services.context_snapshot_service import build_operational_snapshot
from app.services.context_item_service import (
    append_context_labels as append_context_labels_service,
    archive_context_item as archive_context_item_service,
    context_item_to_dict,
    create_or_reuse_sync_batch as create_or_reuse_sync_batch_service,
    get_context_item_by_id as get_context_item_by_id_service,
    get_sync_status as get_sync_status_service,
    link_context_entities as link_context_entities_service,
    list_context_windows as list_context_windows_service,
    make_preview_item_key,
    resolve_related_items as resolve_related_items_service,
    search_context_items as search_context_items_service,
    upsert_context_item as upsert_context_item_service,
)
from app.services.decision_service import list_active_decisions_for_scope
from app.services.event_service import create_event_for_task, list_recent_errors_for_task
from app.services.focus_resolver import ResolvedScope, resolve_scope
from app.services.snapshot_service import create_manual_snapshot, get_latest_snapshot_for_task
from app.services.validation_service import get_latest_validation_run_for_scope
from app.schemas.event import EventCreate
from app.schemas.snapshot import ManualSnapshotCreate

settings: Settings = get_settings()
mcp_logger = build_mcp_logger(settings)

TOOL_SCOPES: dict[str, list[str]] = {
    "get_active_task": ["wis.context.read"],
    "get_context_snapshot": ["wis.context.read"],
    "get_recent_errors": ["wis.context.read"],
    "get_validation_status": ["wis.context.read"],
    "get_approved_decisions": ["wis.context.read"],
    "search_context": ["wis.context.read"],
    "get_context_by_id": ["wis.context.read"],
    "list_context_windows": ["wis.context.read"],
    "resolve_related_items": ["wis.context.read"],
    "get_sync_status": ["wis.context.sync.read"],
    "preview_write_impact": ["wis.context.write"],
    "upsert_context_item": ["wis.context.write"],
    "append_context_event": ["wis.context.write"],
    "link_context_entities": ["wis.context.write"],
    "set_context_labels": ["wis.context.write"],
    "archive_context_item": ["wis.context.write"],
    "apply_sync_batch": ["wis.context.sync.write"],
    "propose_change": ["wis.context.write"],
    "list_proposals": ["wis.context.read"],
    "ratify_proposal": ["wis.context.ratify"],
    "reject_proposal": ["wis.context.ratify"],
}

# WP-0.2: clasificación read/write por NOMBRE de tool, no por sufijo de scope.
# ratify_proposal/reject_proposal usan scope .ratify pero MUTAN canon (son writes);
# preview_write_impact usa scope .write pero es de solo lectura.
WRITE_TOOL_NAMES: set[str] = {
    "upsert_context_item",
    "append_context_event",
    "link_context_entities",
    "set_context_labels",
    "archive_context_item",
    "apply_sync_batch",
    "propose_change",
    "ratify_proposal",
    "reject_proposal",
}

RESOURCE_SCOPES_SUPPORTED = [
    "wis.context.read",
    "wis.context.sync.read",
    "wis.context.write",
    "wis.context.sync.write",
    "wis.context.ratify",
]


def _auth_runtime_enabled() -> bool:
    return settings.mcp_auth_enabled and not settings.mcp_auth_bypass_local


def _is_write_tool(tool_name: str) -> bool:
    return tool_name in WRITE_TOOL_NAMES


def _tool_security_schemes(scopes: list[str]) -> list[dict[str, Any]]:
    if not _auth_runtime_enabled():
        return [{"type": "noauth"}]
    return [{"type": "oauth2", "scopes": scopes}]


def _resource_metadata_url() -> str | None:
    if not _auth_runtime_enabled() or not settings.mcp_public_base_url:
        return None
    try:
        return str(build_resource_metadata_url(settings.mcp_public_base_url))
    except Exception:  # pragma: no cover - defensive fallback
        return None


def _effective_resource_id() -> str | None:
    return settings.effective_mcp_resource_id


def _protected_resource_metadata_payload() -> dict[str, Any]:
    issuer = settings.mcp_auth0_issuer.rstrip("/") + "/" if settings.mcp_auth0_issuer else None
    return {
        "resource": _effective_resource_id(),
        "authorization_servers": [issuer] if issuer else [],
        "scopes_supported": RESOURCE_SCOPES_SUPPORTED,
        "bearer_methods_supported": ["header"],
    }


async def _protected_resource_metadata_endpoint(_request: Request) -> Response:
    return JSONResponse(_protected_resource_metadata_payload())


def _build_www_authenticate(
    *,
    error: str,
    description: str,
    required_scopes: list[str] | None = None,
) -> str:
    parts = [f'error="{error}"', f'error_description="{description}"']
    if required_scopes:
        parts.append(f'scope="{" ".join(required_scopes)}"')
    metadata_url = _resource_metadata_url()
    if metadata_url:
        parts.append(f'resource_metadata="{metadata_url}"')
    return f"Bearer {', '.join(parts)}"


def _auth_error_meta(*, error: str, description: str, required_scopes: list[str] | None = None) -> dict[str, Any]:
    return {
        "mcp/www_authenticate": _build_www_authenticate(
            error=error,
            description=description,
            required_scopes=required_scopes,
        ),
    }


def _build_mcp_server() -> FastMCP:
    auth_settings: AuthSettings | None = None
    token_verifier = None
    instructions = "Context server with read/write planes and scope guards."

    if _auth_runtime_enabled():
        if not settings.mcp_auth0_issuer or not settings.mcp_auth0_audience or not settings.mcp_auth0_jwks_url:
            raise RuntimeError(
                "MCP auth is enabled but MCP_AUTH0_ISSUER/MCP_AUTH0_AUDIENCE/MCP_AUTH0_JWKS_URL are not fully configured.",
            )
        if not settings.mcp_public_base_url:
            raise RuntimeError(
                "MCP auth is enabled but MCP_PUBLIC_BASE_URL is not configured.",
            )
        auth_settings = AuthSettings(
            issuer_url=settings.mcp_auth0_issuer,
            resource_server_url=settings.mcp_public_base_url,
            required_scopes=["wis.context.read"],
        )
        token_verifier = Auth0JWTTokenVerifier(
            issuer=settings.mcp_auth0_issuer,
            audience=settings.mcp_auth0_audience,
            jwks_url=settings.mcp_auth0_jwks_url,
            resource_id=_effective_resource_id(),
            clock_skew_seconds=max(settings.mcp_auth_clock_skew_seconds, 0),
        )
        instructions = "OAuth-protected context server with read/write planes and scope guards."

    return FastMCP(
        name="WIS Context Sync MCP",
        instructions=instructions,
        host=settings.mcp_bind_host,
        port=settings.mcp_port,
        streamable_http_path="/mcp",
        auth=auth_settings,
        token_verifier=token_verifier,
    )


mcp = _build_mcp_server()
if settings.has_legacy_resource_id_divergence:
    mcp_logger.emit(
        "mcp_auth_legacy_resource_id_divergence",
        level="WARNING",
        auth_stage="startup",
        mcp_resource_id=settings.mcp_resource_id,
        mcp_auth0_audience=settings.mcp_auth0_audience,
        message=(
            "MCP_RESOURCE_ID differs from MCP_AUTH0_AUDIENCE; keeping legacy-compatible mode "
            "without blocking startup."
        ),
    )


def _task_to_dict(task: Any) -> dict[str, Any]:
    return {
        "id": str(task.id),
        "workspace_id": str(task.workspace_id),
        "project_id": str(task.project_id),
        "title": task.title,
        "goal": task.goal,
        "status": task.status,
        "priority": task.priority,
        "repo": task.repo,
        "branch": task.branch,
        "next_action": task.next_action,
        "current_phase": task.current_phase,
        "is_active": task.is_active,
        "created_at": task.created_at.isoformat() if task.created_at else None,
        "updated_at": task.updated_at.isoformat() if task.updated_at else None,
    }


def _decision_to_dict(decision: Any) -> dict[str, Any]:
    return {
        "id": str(decision.id),
        "workspace_id": str(decision.workspace_id),
        "project_id": str(decision.project_id) if decision.project_id else None,
        "task_id": str(decision.task_id) if decision.task_id else None,
        "decision_key": decision.decision_key,
        "title": decision.title,
        "category": decision.category,
        "decision": decision.decision,
        "rationale": decision.rationale,
        "constraints": decision.constraints_json,
        "approved_at": decision.approved_at.isoformat() if decision.approved_at else None,
        "is_active": decision.is_active,
        "updated_at": decision.updated_at.isoformat() if decision.updated_at else None,
    }


def _event_to_dict(event: Any) -> dict[str, Any]:
    return {
        "id": str(event.id),
        "workspace_id": str(event.workspace_id),
        "project_id": str(event.project_id),
        "task_id": str(event.task_id),
        "event_type": event.event_type,
        "created_at": event.created_at.isoformat() if event.created_at else None,
        "summary": event.summary,
        "source": event.source,
        "severity": event.severity,
        "payload": event.payload_json,
    }


def _validation_to_dict(validation: ValidationRun | None) -> dict[str, Any]:
    if validation is None:
        return {
            "status": "unknown",
            "type": None,
            "source": None,
            "executed_at": None,
        }
    return {
        "status": validation.status,
        "type": validation.validation_type,
        "source": validation.source,
        "executed_at": validation.executed_at.isoformat() if validation.executed_at else None,
    }


def _runtime_request_context_fields() -> dict[str, Any]:
    try:
        ctx = mcp.get_context()
        request_context = ctx.request_context
    except Exception:
        return {}

    request = getattr(request_context, "request", None)
    headers = getattr(request, "headers", None) if request is not None else None
    mcp_session_id = headers.get("mcp-session-id") if headers else None
    user_agent = headers.get("user-agent") if headers else None
    path = request.url.path if request is not None else None
    method = request.method if request is not None else None

    return {
        "request_id": str(ctx.request_id),
        "mcp_session_id": mcp_session_id,
        "user_agent": user_agent,
        "path": path,
        "method": method,
    }


def _auth_context_fields(token: Any | None) -> dict[str, Any]:
    if token is None:
        return {
            "auth_present": False,
            "scopes": [],
            "issuer": None,
            "audience": None,
            "sub": None,
            "azp": None,
        }

    claims = decode_unverified_claims(token.token)
    sanitized_claims = sanitize_auth_claims(claims)
    return {
        "auth_present": True,
        "scopes": sorted(set(token.scopes or [])),
        "issuer": sanitized_claims.get("iss"),
        "audience": sanitized_claims.get("aud"),
        "sub": sanitized_claims.get("sub"),
        "azp": sanitized_claims.get("azp") or sanitized_claims.get("client_id"),
    }


def _scope_guard(tool_name: str) -> dict[str, Any] | None:
    required = TOOL_SCOPES.get(tool_name, [])
    if not required:
        return None
    # For direct local invocations (tests/scripts) bypass can be explicit.
    if settings.mcp_auth_bypass_local:
        mcp_logger.emit(
            "mcp_scope_guard_evaluated",
            tool_name=tool_name,
            required_scopes=required,
            present_scopes=[],
            missing_scopes=[],
            outcome="allowed",
            auth_stage="tool_runtime",
            bypass_local=True,
            **_runtime_request_context_fields(),
        )
        return None
    token = get_access_token()
    if token is None:
        mcp_logger.emit(
            "mcp_auth_missing",
            level="WARNING",
            tool_name=tool_name,
            required_scopes=required,
            present_scopes=[],
            missing_scopes=required,
            outcome="unauthorized",
            auth_stage="tool_runtime",
            **_runtime_request_context_fields(),
            **_auth_context_fields(token),
        )
        return {
            "status": "unauthorized",
            "error": "invalid_token",
            "message": "Authentication required for this tool.",
            "required_scopes": required,
            "present_scopes": [],
            "_meta": _auth_error_meta(
                error="invalid_token",
                description="Authentication required for this tool.",
                required_scopes=required,
            ),
        }
    present = sorted(set(token.scopes))
    missing = [scope for scope in required if scope not in present]
    if missing:
        mcp_logger.emit(
            "mcp_auth_scope_denied",
            level="WARNING",
            tool_name=tool_name,
            required_scopes=required,
            present_scopes=present,
            missing_scopes=missing,
            outcome="forbidden",
            auth_stage="tool_runtime",
            **_runtime_request_context_fields(),
            **_auth_context_fields(token),
        )
        return {
            "status": "forbidden",
            "error": "insufficient_scope",
            "message": "Token does not include required scopes for this tool.",
            "required_scopes": required,
            "present_scopes": present,
            "missing_scopes": missing,
            "_meta": _auth_error_meta(
                error="insufficient_scope",
                description="Token does not include required scopes for this tool.",
                required_scopes=required,
            ),
        }
    mcp_logger.emit(
        "mcp_scope_guard_evaluated",
        tool_name=tool_name,
        required_scopes=required,
        present_scopes=present,
        missing_scopes=[],
        outcome="allowed",
        auth_stage="tool_runtime",
        **_runtime_request_context_fields(),
        **_auth_context_fields(token),
    )
    return None


def _apply_policy_and_audit(
    db: Any,
    tool_name: str,
    task_id: Any,
    payload: dict[str, Any],
) -> dict[str, Any]:
    filtered, included, redacted = apply_delegated_limited_policy(tool_name, payload)
    record_publish_audit(
        db=db,
        task_id=task_id,
        destination="chatgpt_developer_mode",
        package_type=tool_name,
        fields_included=included,
        fields_redacted=redacted,
        result="delivered",
    )
    return filtered


def _scope_error_payload(resolved: ResolvedScope) -> dict[str, Any]:
    return {
        "status": resolved.status,
        "scope": resolved.scope_payload(),
        "resolution_metadata": resolved.resolution_metadata,
    }


def _resolve_scope_or_error(
    db: Any,
    *,
    workspace_id: str | None,
    project_id: str | None,
    task_id: str | None,
    consumer: str | None,
    session_key: str | None,
) -> tuple[ResolvedScope, dict[str, Any] | None]:
    resolved = resolve_scope(
        db,
        workspace_id=workspace_id,
        project_id=project_id,
        task_id=task_id,
        consumer=consumer,
        session_key=session_key,
    )
    if not resolved.is_ok:
        return resolved, _scope_error_payload(resolved)
    if resolved.task is None:
        return resolved, {
            "status": "no_active_task",
            "scope": resolved.scope_payload(),
            "resolution_metadata": resolved.resolution_metadata,
        }
    return resolved, None


@mcp.tool(
    description="Get active task context. Use this when you need the current canonical task state."
)
def get_active_task(
    workspace_id: str | None = None,
    project_id: str | None = None,
    task_id: str | None = None,
    consumer: str | None = None,
    session_key: str | None = None,
) -> dict[str, Any]:
    db = SessionLocal()
    try:
        resolved, error_payload = _resolve_scope_or_error(
            db,
            workspace_id=workspace_id,
            project_id=project_id,
            task_id=task_id,
            consumer=consumer,
            session_key=session_key,
        )
        if error_payload:
            return error_payload
        scope_issue = _scope_guard("get_active_task")
        if scope_issue:
            scope_issue["scope"] = resolved.scope_payload()
            scope_issue["resolution_metadata"] = resolved.resolution_metadata
            return scope_issue

        task = resolved.task
        latest_snapshot: ContextSnapshot | None = get_latest_snapshot_for_task(db, task.id)
        latest_validation = get_latest_validation_run_for_scope(
            db,
            workspace_id=resolved.workspace.id,
            project_id=resolved.project.id,
            task_id=task.id,
        )
        task_payload = _task_to_dict(task)
        task_payload["last_snapshot_at"] = latest_snapshot.created_at.isoformat() if latest_snapshot else None
        task_payload["last_validation_status"] = _validation_to_dict(latest_validation)["status"]

        payload = {
            "status": "ok",
            "task": task_payload,
            "mode": settings.system_mode,
            "scope": resolved.scope_payload(),
            "resolution_metadata": resolved.resolution_metadata,
        }
        return _apply_policy_and_audit(db, "get_active_task", task.id, payload)
    finally:
        db.close()


@mcp.tool(
    description="Get latest context snapshot. Use this when you need the latest packaged operational context."
)
def get_context_snapshot(
    workspace_id: str | None = None,
    project_id: str | None = None,
    task_id: str | None = None,
    consumer: str | None = None,
    session_key: str | None = None,
) -> dict[str, Any]:
    db = SessionLocal()
    try:
        resolved, error_payload = _resolve_scope_or_error(
            db,
            workspace_id=workspace_id,
            project_id=project_id,
            task_id=task_id,
            consumer=consumer,
            session_key=session_key,
        )
        if error_payload:
            return error_payload
        scope_issue = _scope_guard("get_context_snapshot")
        if scope_issue:
            scope_issue["scope"] = resolved.scope_payload()
            scope_issue["resolution_metadata"] = resolved.resolution_metadata
            return scope_issue

        task = resolved.task
        snapshot = get_latest_snapshot_for_task(db, task.id)
        if snapshot and isinstance(snapshot.snapshot_content, dict) and "identity" in snapshot.snapshot_content:
            snapshot_content = dict(snapshot.snapshot_content)
            snapshot_content.setdefault("scope", resolved.scope_payload())
            snapshot_content.setdefault("consumer_context", resolved.consumer_payload())
            snapshot_content.setdefault("resolution_metadata", resolved.resolution_metadata)
            source = "database"
            snapshot_created_at = snapshot.created_at.isoformat() if snapshot.created_at else None
            generated_from = snapshot.generated_from
        else:
            snapshot_content = build_operational_snapshot(
                db,
                task,
                policy_mode=settings.system_mode,
                workspace_id=resolved.workspace.id,
                project_id=resolved.project.id,
                consumer_context=resolved.consumer_payload(),
                resolution_metadata=resolved.resolution_metadata,
            )
            source = "derived_runtime"
            snapshot_created_at = snapshot_content["metadata"]["generated_at"]
            generated_from = "derived_runtime"

        payload = {
            "task_id": str(task.id),
            "status": "ok",
            "source": source,
            "scope": resolved.scope_payload(),
            "consumer_context": resolved.consumer_payload(),
            "resolution_metadata": resolved.resolution_metadata,
            "snapshot": snapshot_content,
            "metadata": {
                "policy": settings.system_mode,
                "origin": generated_from,
                "created_at": snapshot_created_at,
            },
        }
        return _apply_policy_and_audit(db, "get_context_snapshot", task.id, payload)
    finally:
        db.close()


@mcp.tool(
    description="Get recent errors. Use this when diagnosing current failures from the active task timeline."
)
def get_recent_errors(
    limit: int = 20,
    window_hours: int = 24,
    workspace_id: str | None = None,
    project_id: str | None = None,
    task_id: str | None = None,
    consumer: str | None = None,
    session_key: str | None = None,
) -> dict[str, Any]:
    db = SessionLocal()
    try:
        resolved, error_payload = _resolve_scope_or_error(
            db,
            workspace_id=workspace_id,
            project_id=project_id,
            task_id=task_id,
            consumer=consumer,
            session_key=session_key,
        )
        if error_payload:
            return error_payload
        scope_issue = _scope_guard("get_recent_errors")
        if scope_issue:
            scope_issue["scope"] = resolved.scope_payload()
            scope_issue["resolution_metadata"] = resolved.resolution_metadata
            return scope_issue

        task = resolved.task
        errors = list_recent_errors_for_task(db, task.id, limit=limit, window_hours=window_hours)
        payload = {
            "status": "ok",
            "task_id": str(task.id),
            "scope": resolved.scope_payload(),
            "resolution_metadata": resolved.resolution_metadata,
            "window_hours": window_hours,
            "limit": limit,
            "total": len(errors),
            "errors": [_event_to_dict(event) for event in errors],
        }
        return _apply_policy_and_audit(db, "get_recent_errors", task.id, payload)
    finally:
        db.close()


@mcp.tool(
    description="Get validation status. Use this when checking latest validation result for the resolved scope."
)
def get_validation_status(
    workspace_id: str | None = None,
    project_id: str | None = None,
    task_id: str | None = None,
    consumer: str | None = None,
    session_key: str | None = None,
) -> dict[str, Any]:
    db = SessionLocal()
    try:
        resolved, error_payload = _resolve_scope_or_error(
            db,
            workspace_id=workspace_id,
            project_id=project_id,
            task_id=task_id,
            consumer=consumer,
            session_key=session_key,
        )
        if error_payload:
            return error_payload
        scope_issue = _scope_guard("get_validation_status")
        if scope_issue:
            scope_issue["scope"] = resolved.scope_payload()
            scope_issue["resolution_metadata"] = resolved.resolution_metadata
            return scope_issue

        task = resolved.task
        latest_validation = get_latest_validation_run_for_scope(
            db,
            workspace_id=resolved.workspace.id,
            project_id=resolved.project.id,
            task_id=task.id,
        )
        if latest_validation is None:
            payload = {
                "status": "ok",
                "task_id": str(task.id),
                "scope": resolved.scope_payload(),
                "resolution_metadata": resolved.resolution_metadata,
                "current_status": "unknown",
                "last_validation_type": None,
                "last_validation_source": None,
                "last_validation_at": None,
                "summary": "No validation run available.",
                "details": {},
            }
        else:
            payload = {
                "status": "ok",
                "task_id": str(task.id),
                "scope": resolved.scope_payload(),
                "resolution_metadata": resolved.resolution_metadata,
                "current_status": latest_validation.status,
                "last_validation_type": latest_validation.validation_type,
                "last_validation_source": latest_validation.source,
                "last_validation_at": latest_validation.executed_at.isoformat(),
                "summary": latest_validation.summary,
                "details": latest_validation.details,
            }
        return _apply_policy_and_audit(db, "get_validation_status", task.id, payload)
    finally:
        db.close()


@mcp.tool(
    description="Get approved decisions. Use this when you need active approved constraints or decisions for the resolved scope."
)
def get_approved_decisions(
    workspace_id: str | None = None,
    project_id: str | None = None,
    task_id: str | None = None,
    consumer: str | None = None,
    session_key: str | None = None,
) -> dict[str, Any]:
    db = SessionLocal()
    try:
        resolved, error_payload = _resolve_scope_or_error(
            db,
            workspace_id=workspace_id,
            project_id=project_id,
            task_id=task_id,
            consumer=consumer,
            session_key=session_key,
        )
        if error_payload:
            return error_payload
        scope_issue = _scope_guard("get_approved_decisions")
        if scope_issue:
            scope_issue["scope"] = resolved.scope_payload()
            scope_issue["resolution_metadata"] = resolved.resolution_metadata
            return scope_issue

        task = resolved.task
        decisions = list_active_decisions_for_scope(
            db,
            workspace_id=resolved.workspace.id,
            project_id=resolved.project.id,
            task_id=task.id,
        )
        payload = {
            "status": "ok",
            "task_id": str(task.id),
            "scope": resolved.scope_payload(),
            "resolution_metadata": resolved.resolution_metadata,
            "total": len(decisions),
            "decisions": [_decision_to_dict(decision) for decision in decisions],
        }
        return _apply_policy_and_audit(db, "get_approved_decisions", task.id, payload)
    finally:
        db.close()


@mcp.tool(
    description="Search context items using current scope. Read plane."
)
def search_context(
    query: str | None = None,
    item_type: str | None = None,
    status: str | None = "active",
    limit: int = 20,
    offset: int = 0,
    workspace_id: str | None = None,
    project_id: str | None = None,
    task_id: str | None = None,
    consumer: str | None = None,
    session_key: str | None = None,
) -> dict[str, Any]:
    db = SessionLocal()
    try:
        resolved, error_payload = _resolve_scope_or_error(
            db,
            workspace_id=workspace_id,
            project_id=project_id,
            task_id=task_id,
            consumer=consumer,
            session_key=session_key,
        )
        if error_payload:
            return error_payload
        scope_issue = _scope_guard("search_context")
        if scope_issue:
            scope_issue["scope"] = resolved.scope_payload()
            scope_issue["resolution_metadata"] = resolved.resolution_metadata
            return scope_issue
        rows = search_context_items_service(
            db,
            workspace_id=resolved.workspace.id,
            project_id=resolved.project.id if resolved.project else None,
            task_id=resolved.task.id if resolved.task else None,
            query=query,
            item_type=item_type,
            status=status,
            limit=limit,
            offset=offset,
        )
        payload = {
            "status": "ok",
            "scope": resolved.scope_payload(),
            "resolution_metadata": resolved.resolution_metadata,
            "query": query,
            "total": len(rows),
            "limit": limit,
            "offset": offset,
            "items": [context_item_to_dict(row) for row in rows],
        }
        return _apply_policy_and_audit(db, "search_context", resolved.task.id, payload)
    finally:
        db.close()


@mcp.tool(
    description="Get a context item by identifier. Read plane."
)
def get_context_by_id(
    context_item_id: str,
    workspace_id: str | None = None,
    project_id: str | None = None,
    task_id: str | None = None,
    consumer: str | None = None,
    session_key: str | None = None,
) -> dict[str, Any]:
    db = SessionLocal()
    try:
        resolved, error_payload = _resolve_scope_or_error(
            db,
            workspace_id=workspace_id,
            project_id=project_id,
            task_id=task_id,
            consumer=consumer,
            session_key=session_key,
        )
        if error_payload:
            return error_payload
        scope_issue = _scope_guard("get_context_by_id")
        if scope_issue:
            scope_issue["scope"] = resolved.scope_payload()
            scope_issue["resolution_metadata"] = resolved.resolution_metadata
            return scope_issue
        try:
            item_uuid = uuid.UUID(context_item_id)
        except ValueError:
            return _invalid_request(
                "context_item_id debe ser UUID válido.",
                resolved.scope_payload(),
                resolved.resolution_metadata,
                context_item_id=context_item_id,
            )
        item = get_context_item_by_id_service(
            db,
            workspace_id=resolved.workspace.id,
            item_id=item_uuid,
        )
        payload = {
            "status": "ok" if item else "not_found",
            "scope": resolved.scope_payload(),
            "resolution_metadata": resolved.resolution_metadata,
            "context_item_id": context_item_id,
            "item": context_item_to_dict(item) if item else None,
        }
        return _apply_policy_and_audit(db, "get_context_by_id", resolved.task.id, payload)
    finally:
        db.close()


@mcp.tool(
    description="List context windows and short activity summary. Read plane."
)
def list_context_windows(
    window_hours: int = 24,
    limit: int = 20,
    workspace_id: str | None = None,
    project_id: str | None = None,
    task_id: str | None = None,
    consumer: str | None = None,
    session_key: str | None = None,
) -> dict[str, Any]:
    db = SessionLocal()
    try:
        resolved, error_payload = _resolve_scope_or_error(
            db,
            workspace_id=workspace_id,
            project_id=project_id,
            task_id=task_id,
            consumer=consumer,
            session_key=session_key,
        )
        if error_payload:
            return error_payload
        scope_issue = _scope_guard("list_context_windows")
        if scope_issue:
            scope_issue["scope"] = resolved.scope_payload()
            scope_issue["resolution_metadata"] = resolved.resolution_metadata
            return scope_issue
        window = list_context_windows_service(
            db,
            workspace_id=resolved.workspace.id,
            project_id=resolved.project.id if resolved.project else None,
            task_id=resolved.task.id if resolved.task else None,
            window_hours=window_hours,
            limit=limit,
        )
        payload = {
            "status": "ok",
            "scope": resolved.scope_payload(),
            "resolution_metadata": resolved.resolution_metadata,
            **window,
        }
        return _apply_policy_and_audit(db, "list_context_windows", resolved.task.id, payload)
    finally:
        db.close()


@mcp.tool(
    description="Resolve related context entities for a context item. Read plane."
)
def resolve_related_items(
    context_item_id: str,
    limit: int = 20,
    workspace_id: str | None = None,
    project_id: str | None = None,
    task_id: str | None = None,
    consumer: str | None = None,
    session_key: str | None = None,
) -> dict[str, Any]:
    db = SessionLocal()
    try:
        resolved, error_payload = _resolve_scope_or_error(
            db,
            workspace_id=workspace_id,
            project_id=project_id,
            task_id=task_id,
            consumer=consumer,
            session_key=session_key,
        )
        if error_payload:
            return error_payload
        scope_issue = _scope_guard("resolve_related_items")
        if scope_issue:
            scope_issue["scope"] = resolved.scope_payload()
            scope_issue["resolution_metadata"] = resolved.resolution_metadata
            return scope_issue
        try:
            item_uuid = uuid.UUID(context_item_id)
        except ValueError:
            return _invalid_request(
                "context_item_id debe ser UUID válido.",
                resolved.scope_payload(),
                resolved.resolution_metadata,
                context_item_id=context_item_id,
            )
        related = resolve_related_items_service(
            db,
            workspace_id=resolved.workspace.id,
            item_id=item_uuid,
            limit=limit,
        )
        payload = {
            "status": "ok",
            "scope": resolved.scope_payload(),
            "resolution_metadata": resolved.resolution_metadata,
            "context_item_id": context_item_id,
            "total": len(related),
            "related": related,
        }
        return _apply_policy_and_audit(db, "resolve_related_items", resolved.task.id, payload)
    finally:
        db.close()


@mcp.tool(
    description="Get sync status for recent context sync batches. Read plane."
)
def get_sync_status(
    limit: int = 20,
    workspace_id: str | None = None,
    project_id: str | None = None,
    task_id: str | None = None,
    consumer: str | None = None,
    session_key: str | None = None,
) -> dict[str, Any]:
    db = SessionLocal()
    try:
        resolved, error_payload = _resolve_scope_or_error(
            db,
            workspace_id=workspace_id,
            project_id=project_id,
            task_id=task_id,
            consumer=consumer,
            session_key=session_key,
        )
        if error_payload:
            return error_payload
        scope_issue = _scope_guard("get_sync_status")
        if scope_issue:
            scope_issue["scope"] = resolved.scope_payload()
            scope_issue["resolution_metadata"] = resolved.resolution_metadata
            return scope_issue
        batches = get_sync_status_service(
            db,
            workspace_id=resolved.workspace.id,
            project_id=resolved.project.id if resolved.project else None,
            task_id=resolved.task.id if resolved.task else None,
            limit=limit,
        )
        payload = {
            "status": "ok",
            "scope": resolved.scope_payload(),
            "resolution_metadata": resolved.resolution_metadata,
            "total": len(batches),
            "batches": batches,
        }
        return _apply_policy_and_audit(db, "get_sync_status", resolved.task.id, payload)
    finally:
        db.close()


@mcp.tool(
    description="Preview write impact for a mutation operation without committing changes."
)
def preview_write_impact(
    operation: str,
    payload: dict[str, Any] | None = None,
    workspace_id: str | None = None,
    project_id: str | None = None,
    task_id: str | None = None,
    consumer: str | None = None,
    session_key: str | None = None,
) -> dict[str, Any]:
    db = SessionLocal()
    try:
        resolved, error_payload = _resolve_scope_or_error(
            db,
            workspace_id=workspace_id,
            project_id=project_id,
            task_id=task_id,
            consumer=consumer,
            session_key=session_key,
        )
        if error_payload:
            return error_payload
        scope_issue = _scope_guard("preview_write_impact")
        if scope_issue:
            scope_issue["scope"] = resolved.scope_payload()
            scope_issue["resolution_metadata"] = resolved.resolution_metadata
            return scope_issue
        safe_payload = payload or {}
        estimated = {
            "operation": operation,
            "dry_run": True,
            "estimated_writes": 1 if operation in {"upsert_context_item", "append_context_event", "archive_context_item"} else 0,
            "preview_item_key": safe_payload.get("item_key") or make_preview_item_key(),
            "payload_keys": sorted(safe_payload.keys()),
        }
        response = {
            "status": "ok",
            "scope": resolved.scope_payload(),
            "resolution_metadata": resolved.resolution_metadata,
            "operation": operation,
            "dry_run": True,
            "impact": estimated,
            "requires_scopes": TOOL_SCOPES.get(operation, []),
        }
        return _apply_policy_and_audit(db, "preview_write_impact", resolved.task.id, response)
    finally:
        db.close()


@mcp.tool(
    description="Create or update a context item. Write plane with dry_run support."
)
def upsert_context_item(
    item_key: str,
    item_type: str,
    title: str,
    content: dict[str, Any] | None = None,
    labels: list[str] | None = None,
    expected_version: int | None = None,
    dry_run: bool = True,
    idempotency_key: str | None = None,
    workspace_id: str | None = None,
    project_id: str | None = None,
    task_id: str | None = None,
    consumer: str | None = None,
    session_key: str | None = None,
) -> dict[str, Any]:
    db = SessionLocal()
    try:
        resolved, error_payload = _resolve_scope_or_error(
            db,
            workspace_id=workspace_id,
            project_id=project_id,
            task_id=task_id,
            consumer=consumer,
            session_key=session_key,
        )
        if error_payload:
            return error_payload
        scope_issue = _scope_guard("upsert_context_item")
        if scope_issue:
            scope_issue["scope"] = resolved.scope_payload()
            scope_issue["resolution_metadata"] = resolved.resolution_metadata
            return scope_issue
        def _apply(db, request_id):
            result = upsert_context_item_service(
                db,
                workspace_id=resolved.workspace.id,
                project_id=resolved.project.id if resolved.project else None,
                task_id=resolved.task.id if resolved.task else None,
                item_key=item_key,
                item_type=item_type,
                title=title,
                content=content,
                labels=labels,
                expected_version=expected_version,
                actor=cast(str, _extract_actor_context()["actor_sub"]),
                dry_run=dry_run,
            )
            after = result.get("after")
            return WriteOutcome(
                result=str(result["result"]),
                subject_id=after.get("id") if isinstance(after, dict) else None,
                before_payload=result.get("before"),
                after_payload=after,
                extra={"before": result.get("before"), "after": after},
            )

        return run_governed_write(
            db,
            tool_name="upsert_context_item",
            resolved=resolved,
            dry_run=dry_run,
            idempotency_key=idempotency_key,
            ratification=RatificationSpec("context_item", item_key, item_type),
            apply_fn=_apply,
        )
    finally:
        db.close()


@mcp.tool(
    description="Append a context event for current task. Write plane with dry_run support."
)
def append_context_event(
    event_type: str,
    summary: str,
    source: str = "mcp",
    severity: str = "info",
    metadata_json: dict[str, Any] | None = None,
    dry_run: bool = True,
    idempotency_key: str | None = None,
    workspace_id: str | None = None,
    project_id: str | None = None,
    task_id: str | None = None,
    consumer: str | None = None,
    session_key: str | None = None,
) -> dict[str, Any]:
    db = SessionLocal()
    try:
        resolved, error_payload = _resolve_scope_or_error(
            db,
            workspace_id=workspace_id,
            project_id=project_id,
            task_id=task_id,
            consumer=consumer,
            session_key=session_key,
        )
        if error_payload:
            return error_payload
        scope_issue = _scope_guard("append_context_event")
        if scope_issue:
            scope_issue["scope"] = resolved.scope_payload()
            scope_issue["resolution_metadata"] = resolved.resolution_metadata
            return scope_issue
        def _apply(db, request_id):
            if dry_run:
                after = {
                    "event_type": event_type,
                    "summary": summary,
                    "source": source,
                    "severity": severity,
                    "metadata": metadata_json or {},
                }
                return WriteOutcome(
                    result="dry_run",
                    subject_id=None,
                    before_payload={"event": None},
                    after_payload=after,
                    extra={"event": after},
                )
            created = create_event_for_task(
                db,
                resolved.task.id,
                EventCreate(
                    event_type=event_type,
                    summary=summary,
                    source=source,
                    severity=severity,
                    metadata_json=metadata_json or {},
                ),
                consumer_id=resolved.consumer.id if resolved.consumer else None,
            )
            after = _event_to_dict(created)
            return WriteOutcome(
                result="created",
                subject_id=after["id"],
                before_payload={"event": None},
                after_payload=after,
                extra={"event": after},
            )

        return run_governed_write(
            db,
            tool_name="append_context_event",
            resolved=resolved,
            dry_run=dry_run,
            idempotency_key=idempotency_key,
            ratification=RatificationSpec("context_item", f"event:{event_type}", None),
            apply_fn=_apply,
        )
    finally:
        db.close()


@mcp.tool(
    description="Create or update relation between context entities. Write plane."
)
def link_context_entities(
    source_item_id: str,
    target_item_id: str,
    relation: str,
    metadata: dict[str, Any] | None = None,
    dry_run: bool = True,
    idempotency_key: str | None = None,
    workspace_id: str | None = None,
    project_id: str | None = None,
    task_id: str | None = None,
    consumer: str | None = None,
    session_key: str | None = None,
) -> dict[str, Any]:
    db = SessionLocal()
    try:
        resolved, error_payload = _resolve_scope_or_error(
            db,
            workspace_id=workspace_id,
            project_id=project_id,
            task_id=task_id,
            consumer=consumer,
            session_key=session_key,
        )
        if error_payload:
            return error_payload
        scope_issue = _scope_guard("link_context_entities")
        if scope_issue:
            scope_issue["scope"] = resolved.scope_payload()
            scope_issue["resolution_metadata"] = resolved.resolution_metadata
            return scope_issue
        def _apply(db, request_id):
            try:
                source_uuid = uuid.UUID(source_item_id)
                target_uuid = uuid.UUID(target_item_id)
            except ValueError:
                return _invalid_request(
                    "source_item_id y target_item_id deben ser UUID válidos.",
                    resolved.scope_payload(),
                    resolved.resolution_metadata,
                )
            result = link_context_entities_service(
                db,
                workspace_id=resolved.workspace.id,
                source_item_id=source_uuid,
                target_item_id=target_uuid,
                relation=relation,
                metadata=metadata,
                actor=cast(str, _extract_actor_context()["actor_sub"]),
                dry_run=dry_run,
            )
            return WriteOutcome(
                result=str(result["result"]),
                subject_id=source_item_id,
                before_payload=result.get("before"),
                after_payload=result.get("after"),
                extra={"before": result.get("before"), "after": result.get("after")},
            )

        return run_governed_write(
            db,
            tool_name="link_context_entities",
            resolved=resolved,
            dry_run=dry_run,
            idempotency_key=idempotency_key,
            ratification=RatificationSpec("context_item", source_item_id, None),
            apply_fn=_apply,
        )
    finally:
        db.close()


@mcp.tool(
    description="Set labels for a context item. Write plane."
)
def set_context_labels(
    context_item_id: str,
    labels: list[str],
    dry_run: bool = True,
    idempotency_key: str | None = None,
    workspace_id: str | None = None,
    project_id: str | None = None,
    task_id: str | None = None,
    consumer: str | None = None,
    session_key: str | None = None,
) -> dict[str, Any]:
    db = SessionLocal()
    try:
        resolved, error_payload = _resolve_scope_or_error(
            db,
            workspace_id=workspace_id,
            project_id=project_id,
            task_id=task_id,
            consumer=consumer,
            session_key=session_key,
        )
        if error_payload:
            return error_payload
        scope_issue = _scope_guard("set_context_labels")
        if scope_issue:
            scope_issue["scope"] = resolved.scope_payload()
            scope_issue["resolution_metadata"] = resolved.resolution_metadata
            return scope_issue
        parsed: dict[str, Any] = {}

        def _pre():
            try:
                parsed["item_uuid"] = uuid.UUID(context_item_id)
            except ValueError:
                return _invalid_request(
                    "context_item_id debe ser UUID válido.",
                    resolved.scope_payload(),
                    resolved.resolution_metadata,
                )
            return None

        def _apply(db, request_id):
            result = append_context_labels_service(
                db,
                workspace_id=resolved.workspace.id,
                item_id=parsed["item_uuid"],
                labels=labels,
                actor=cast(str, _extract_actor_context()["actor_sub"]),
                dry_run=dry_run,
            )
            return WriteOutcome(
                result=str(result["result"]),
                subject_id=context_item_id,
                before_payload=result.get("before"),
                after_payload=result.get("after"),
                extra={"before": result.get("before"), "after": result.get("after")},
            )

        return run_governed_write(
            db,
            tool_name="set_context_labels",
            resolved=resolved,
            dry_run=dry_run,
            idempotency_key=idempotency_key,
            ratification=RatificationSpec("context_item", context_item_id, None),
            apply_fn=_apply,
            pre_ratification_fn=_pre,
        )
    finally:
        db.close()


@mcp.tool(
    description="Archive a context item. Write plane."
)
def archive_context_item(
    context_item_id: str,
    dry_run: bool = True,
    idempotency_key: str | None = None,
    workspace_id: str | None = None,
    project_id: str | None = None,
    task_id: str | None = None,
    consumer: str | None = None,
    session_key: str | None = None,
) -> dict[str, Any]:
    db = SessionLocal()
    try:
        resolved, error_payload = _resolve_scope_or_error(
            db,
            workspace_id=workspace_id,
            project_id=project_id,
            task_id=task_id,
            consumer=consumer,
            session_key=session_key,
        )
        if error_payload:
            return error_payload
        scope_issue = _scope_guard("archive_context_item")
        if scope_issue:
            scope_issue["scope"] = resolved.scope_payload()
            scope_issue["resolution_metadata"] = resolved.resolution_metadata
            return scope_issue
        parsed: dict[str, Any] = {}

        def _pre():
            try:
                parsed["item_uuid"] = uuid.UUID(context_item_id)
            except ValueError:
                return _invalid_request(
                    "context_item_id debe ser UUID válido.",
                    resolved.scope_payload(),
                    resolved.resolution_metadata,
                )
            return None

        def _apply(db, request_id):
            result = archive_context_item_service(
                db,
                workspace_id=resolved.workspace.id,
                item_id=parsed["item_uuid"],
                actor=cast(str, _extract_actor_context()["actor_sub"]),
                dry_run=dry_run,
            )
            return WriteOutcome(
                result=str(result["result"]),
                subject_id=context_item_id,
                before_payload=result.get("before"),
                after_payload=result.get("after"),
                extra={"before": result.get("before"), "after": result.get("after")},
            )

        return run_governed_write(
            db,
            tool_name="archive_context_item",
            resolved=resolved,
            dry_run=dry_run,
            idempotency_key=idempotency_key,
            ratification=RatificationSpec("context_item", context_item_id, None),
            apply_fn=_apply,
            pre_ratification_fn=_pre,
        )
    finally:
        db.close()


_BATCH_OP_NAMES = {
    "upsert_context_item",
    "append_context_event",
    "link_context_entities",
    "set_context_labels",
    "archive_context_item",
}
_BATCH_FATAL_RESULTS = {"conflict", "not_found"}


def _dispatch_batch_op(
    db: Any, resolved: ResolvedScope, actor: str, operation: str, payload: dict[str, Any]
) -> dict[str, Any]:
    """Ejecuta una operación del batch contra su servicio (flush-only; el commit único
    del pipeline la persiste). Lanza KeyError si falta un campo obligatorio del payload,
    ValueError si un UUID es inválido."""
    ws = resolved.workspace.id
    if operation == "upsert_context_item":
        return upsert_context_item_service(
            db,
            workspace_id=ws,
            project_id=resolved.project.id if resolved.project else None,
            task_id=resolved.task.id if resolved.task else None,
            item_key=payload["item_key"],
            item_type=payload.get("item_type", "note"),
            title=payload.get("title", ""),
            content=payload.get("content"),
            labels=payload.get("labels"),
            expected_version=payload.get("expected_version"),
            actor=actor,
            dry_run=False,
        )
    if operation == "append_context_event":
        created = create_event_for_task(
            db,
            resolved.task.id,
            EventCreate(
                event_type=payload["event_type"],
                summary=payload.get("summary", ""),
                source=payload.get("source", "mcp"),
                severity=payload.get("severity", "info"),
                metadata_json=payload.get("metadata_json") or {},
            ),
            consumer_id=resolved.consumer.id if resolved.consumer else None,
        )
        return {"result": "created", "after": _event_to_dict(created)}
    if operation == "link_context_entities":
        return link_context_entities_service(
            db,
            workspace_id=ws,
            source_item_id=uuid.UUID(payload["source_item_id"]),
            target_item_id=uuid.UUID(payload["target_item_id"]),
            relation=payload["relation"],
            metadata=payload.get("metadata"),
            actor=actor,
            dry_run=False,
        )
    if operation == "set_context_labels":
        return append_context_labels_service(
            db,
            workspace_id=ws,
            item_id=uuid.UUID(payload["context_item_id"]),
            labels=payload.get("labels", []),
            actor=actor,
            dry_run=False,
        )
    return archive_context_item_service(
        db,
        workspace_id=ws,
        item_id=uuid.UUID(payload["context_item_id"]),
        actor=actor,
        dry_run=False,
    )


@mcp.tool(
    description="Apply context sync batch atomically in dry_run/commit mode. Write plane."
)
def apply_sync_batch(
    operations: list[dict[str, Any]],
    dry_run: bool = True,
    idempotency_key: str | None = None,
    workspace_id: str | None = None,
    project_id: str | None = None,
    task_id: str | None = None,
    consumer: str | None = None,
    session_key: str | None = None,
) -> dict[str, Any]:
    db = SessionLocal()
    try:
        resolved, error_payload = _resolve_scope_or_error(
            db,
            workspace_id=workspace_id,
            project_id=project_id,
            task_id=task_id,
            consumer=consumer,
            session_key=session_key,
        )
        if error_payload:
            return error_payload
        scope_issue = _scope_guard("apply_sync_batch")
        if scope_issue:
            scope_issue["scope"] = resolved.scope_payload()
            scope_issue["resolution_metadata"] = resolved.resolution_metadata
            return scope_issue
        def _apply(db, request_id):
            summary = {
                "operations": len(operations),
                "dry_run": dry_run,
                "operation_names": [str(item.get("operation", "unknown")) for item in operations],
            }
            # dry_run must be non-mutating for domain tables; avoid persisting sync batches.
            if dry_run:
                batch_payload = {
                    "id": None,
                    "status": "dry_run",
                    "operation_count": len(operations),
                    "idempotency_key": request_id,
                }
                return WriteOutcome(
                    result="dry_run",
                    subject_id=None,
                    before_payload={"operations": []},
                    after_payload=summary,
                    extra={"summary": summary, "batch": batch_payload},
                )
            actor = cast(str, _extract_actor_context()["actor_sub"])
            op_results: list[dict[str, Any]] = []
            for idx, op in enumerate(operations):
                operation = str(op.get("operation", ""))
                op_payload = op.get("payload") or {}
                if operation not in _BATCH_OP_NAMES:
                    return _invalid_request(
                        f"operación no soportada en batch: {operation!r} (índice {idx}).",
                        resolved.scope_payload(),
                        resolved.resolution_metadata,
                    )
                if operation == "upsert_context_item":
                    op_payload = {**op_payload, "item_type": op_payload.get("item_type", "note")}
                # Ratificación POR OPERACIÓN (item_type como categoría en upsert): cierra el
                # bypass de gobernanza donde el canon se colaba vía batch (F03).
                category = op_payload.get("item_type") if operation == "upsert_context_item" else None
                target_key = (
                    op_payload.get("item_key")
                    or op_payload.get("context_item_id")
                    or op_payload.get("source_item_id")
                    or f"batch:{operation}"
                )
                gate = _require_ratification(
                    db,
                    resolved,
                    tool_name=operation,
                    target_kind="context_item",
                    target_key=str(target_key),
                    category=category,
                    dry_run=False,
                )
                if gate is not None:
                    # rollback total: run_governed_write no comitea ante un dict de error.
                    return gate
                try:
                    op_result = _dispatch_batch_op(db, resolved, actor, operation, op_payload)
                except KeyError as exc:
                    return _invalid_request(
                        f"payload incompleto para {operation} (índice {idx}): falta {exc}.",
                        resolved.scope_payload(),
                        resolved.resolution_metadata,
                    )
                except ValueError as exc:
                    return _invalid_request(
                        f"payload inválido para {operation} (índice {idx}): {exc}.",
                        resolved.scope_payload(),
                        resolved.resolution_metadata,
                    )
                op_result_name = str(op_result.get("result"))
                if op_result_name in _BATCH_FATAL_RESULTS:
                    return _invalid_request(
                        f"operación {operation!r} falló en batch (índice {idx}): resultado {op_result_name!r}.",
                        resolved.scope_payload(),
                        resolved.resolution_metadata,
                    )
                after = op_result.get("after")
                op_results.append(
                    {
                        "index": idx,
                        "operation": operation,
                        "result": op_result_name,
                        "subject_id": after.get("id") if isinstance(after, dict) else None,
                    }
                )
            batch, replayed = create_or_reuse_sync_batch_service(
                db,
                workspace_id=resolved.workspace.id,
                project_id=resolved.project.id if resolved.project else None,
                task_id=resolved.task.id if resolved.task else None,
                idempotency_key=request_id,
                operation_count=len(operations),
                dry_run=False,
                summary=summary,
                actor=actor,
            )
            return WriteOutcome(
                result="applied",
                subject_id=str(batch.id),
                before_payload={"operations": []},
                after_payload={"summary": summary, "results": op_results},
                extra={
                    "summary": summary,
                    "results": op_results,
                    "batch": {
                        "id": str(batch.id),
                        "status": batch.status,
                        "operation_count": batch.operation_count,
                        "idempotency_key": batch.idempotency_key,
                    },
                },
                idempotent_replay=replayed,
            )

        return run_governed_write(
            db,
            tool_name="apply_sync_batch",
            resolved=resolved,
            dry_run=dry_run,
            idempotency_key=idempotency_key,
            ratification=RatificationSpec("context_item", "sync_batch", None),
            apply_fn=_apply,
        )
    finally:
        db.close()


def _apply_tool_auth_metadata() -> None:
    tool_manager = getattr(mcp, "_tool_manager", None)
    if tool_manager is None:
        return

    tools = getattr(tool_manager, "_tools", None)
    if not isinstance(tools, dict):
        return

    for tool_name, tool in tools.items():
        scopes = TOOL_SCOPES.get(tool_name, [])
        if not scopes:
            continue

        # Keep MCP tool metadata explicit so clients can discover auth requirements
        # from list_tools without probing protected calls.
        tool_meta = dict(tool.meta or {})
        tool_meta["securitySchemes"] = _tool_security_schemes(scopes)
        tool.meta = tool_meta

        if tool.annotations is None:
            tool.annotations = ToolAnnotations()
        tool.annotations.readOnlyHint = not _is_write_tool(tool_name)


def _instrument_runtime_handlers() -> None:
    lowlevel_server = getattr(mcp, "_mcp_server", None)
    if lowlevel_server is None:
        return

    handlers = getattr(lowlevel_server, "request_handlers", None)
    if not isinstance(handlers, dict):
        return

    list_tools_handler = handlers.get(mcp_types.ListToolsRequest)
    if callable(list_tools_handler) and not getattr(list_tools_handler, "_mcp_observed", False):

        async def observed_list_tools(req: mcp_types.ListToolsRequest) -> mcp_types.ServerResult:
            context_fields = _runtime_request_context_fields()
            mcp_logger.emit(
                "mcp_list_tools_started",
                auth_stage="tool_runtime",
                **context_fields,
            )
            try:
                result = await list_tools_handler(req)
            except Exception as exc:  # noqa: BLE001
                mcp_logger.emit(
                    "mcp_list_tools_failed",
                    level="ERROR",
                    auth_stage="tool_runtime",
                    exception={"class": exc.__class__.__name__, "message": str(exc)},
                    **context_fields,
                )
                raise

            root = getattr(result, "root", None)
            if not isinstance(root, mcp_types.ListToolsResult):
                mcp_logger.emit(
                    "mcp_list_tools_failed",
                    level="ERROR",
                    auth_stage="tool_runtime",
                    reason="invalid_result_shape",
                    result_type=type(root).__name__,
                    **context_fields,
                )
                return result

            published_tools = [tool.name for tool in root.tools]
            known_tools = set(TOOL_SCOPES.keys())
            published_set = set(published_tools)
            unknown_published_tools = sorted(published_set - known_tools)
            missing_from_published = sorted(known_tools - published_set)
            read_tools_total = sum(
                1 for tool_name in published_tools if tool_name in TOOL_SCOPES and not _is_write_tool(tool_name)
            )
            write_tools_total = sum(
                1 for tool_name in published_tools if tool_name in TOOL_SCOPES and _is_write_tool(tool_name)
            )

            mcp_logger.emit(
                "mcp_list_tools_succeeded",
                auth_stage="tool_runtime",
                total_tools=len(published_tools),
                tool_names=published_tools,
                read_tools_total=read_tools_total,
                write_tools_total=write_tools_total,
                unknown_published_tools=unknown_published_tools,
                missing_from_published=missing_from_published,
                **context_fields,
            )

            if unknown_published_tools or missing_from_published:
                mcp_logger.emit(
                    "mcp_contract_drift_detected",
                    level="WARNING",
                    auth_stage="tool_runtime",
                    reason="tool_scope_drift",
                    unknown_published_tools=unknown_published_tools,
                    missing_from_published=missing_from_published,
                    **context_fields,
                )

            return result

        observed_list_tools._mcp_observed = True  # type: ignore[attr-defined]
        handlers[mcp_types.ListToolsRequest] = observed_list_tools

    call_tool_handler = handlers.get(mcp_types.CallToolRequest)
    if callable(call_tool_handler) and not getattr(call_tool_handler, "_mcp_observed", False):

        async def observed_call_tool(req: mcp_types.CallToolRequest) -> mcp_types.ServerResult:
            tool_name = req.params.name
            arguments = req.params.arguments or {}
            context_fields = _runtime_request_context_fields()
            started_payload = {
                "tool_name": tool_name,
                "auth_stage": "tool_runtime",
                **context_fields,
            }
            if mcp_logger.log_payloads:
                started_payload["arguments"] = sanitize_structure(arguments)

            mcp_logger.emit(
                "mcp_call_tool_started",
                **started_payload,
            )

            try:
                result = await call_tool_handler(req)
            except Exception as exc:  # noqa: BLE001
                mcp_logger.emit(
                    "mcp_call_tool_failed",
                    level="ERROR",
                    tool_name=tool_name,
                    auth_stage="tool_runtime",
                    failure_classification="tool_exception",
                    exception={"class": exc.__class__.__name__, "message": str(exc)},
                    **context_fields,
                )
                raise

            root = getattr(result, "root", None)
            if isinstance(root, mcp_types.CallToolResult):
                structured = root.structuredContent
                structured_is_dict = isinstance(structured, dict)
                status = structured.get("status") if structured_is_dict else None
                error = structured.get("error") if structured_is_dict else None
                classification = "ok"
                event_name = "mcp_call_tool_succeeded"
                log_level = "INFO"

                if root.isError:
                    classification = "unexpected_error"
                    event_name = "mcp_call_tool_failed"
                    log_level = "ERROR"
                elif not structured_is_dict:
                    classification = "invalid_structured_content"
                    event_name = "mcp_call_tool_failed"
                    log_level = "ERROR"
                elif status == "forbidden" and error == "insufficient_scope":
                    classification = "scope_denied"
                    event_name = "mcp_call_tool_failed"
                    log_level = "WARNING"
                elif status in {"invalid_request"}:
                    classification = "schema_validation_error"
                    event_name = "mcp_call_tool_failed"
                    log_level = "WARNING"
                elif status in {"unauthorized", "forbidden"}:
                    classification = "scope_denied"
                    event_name = "mcp_call_tool_failed"
                    log_level = "WARNING"
                elif status == "error":
                    classification = "tool_exception"
                    event_name = "mcp_call_tool_failed"
                    log_level = "ERROR"

                mcp_logger.emit(
                    event_name,
                    level=log_level,
                    tool_name=tool_name,
                    auth_stage="tool_runtime",
                    is_error=root.isError,
                    structured_content_type=type(structured).__name__,
                    status=status,
                    error=error,
                    failure_classification=classification,
                    **context_fields,
                )
                return result

            if isinstance(root, mcp_types.ErrorData):
                mcp_logger.emit(
                    "mcp_call_tool_failed",
                    level="ERROR",
                    tool_name=tool_name,
                    auth_stage="tool_runtime",
                    failure_classification="unexpected_error",
                    error_code=root.code,
                    error_message=root.message,
                    **context_fields,
                )
                return result

            mcp_logger.emit(
                "mcp_call_tool_failed",
                level="ERROR",
                tool_name=tool_name,
                auth_stage="tool_runtime",
                failure_classification="unexpected_error",
                result_type=type(root).__name__,
                **context_fields,
            )
            return result

        observed_call_tool._mcp_observed = True  # type: ignore[attr-defined]
        handlers[mcp_types.CallToolRequest] = observed_call_tool


def build_observed_streamable_http_app(target_mcp: FastMCP | None = None) -> MCPTransportObservabilityASGI:
    resolved_mcp = target_mcp or mcp
    base_app = resolved_mcp.streamable_http_app()
    protected_resource_path = "/.well-known/oauth-protected-resource"
    existing_routes = getattr(base_app.router, "routes", [])
    base_app.router.routes = [
        route for route in existing_routes if getattr(route, "path", None) != protected_resource_path
    ]
    if _auth_runtime_enabled():
        route_endpoint = cors_middleware(_protected_resource_metadata_endpoint, ["GET", "OPTIONS"])
        custom_route = Route(
            protected_resource_path,
            endpoint=route_endpoint,
            methods=["GET", "OPTIONS"],
        )
        base_app.router.routes.insert(0, custom_route)

    app = MCPTransportObservabilityASGI(
        base_app,
        logger=mcp_logger,
        streamable_path=resolved_mcp.settings.streamable_http_path,
        allowed_origins=settings.mcp_allowed_origins_list,
        enforce_when_empty=_auth_runtime_enabled(),
    )

    if _auth_runtime_enabled() and not settings.mcp_allowed_origins_list:
        mcp_logger.emit(
            "mcp_origin_guard_permissive",
            level="WARNING",
            auth_stage="startup",
            message=(
                "MCP_ALLOWED_ORIGINS is not configured — Origin guard is permissive "
                "(all origins allowed). Set MCP_ALLOWED_ORIGINS for production."
            ),
        )

    return app


# ---------------------------------------------------------------------------
# Plano deliberativo de ratificación (ADR: deliberative-context-ratification)
# ---------------------------------------------------------------------------
from app.models.approved_decision import ApprovedDecision as _ApprovedDecision
from app.services import approval_policy_service as _approval_policy
from app.services import deliberation_service as _deliberation
from app.services import proposal_service as _proposals
from app.services import staleness_service as _staleness


def _proposal_to_dict(proposal: Any) -> dict[str, Any]:
    return {
        "id": str(proposal.id),
        "workspace_id": str(proposal.workspace_id),
        "project_id": str(proposal.project_id) if proposal.project_id else None,
        "task_id": str(proposal.task_id) if proposal.task_id else None,
        "target_kind": proposal.target_kind,
        "target_key": proposal.target_key,
        "status": proposal.status,
        "rationale": proposal.rationale,
        "proposed_payload": proposal.proposed_payload,
        "ratified_by": proposal.ratified_by,
        "ratified_at": proposal.ratified_at.isoformat() if proposal.ratified_at else None,
        "ratified_decision_id": str(proposal.ratified_decision_id) if proposal.ratified_decision_id else None,
        "created_at": proposal.created_at.isoformat() if proposal.created_at else None,
    }


@mcp.tool(description="Propose a change for human ratification. Creates a Proposal (in_review). Write plane.")
def propose_change(
    target_kind: str,
    target_key: str,
    rationale: str,
    proposed_payload: dict[str, Any] | None = None,
    dry_run: bool = True,
    idempotency_key: str | None = None,
    workspace_id: str | None = None,
    project_id: str | None = None,
    task_id: str | None = None,
    consumer: str | None = None,
    session_key: str | None = None,
) -> dict[str, Any]:
    db = SessionLocal()
    try:
        resolved, error_payload = _resolve_scope_or_error(
            db, workspace_id=workspace_id, project_id=project_id, task_id=task_id,
            consumer=consumer, session_key=session_key,
        )
        if error_payload:
            return error_payload
        scope_issue = _scope_guard("propose_change")
        if scope_issue:
            scope_issue["scope"] = resolved.scope_payload()
            scope_issue["resolution_metadata"] = resolved.resolution_metadata
            return scope_issue
        if dry_run:
            if target_kind not in _proposals.PROPOSAL_TARGET_KINDS:
                return _invalid_request(
                    f"target_kind inválido: {target_kind!r}",
                    resolved.scope_payload(),
                    resolved.resolution_metadata,
                )
            return {
                "status": "ok",
                "dry_run": True,
                "result": "dry_run",
                "scope": resolved.scope_payload(),
                "resolution_metadata": resolved.resolution_metadata,
                "preview": {"target_kind": target_kind, "target_key": target_key},
            }
        try:
            proposal = _proposals.create_proposal(
                db,
                workspace_id=resolved.workspace.id,
                project_id=resolved.project.id if resolved.project else None,
                task_id=resolved.task.id if resolved.task else None,
                target_kind=target_kind,
                target_key=target_key,
                rationale=rationale,
                proposed_payload=proposed_payload or {},
                proposer_consumer_id=resolved.consumer.id if resolved.consumer else None,
                idempotency_key=idempotency_key,
            )
            if proposal.status == "proposed":
                _proposals.transition_proposal(db, proposal, "in_review")
            if proposal.task_id is not None and proposal.project_id is not None:
                _deliberation.record_proposal_event(
                    db, proposal=proposal, event_type="proposal.raised",
                    summary=f"Propuesta para {target_kind}:{target_key}",
                )
            db.commit()
        except _proposals.InvalidProposalInput as exc:
            db.rollback()
            return _invalid_request(str(exc), resolved.scope_payload(), resolved.resolution_metadata)
        return {
            "status": "ok",
            "scope": resolved.scope_payload(),
            "resolution_metadata": resolved.resolution_metadata,
            "proposal": _proposal_to_dict(proposal),
        }
    finally:
        db.close()


@mcp.tool(description="List proposals for a target or the resolved scope. Read plane.")
def list_proposals(
    target_kind: str | None = None,
    target_key: str | None = None,
    status: str | None = None,
    limit: int = 50,
    workspace_id: str | None = None,
    project_id: str | None = None,
    task_id: str | None = None,
    consumer: str | None = None,
    session_key: str | None = None,
) -> dict[str, Any]:
    db = SessionLocal()
    try:
        resolved, error_payload = _resolve_scope_or_error(
            db, workspace_id=workspace_id, project_id=project_id, task_id=task_id,
            consumer=consumer, session_key=session_key,
        )
        if error_payload:
            return error_payload
        scope_issue = _scope_guard("list_proposals")
        if scope_issue:
            scope_issue["scope"] = resolved.scope_payload()
            scope_issue["resolution_metadata"] = resolved.resolution_metadata
            return scope_issue
        if target_kind and target_key:
            rows = _proposals.list_proposals_for_target(
                db, workspace_id=resolved.workspace.id, target_kind=target_kind,
                target_key=target_key, statuses=[status] if status else None,
            )
        else:
            stmt = select(_proposals.Proposal).where(_proposals.Proposal.workspace_id == resolved.workspace.id)
            if status:
                stmt = stmt.where(_proposals.Proposal.status == status)
            stmt = stmt.order_by(_proposals.Proposal.created_at.desc()).limit(limit)
            rows = list(db.execute(stmt).scalars().all())
        return {
            "status": "ok",
            "scope": resolved.scope_payload(),
            "resolution_metadata": resolved.resolution_metadata,
            "total": len(rows),
            "proposals": [_proposal_to_dict(row) for row in rows],
        }
    finally:
        db.close()


def _verify_operator_token(
    operator_token: str | None, scope_payload: dict[str, Any], resolution_metadata: dict[str, Any]
) -> dict[str, Any] | None:
    """WP-0.2: verifica el operator-token de ratificación SIEMPRE (incluso bajo bypass).
    La ratificación es la decisión humana; no debe ser auto-aprobable por máquina."""
    configured = settings.operator_ratify_token
    if not configured:
        return {
            "status": "ratification_not_configured",
            "message": "La ratificación requiere OPERATOR_RATIFY_TOKEN configurado en el servidor.",
            "scope": scope_payload,
            "resolution_metadata": resolution_metadata,
        }
    if not operator_token or operator_token != configured:
        return {
            "status": "operator_token_invalid",
            "message": "Operator-token ausente o inválido; la ratificación es una decisión humana verificada.",
            "scope": scope_payload,
            "resolution_metadata": resolution_metadata,
        }
    return None


@mcp.tool(description="Ratify a Proposal (human decision -> canonical). Requires wis.context.ratify.")
def ratify_proposal(
    proposal_id: str,
    operator_token: str | None = None,
    workspace_id: str | None = None,
    project_id: str | None = None,
    task_id: str | None = None,
    consumer: str | None = None,
    session_key: str | None = None,
) -> dict[str, Any]:
    db = SessionLocal()
    try:
        resolved, error_payload = _resolve_scope_or_error(
            db, workspace_id=workspace_id, project_id=project_id, task_id=task_id,
            consumer=consumer, session_key=session_key,
        )
        if error_payload:
            return error_payload
        scope_issue = _scope_guard("ratify_proposal")
        if scope_issue:
            scope_issue["scope"] = resolved.scope_payload()
            scope_issue["resolution_metadata"] = resolved.resolution_metadata
            return scope_issue
        token_error = _verify_operator_token(operator_token, resolved.scope_payload(), resolved.resolution_metadata)
        if token_error is not None:
            return token_error
        try:
            pid = uuid.UUID(proposal_id)
        except ValueError:
            return _invalid_request("proposal_id debe ser UUID válido.", resolved.scope_payload(), resolved.resolution_metadata)
        proposal = _proposals.get_proposal(db, pid)
        if proposal is None or proposal.workspace_id != resolved.workspace.id:
            return {"status": "not_found", "message": "Proposal no encontrada en este workspace.",
                    "scope": resolved.scope_payload(), "resolution_metadata": resolved.resolution_metadata}
        actor = str(_extract_actor_context()["actor_sub"])
        decision_id = None
        try:
            if proposal.target_kind == "decision":
                payload = proposal.proposed_payload or {}
                dk = str(payload.get("decision_key") or proposal.target_key)
                fields = dict(
                    title=str(payload.get("title") or proposal.target_key),
                    decision=str(payload.get("decision") or proposal.rationale),
                    rationale=str(payload.get("rationale") or proposal.rationale),
                    category=str(payload.get("category") or "general"),
                    constraints_json=payload.get("constraints") or {},
                    approved_by=actor,
                    proposal_id=proposal.id,
                    is_active=True,
                )
                # decision_key es único por scope: re-ratificar actualiza en sitio.
                existing_decision = db.execute(
                    select(_ApprovedDecision).where(
                        _ApprovedDecision.workspace_id == proposal.workspace_id,
                        _ApprovedDecision.decision_key == dk,
                        _ApprovedDecision.task_id == proposal.task_id,
                        _ApprovedDecision.project_id == proposal.project_id,
                    )
                ).scalars().first()
                if existing_decision is not None:
                    for _k, _v in fields.items():
                        setattr(existing_decision, _k, _v)
                    db.flush()
                    decision_id = existing_decision.id
                else:
                    decision = _ApprovedDecision(
                        workspace_id=proposal.workspace_id,
                        project_id=proposal.project_id,
                        task_id=proposal.task_id,
                        decision_key=dk,
                        **fields,
                    )
                    db.add(decision)
                    db.flush()
                    decision_id = decision.id
            _proposals.transition_proposal(db, proposal, "ratified", ratified_by=actor, ratified_decision_id=decision_id)
            if proposal.task_id is not None and proposal.project_id is not None:
                _deliberation.record_proposal_event(
                    db, proposal=proposal, event_type="proposal.ratified",
                    summary=f"Ratificada por {actor}",
                    payload={"decision_id": str(decision_id) if decision_id else None},
                )
            staleness = _staleness.invalidate_context_for_scope(
                db, workspace_id=proposal.workspace_id, project_id=proposal.project_id, task_id=proposal.task_id
            )
            db.commit()
        except _proposals.InvalidProposalTransition as exc:
            db.rollback()
            return {"status": "invalid_transition", "message": str(exc),
                    "proposal": _proposal_to_dict(proposal), "scope": resolved.scope_payload()}
        except _proposals.InvalidProposalInput as exc:
            db.rollback()
            return _invalid_request(str(exc), resolved.scope_payload(), resolved.resolution_metadata)
        except Exception as exc:  # noqa: BLE001 - no propagar excepción cruda al transporte
            db.rollback()
            return {
                "status": "error",
                "error": "ratify_failed",
                "message": str(exc),
                "scope": resolved.scope_payload(),
                "resolution_metadata": resolved.resolution_metadata,
            }
        return {
            "status": "ok",
            "scope": resolved.scope_payload(),
            "resolution_metadata": resolved.resolution_metadata,
            "proposal": _proposal_to_dict(proposal),
            "ratified_decision_id": str(decision_id) if decision_id else None,
            "staleness": staleness,
        }
    finally:
        db.close()


@mcp.tool(description="Reject a Proposal (human decision). Requires wis.context.ratify.")
def reject_proposal(
    proposal_id: str,
    reason: str | None = None,
    operator_token: str | None = None,
    workspace_id: str | None = None,
    project_id: str | None = None,
    task_id: str | None = None,
    consumer: str | None = None,
    session_key: str | None = None,
) -> dict[str, Any]:
    db = SessionLocal()
    try:
        resolved, error_payload = _resolve_scope_or_error(
            db, workspace_id=workspace_id, project_id=project_id, task_id=task_id,
            consumer=consumer, session_key=session_key,
        )
        if error_payload:
            return error_payload
        scope_issue = _scope_guard("reject_proposal")
        if scope_issue:
            scope_issue["scope"] = resolved.scope_payload()
            scope_issue["resolution_metadata"] = resolved.resolution_metadata
            return scope_issue
        token_error = _verify_operator_token(operator_token, resolved.scope_payload(), resolved.resolution_metadata)
        if token_error is not None:
            return token_error
        try:
            pid = uuid.UUID(proposal_id)
        except ValueError:
            return _invalid_request("proposal_id debe ser UUID válido.", resolved.scope_payload(), resolved.resolution_metadata)
        proposal = _proposals.get_proposal(db, pid)
        if proposal is None or proposal.workspace_id != resolved.workspace.id:
            return {"status": "not_found", "message": "Proposal no encontrada en este workspace.",
                    "scope": resolved.scope_payload(), "resolution_metadata": resolved.resolution_metadata}
        actor = str(_extract_actor_context()["actor_sub"])
        try:
            _proposals.transition_proposal(db, proposal, "rejected")
            if proposal.task_id is not None and proposal.project_id is not None:
                _deliberation.record_proposal_event(
                    db, proposal=proposal, event_type="proposal.rejected",
                    summary=f"Rechazada por {actor}" + (f": {reason}" if reason else ""),
                )
            db.commit()
        except _proposals.InvalidProposalTransition as exc:
            db.rollback()
            return {"status": "invalid_transition", "message": str(exc),
                    "proposal": _proposal_to_dict(proposal), "scope": resolved.scope_payload()}
        return {
            "status": "ok",
            "scope": resolved.scope_payload(),
            "resolution_metadata": resolved.resolution_metadata,
            "proposal": _proposal_to_dict(proposal),
        }
    finally:
        db.close()


_apply_tool_auth_metadata()
_instrument_runtime_handlers()


if __name__ == "__main__":
    import uvicorn

    # WP-0.5: el bypass local no debe exponerse a una URL pública. Este guard vive en
    # el arranque del transporte (no en Settings), para no afectar a pytest.
    if settings.mcp_auth_bypass_local and settings.mcp_public_base_url:
        raise RuntimeError(
            "MCP_AUTH_BYPASS_LOCAL=true con MCP_PUBLIC_BASE_URL configurado: no expongas "
            "el bypass a internet. Desactiva el bypass o quita MCP_PUBLIC_BASE_URL."
        )
    uvicorn.run(
        build_observed_streamable_http_app(),
        host=mcp.settings.host,
        port=mcp.settings.port,
        log_level=mcp.settings.log_level.lower(),
    )
