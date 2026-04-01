from __future__ import annotations

import uuid
from typing import Any
from typing import cast

from mcp.server.auth.middleware.auth_context import get_access_token
from mcp.server.auth.settings import AuthSettings
from mcp.server.fastmcp import FastMCP
from sqlalchemy import select

from app.audit.service import record_publish_audit
from app.audit.write_audit_service import get_existing_request_audit, record_write_audit
from app.auth.jwt_verifier import Auth0JWTTokenVerifier, decode_unverified_claims
from app.core.config import Settings, get_settings
from app.db.session import SessionLocal
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
}


def _auth_runtime_enabled() -> bool:
    return settings.mcp_auth_enabled and not settings.mcp_auth_bypass_local


def _build_mcp_server() -> FastMCP:
    auth_settings: AuthSettings | None = None
    token_verifier = None
    instructions = "Context server with read/write planes and scope guards."

    if _auth_runtime_enabled():
        if not settings.mcp_auth0_issuer or not settings.mcp_auth0_audience or not settings.mcp_auth0_jwks_url:
            raise RuntimeError(
                "MCP auth is enabled but MCP_AUTH0_ISSUER/MCP_AUTH0_AUDIENCE/MCP_AUTH0_JWKS_URL are not fully configured.",
            )
        auth_settings = AuthSettings(
            issuer_url=settings.mcp_auth0_issuer,
            resource_server_url=settings.mcp_auth0_audience,
            required_scopes=["wis.context.read"],
        )
        token_verifier = Auth0JWTTokenVerifier(
            issuer=settings.mcp_auth0_issuer,
            audience=settings.mcp_auth0_audience,
            jwks_url=settings.mcp_auth0_jwks_url,
            clock_skew_seconds=max(settings.mcp_auth_clock_skew_seconds, 0),
        )
        instructions = "OAuth-protected context server with read/write planes and scope guards."

    return FastMCP(
        name="WIS Context Sync MCP",
        instructions=instructions,
        host="0.0.0.0",
        port=settings.mcp_port,
        streamable_http_path="/mcp",
        auth=auth_settings,
        token_verifier=token_verifier,
    )


mcp = _build_mcp_server()


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


def _extract_actor_context() -> dict[str, Any]:
    token = get_access_token()
    scopes = sorted(set(token.scopes)) if token and token.scopes else []
    claims = decode_unverified_claims(token.token) if token else {}
    actor_sub = str(claims.get("sub") or token.client_id if token else "local_bypass")
    return {
        "token": token,
        "scopes": scopes,
        "claims": claims,
        "actor_sub": actor_sub,
    }


def _scope_guard(tool_name: str) -> dict[str, Any] | None:
    required = TOOL_SCOPES.get(tool_name, [])
    if not required:
        return None
    # For direct local invocations (tests/scripts) bypass can be explicit.
    if settings.mcp_auth_bypass_local:
        return None
    token = get_access_token()
    if token is None:
        return {
            "status": "unauthorized",
            "error": "invalid_token",
            "message": "Authentication required for this tool.",
            "required_scopes": required,
            "present_scopes": [],
        }
    present = sorted(set(token.scopes))
    missing = [scope for scope in required if scope not in present]
    if missing:
        return {
            "status": "forbidden",
            "error": "insufficient_scope",
            "message": "Token does not include required scopes for this tool.",
            "required_scopes": required,
            "present_scopes": present,
            "missing_scopes": missing,
        }
    return None


def _invalid_request(message: str, scope_payload: dict[str, Any], resolution_metadata: dict[str, Any], **extra: Any) -> dict[str, Any]:
    payload = {
        "status": "invalid_request",
        "message": message,
        "scope": scope_payload,
        "resolution_metadata": resolution_metadata,
    }
    payload.update(extra)
    return payload


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


