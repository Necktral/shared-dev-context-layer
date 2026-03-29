from sqlalchemy import func, select

from app.db.session import SessionLocal
from app.mcp.server import (
    get_active_task,
    get_approved_decisions,
    get_context_snapshot,
    get_recent_errors,
    get_validation_status,
)
from app.models.approved_decision import ApprovedDecision
from app.models.context_snapshot import ContextSnapshot
from app.models.event import Event
from app.models.policy_state import PolicyState
from app.models.publish_audit import PublishAudit
from app.models.task import Task


def _read_counts() -> dict[str, int]:
    db = SessionLocal()
    try:
        return {
            "tasks": db.execute(select(func.count()).select_from(Task)).scalar_one(),
            "decisions": db.execute(select(func.count()).select_from(ApprovedDecision)).scalar_one(),
            "events": db.execute(select(func.count()).select_from(Event)).scalar_one(),
            "snapshots": db.execute(select(func.count()).select_from(ContextSnapshot)).scalar_one(),
            "policy": db.execute(select(func.count()).select_from(PolicyState)).scalar_one(),
            "audit": db.execute(select(func.count()).select_from(PublishAudit)).scalar_one(),
        }
    finally:
        db.close()


def test_mcp_tools_compatibility_and_non_mutating_reads(active_task):
    before = _read_counts()

    base_responses = {
        "get_active_task": get_active_task(),
        "get_context_snapshot": get_context_snapshot(),
        "get_recent_errors": get_recent_errors(),
        "get_validation_status": get_validation_status(),
        "get_approved_decisions": get_approved_decisions(),
    }
    scoped_responses = {
        "get_active_task": get_active_task(
            workspace_id=str(active_task.workspace_id),
            project_id=str(active_task.project_id),
            task_id=str(active_task.id),
            consumer="chatgpt",
            session_key="canonical-chatgpt-session",
        ),
        "get_context_snapshot": get_context_snapshot(
            workspace_id=str(active_task.workspace_id),
            project_id=str(active_task.project_id),
            task_id=str(active_task.id),
            consumer="chatgpt",
            session_key="canonical-chatgpt-session",
        ),
        "get_recent_errors": get_recent_errors(
            workspace_id=str(active_task.workspace_id),
            project_id=str(active_task.project_id),
            task_id=str(active_task.id),
            consumer="chatgpt",
            session_key="canonical-chatgpt-session",
        ),
        "get_validation_status": get_validation_status(
            workspace_id=str(active_task.workspace_id),
            project_id=str(active_task.project_id),
            task_id=str(active_task.id),
            consumer="chatgpt",
            session_key="canonical-chatgpt-session",
        ),
        "get_approved_decisions": get_approved_decisions(
            workspace_id=str(active_task.workspace_id),
            project_id=str(active_task.project_id),
            task_id=str(active_task.id),
            consumer="chatgpt",
            session_key="canonical-chatgpt-session",
        ),
    }

    for name, payload in {**base_responses, **{f"scoped_{k}": v for k, v in scoped_responses.items()}}.items():
        assert payload["status"] == "ok", f"{name} returned unexpected status: {payload}"
        assert "resolution_metadata" in payload

    assert base_responses["get_validation_status"]["current_status"] != "unknown"
    assert base_responses["get_recent_errors"]["total"] >= 0
    assert isinstance(base_responses["get_recent_errors"]["errors"], list)
    assert "scope" in base_responses["get_context_snapshot"]
    assert "consumer_context" in base_responses["get_context_snapshot"]
    assert base_responses["get_approved_decisions"]["total"] >= 4
    assert isinstance(base_responses["get_approved_decisions"]["decisions"], list)

    after = _read_counts()
    assert after["tasks"] == before["tasks"]
    assert after["decisions"] == before["decisions"]
    assert after["events"] == before["events"]
    assert after["snapshots"] == before["snapshots"]
    assert after["policy"] == before["policy"]
    assert after["audit"] == before["audit"] + 10
