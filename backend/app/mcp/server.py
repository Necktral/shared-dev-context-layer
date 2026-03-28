from __future__ import annotations

from typing import Any

from mcp.server.fastmcp import FastMCP

from app.audit.service import record_publish_audit
from app.core.config import Settings, get_settings
from app.db.session import SessionLocal
from app.models.context_snapshot import ContextSnapshot
from app.models.validation_run import ValidationRun
from app.policies.delegated_limited import apply_delegated_limited_policy
from app.services.context_snapshot_service import build_operational_snapshot, get_last_validation_for_task
from app.services.decision_service import list_active_decisions_for_task
from app.services.event_service import list_recent_errors_for_task
from app.services.snapshot_service import get_latest_snapshot_for_task
from app.services.task_service import get_active_task as service_get_active_task

settings: Settings = get_settings()

mcp = FastMCP(
    name="WIS Context Sync MCP",
    instructions="Read-only context server for delegated_limited mode.",
    host="0.0.0.0",
    port=settings.mcp_port,
    streamable_http_path="/mcp",
)


def _task_to_dict(task: Any) -> dict[str, Any]:
    return {
        "id": str(task.id),
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


@mcp.tool(
    description="Get active task context. Use this when you need the current canonical task state."
)
def get_active_task() -> dict[str, Any]:
    db = SessionLocal()
    try:
        task = get_active_task_from_db(db)
        if task is None:
            return {"status": "no_active_task"}

        latest_snapshot: ContextSnapshot | None = get_latest_snapshot_for_task(db, task.id)
        latest_validation = get_last_validation_for_task(db, task)
        task_payload = _task_to_dict(task)
        task_payload["last_snapshot_at"] = latest_snapshot.created_at.isoformat() if latest_snapshot else None
        task_payload["last_validation_status"] = _validation_to_dict(latest_validation)["status"]

        payload = {"task": task_payload, "mode": settings.system_mode}
        return _apply_policy_and_audit(db, "get_active_task", task.id, payload)
    finally:
        db.close()


def get_active_task_from_db(db: Any) -> Any:
    return service_get_active_task(db)


@mcp.tool(
    description="Get latest context snapshot. Use this when you need the latest packaged operational context."
)
def get_context_snapshot() -> dict[str, Any]:
    db = SessionLocal()
    try:
        task = get_active_task_from_db(db)
        if task is None:
            return {"status": "no_active_task"}

        snapshot = get_latest_snapshot_for_task(db, task.id)
        if snapshot and isinstance(snapshot.snapshot_content, dict) and "identity" in snapshot.snapshot_content:
            snapshot_content = snapshot.snapshot_content
            source = "database"
            snapshot_created_at = snapshot.created_at.isoformat() if snapshot.created_at else None
            generated_from = snapshot.generated_from
        else:
            snapshot_content = build_operational_snapshot(db, task, policy_mode=settings.system_mode)
            source = "derived_runtime"
            snapshot_created_at = snapshot_content["metadata"]["generated_at"]
            generated_from = "derived_runtime"

        payload = {
            "task_id": str(task.id),
            "status": "ok",
            "source": source,
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
def get_recent_errors(limit: int = 20, window_hours: int = 24) -> dict[str, Any]:
    db = SessionLocal()
    try:
        task = get_active_task_from_db(db)
        if task is None:
            return {"status": "no_active_task"}

        errors = list_recent_errors_for_task(db, task.id, limit=limit, window_hours=window_hours)
        payload = {
            "task_id": str(task.id),
            "window_hours": window_hours,
            "limit": limit,
            "total": len(errors),
            "errors": [_event_to_dict(event) for event in errors],
        }
        return _apply_policy_and_audit(db, "get_recent_errors", task.id, payload)
    finally:
        db.close()


@mcp.tool(
    description="Get validation status. Use this when checking latest validation result derived from validation events."
)
def get_validation_status() -> dict[str, Any]:
    db = SessionLocal()
    try:
        task = get_active_task_from_db(db)
        if task is None:
            return {"status": "no_active_task"}

        latest_validation = get_last_validation_for_task(db, task)
        if latest_validation is None:
            payload = {
                "task_id": str(task.id),
                "current_status": "unknown",
                "last_validation_type": None,
                "last_validation_source": None,
                "last_validation_at": None,
                "summary": "No validation run available.",
                "details": {},
            }
        else:
            payload = {
                "task_id": str(task.id),
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
    description="Get approved decisions. Use this when you need active approved constraints or decisions for the task."
)
def get_approved_decisions() -> dict[str, Any]:
    db = SessionLocal()
    try:
        task = get_active_task_from_db(db)
        if task is None:
            return {"status": "no_active_task"}

        decisions = list_active_decisions_for_task(db, task.id)
        payload = {
            "task_id": str(task.id),
            "total": len(decisions),
            "decisions": [_decision_to_dict(decision) for decision in decisions],
        }
        return _apply_policy_and_audit(db, "get_approved_decisions", task.id, payload)
    finally:
        db.close()


if __name__ == "__main__":
    mcp.run(transport="streamable-http")