def _write_audit_and_filter(
    db: Any,
    *,
    tool_name: str,
    resolved: ResolvedScope,
    request_id: str,
    dry_run: bool,
    result: str,
    subject_id: str | None,
    before_payload: Any,
    after_payload: Any,
    response_payload: dict[str, Any],
) -> dict[str, Any]:
    actor_context = _extract_actor_context()
    audit_row = record_write_audit(
        db=db,
        workspace_id=resolved.workspace.id,
        project_id=resolved.project.id if resolved.project else None,
        task_id=resolved.task.id if resolved.task else None,
        tool_name=tool_name,
        subject_id=subject_id,
        request_id=request_id,
        actor_sub=actor_context["actor_sub"],
        scopes=cast(list[str], actor_context["scopes"]),
        before_payload=before_payload,
        after_payload=after_payload,
        result=result,
        dry_run=dry_run,
        metadata={
            "consumer_context": resolved.consumer_payload(),
            "resolution_metadata": resolved.resolution_metadata,
        },
    )
    record_publish_audit(
        db=db,
        task_id=resolved.task.id,
        destination="chatgpt_developer_mode",
        package_type=tool_name,
        fields_included=sorted(response_payload.keys()),
        fields_redacted=[],
        result=result,
    )
    response_payload["audit_ref"] = {
        "write_audit_id": str(audit_row.id),
        "created_at": audit_row.created_at.isoformat() if audit_row.created_at else None,
    }
    filtered, _, _ = apply_delegated_limited_policy(tool_name, response_payload)
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


def _ensure_idempotency_key(
    *,
    resolved: ResolvedScope,
    idempotency_key: str | None,
    dry_run: bool,
) -> dict[str, Any] | None:
    if dry_run:
        return None
    if idempotency_key and idempotency_key.strip():
        return None
    return _invalid_request(
        "idempotency_key es obligatorio cuando dry_run=false.",
        resolved.scope_payload(),
        resolved.resolution_metadata,
        dry_run=dry_run,
    )


def _existing_replay_payload(
    db: Any,
    *,
    resolved: ResolvedScope,
    tool_name: str,
    request_id: str,
    dry_run: bool,
) -> dict[str, Any] | None:
    existing = get_existing_request_audit(
        db,
        workspace_id=resolved.workspace.id,
        tool_name=tool_name,
        request_id=request_id,
    )
    if existing is None:
        return None
    payload = {
        "status": "ok",
        "scope": resolved.scope_payload(),
        "resolution_metadata": resolved.resolution_metadata,
        "dry_run": dry_run,
        "request_id": request_id,
        "result": existing.result,
        "idempotent_replay": True,
        "audit_ref": {
            "write_audit_id": str(existing.id),
            "created_at": existing.created_at.isoformat() if existing.created_at else None,
        },
    }
    filtered, _, _ = apply_delegated_limited_policy(tool_name, payload)
    return filtered


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
        key_error = _ensure_idempotency_key(resolved=resolved, idempotency_key=idempotency_key, dry_run=dry_run)
        if key_error:
            return key_error
        request_id = idempotency_key or f"dryrun-{uuid.uuid4()}"
        replay = _existing_replay_payload(
            db,
            resolved=resolved,
            tool_name="upsert_context_item",
            request_id=request_id,
            dry_run=dry_run,
        )
        if replay:
            return replay
        actor = _extract_actor_context()
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
            actor=cast(str, actor["actor_sub"]),
            dry_run=dry_run,
        )
        response = {
            "status": "ok",
            "scope": resolved.scope_payload(),
            "resolution_metadata": resolved.resolution_metadata,
            "dry_run": dry_run,
            "request_id": request_id,
            "result": result["result"],
            "before": result.get("before"),
            "after": result.get("after"),
            "idempotent_replay": False,
        }
        return _write_audit_and_filter(
            db,
            tool_name="upsert_context_item",
            resolved=resolved,
            request_id=request_id,
            dry_run=dry_run,
            result=str(result["result"]),
            subject_id=result.get("after", {}).get("id") if isinstance(result.get("after"), dict) else None,
            before_payload=result.get("before"),
            after_payload=result.get("after"),
            response_payload=response,
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
        key_error = _ensure_idempotency_key(resolved=resolved, idempotency_key=idempotency_key, dry_run=dry_run)
        if key_error:
            return key_error
        request_id = idempotency_key or f"dryrun-{uuid.uuid4()}"
        replay = _existing_replay_payload(
            db,
            resolved=resolved,
            tool_name="append_context_event",
            request_id=request_id,
            dry_run=dry_run,
        )
        if replay:
            return replay
        before_payload = {"event": None}
        if dry_run:
            after_payload = {
                "event_type": event_type,
                "summary": summary,
                "source": source,
                "severity": severity,
                "metadata": metadata_json or {},
            }
            response = {
                "status": "ok",
                "scope": resolved.scope_payload(),
                "resolution_metadata": resolved.resolution_metadata,
                "dry_run": True,
                "request_id": request_id,
                "result": "dry_run",
                "event": after_payload,
                "idempotent_replay": False,
            }
            return _write_audit_and_filter(
                db,
                tool_name="append_context_event",
                resolved=resolved,
                request_id=request_id,
                dry_run=True,
                result="dry_run",
                subject_id=None,
                before_payload=before_payload,
                after_payload=after_payload,
                response_payload=response,
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
        )
        after_payload = _event_to_dict(created)
        response = {
            "status": "ok",
            "scope": resolved.scope_payload(),
            "resolution_metadata": resolved.resolution_metadata,
            "dry_run": False,
            "request_id": request_id,
            "result": "created",
            "event": after_payload,
            "idempotent_replay": False,
        }
        return _write_audit_and_filter(
            db,
            tool_name="append_context_event",
            resolved=resolved,
            request_id=request_id,
            dry_run=False,
            result="created",
            subject_id=after_payload["id"],
            before_payload=before_payload,
            after_payload=after_payload,
            response_payload=response,
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
        key_error = _ensure_idempotency_key(resolved=resolved, idempotency_key=idempotency_key, dry_run=dry_run)
        if key_error:
            return key_error
        request_id = idempotency_key or f"dryrun-{uuid.uuid4()}"
        replay = _existing_replay_payload(
            db,
            resolved=resolved,
            tool_name="link_context_entities",
            request_id=request_id,
            dry_run=dry_run,
        )
        if replay:
            return replay
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
        response = {
            "status": "ok",
            "scope": resolved.scope_payload(),
            "resolution_metadata": resolved.resolution_metadata,
            "dry_run": dry_run,
            "request_id": request_id,
            "result": result["result"],
            "before": result.get("before"),
            "after": result.get("after"),
            "idempotent_replay": False,
        }
        return _write_audit_and_filter(
            db,
            tool_name="link_context_entities",
            resolved=resolved,
            request_id=request_id,
            dry_run=dry_run,
            result=str(result["result"]),
            subject_id=source_item_id,
            before_payload=result.get("before"),
            after_payload=result.get("after"),
            response_payload=response,
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
        key_error = _ensure_idempotency_key(resolved=resolved, idempotency_key=idempotency_key, dry_run=dry_run)
        if key_error:
            return key_error
        request_id = idempotency_key or f"dryrun-{uuid.uuid4()}"
        replay = _existing_replay_payload(
            db,
            resolved=resolved,
            tool_name="set_context_labels",
            request_id=request_id,
            dry_run=dry_run,
        )
        if replay:
            return replay
        try:
            item_uuid = uuid.UUID(context_item_id)
        except ValueError:
            return _invalid_request(
                "context_item_id debe ser UUID válido.",
                resolved.scope_payload(),
                resolved.resolution_metadata,
            )
        result = append_context_labels_service(
            db,
            workspace_id=resolved.workspace.id,
            item_id=item_uuid,
            labels=labels,
            actor=cast(str, _extract_actor_context()["actor_sub"]),
            dry_run=dry_run,
        )
        response = {
            "status": "ok",
            "scope": resolved.scope_payload(),
            "resolution_metadata": resolved.resolution_metadata,
            "dry_run": dry_run,
            "request_id": request_id,
            "result": result["result"],
            "before": result.get("before"),
            "after": result.get("after"),
            "idempotent_replay": False,
        }
        return _write_audit_and_filter(
            db,
            tool_name="set_context_labels",
            resolved=resolved,
            request_id=request_id,
            dry_run=dry_run,
            result=str(result["result"]),
            subject_id=context_item_id,
            before_payload=result.get("before"),
            after_payload=result.get("after"),
            response_payload=response,
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
        key_error = _ensure_idempotency_key(resolved=resolved, idempotency_key=idempotency_key, dry_run=dry_run)
        if key_error:
            return key_error
        request_id = idempotency_key or f"dryrun-{uuid.uuid4()}"
        replay = _existing_replay_payload(
            db,
            resolved=resolved,
            tool_name="archive_context_item",
            request_id=request_id,
            dry_run=dry_run,
        )
        if replay:
            return replay
        try:
            item_uuid = uuid.UUID(context_item_id)
        except ValueError:
            return _invalid_request(
                "context_item_id debe ser UUID válido.",
                resolved.scope_payload(),
                resolved.resolution_metadata,
            )
        result = archive_context_item_service(
            db,
            workspace_id=resolved.workspace.id,
            item_id=item_uuid,
            actor=cast(str, _extract_actor_context()["actor_sub"]),
            dry_run=dry_run,
        )
        response = {
            "status": "ok",
            "scope": resolved.scope_payload(),
            "resolution_metadata": resolved.resolution_metadata,
            "dry_run": dry_run,
            "request_id": request_id,
            "result": result["result"],
            "before": result.get("before"),
            "after": result.get("after"),
            "idempotent_replay": False,
        }
        return _write_audit_and_filter(
            db,
            tool_name="archive_context_item",
            resolved=resolved,
            request_id=request_id,
            dry_run=dry_run,
            result=str(result["result"]),
            subject_id=context_item_id,
            before_payload=result.get("before"),
            after_payload=result.get("after"),
            response_payload=response,
        )
    finally:
        db.close()


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
        key_error = _ensure_idempotency_key(resolved=resolved, idempotency_key=idempotency_key, dry_run=dry_run)
        if key_error:
            return key_error
        request_id = idempotency_key or f"dryrun-{uuid.uuid4()}"
        replay = _existing_replay_payload(
            db,
            resolved=resolved,
            tool_name="apply_sync_batch",
            request_id=request_id,
            dry_run=dry_run,
        )
        if replay:
            return replay
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
            response = {
                "status": "ok",
                "scope": resolved.scope_payload(),
                "resolution_metadata": resolved.resolution_metadata,
                "dry_run": True,
                "request_id": request_id,
                "result": "dry_run",
                "summary": summary,
                "batch": batch_payload,
                "idempotent_replay": False,
            }
            return _write_audit_and_filter(
                db,
                tool_name="apply_sync_batch",
                resolved=resolved,
                request_id=request_id,
                dry_run=True,
                result="dry_run",
                subject_id=None,
                before_payload={"operations": []},
                after_payload=summary,
                response_payload=response,
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
            actor=cast(str, _extract_actor_context()["actor_sub"]),
        )
        response = {
            "status": "ok",
            "scope": resolved.scope_payload(),
            "resolution_metadata": resolved.resolution_metadata,
            "dry_run": False,
            "request_id": request_id,
            "result": "applied",
            "summary": summary,
            "batch": {
                "id": str(batch.id),
                "status": batch.status,
                "operation_count": batch.operation_count,
                "idempotency_key": batch.idempotency_key,
            },
            "idempotent_replay": replayed,
        }
        return _write_audit_and_filter(
            db,
            tool_name="apply_sync_batch",
            resolved=resolved,
            request_id=request_id,
            dry_run=False,
            result=str(response["result"]),
            subject_id=str(batch.id),
            before_payload={"operations": []},
            after_payload=summary,
            response_payload=response,
        )
    finally:
        db.close()


if __name__ == "__main__":
    mcp.run(transport="streamable-http")
