from collections.abc import Sequence
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.models.approved_decision import ApprovedDecision
from app.models.event import Event
from app.models.task import Task
from app.models.validation_run import ValidationRun
from app.services.decision_service import list_active_decisions_for_task
from app.services.event_service import list_recent_errors_for_task
from app.services.validation_service import get_latest_validation_run_for_task


def _decision_summary(decisions: Sequence[ApprovedDecision]) -> list[dict[str, Any]]:
    return [
        {
            "decision_key": decision.decision_key,
            "title": decision.title,
            "category": decision.category,
            "decision": decision.decision,
            "rationale": decision.rationale,
            "constraints": decision.constraints_json,
            "approved_at": decision.approved_at.isoformat() if decision.approved_at else None,
        }
        for decision in decisions
    ]


def _error_summary(errors: Sequence[Event]) -> tuple[int, str | None]:
    if not errors:
        return 0, None
    dominant_error = errors[0].summary
    return len(errors), dominant_error


def build_operational_snapshot(db: Session, task: Task, policy_mode: str, generated_from: str = "derived_runtime") -> dict[str, Any]:
    latest_validation = get_latest_validation_run_for_task(db, task.id)
    active_decisions = list_active_decisions_for_task(db, task.id)
    recent_errors = list_recent_errors_for_task(db, task.id, limit=20, window_hours=24)
    recent_errors_count, dominant_error = _error_summary(recent_errors)

    validation_section = {
        "status": latest_validation.status if latest_validation else "unknown",
        "last_validation_type": latest_validation.validation_type if latest_validation else None,
        "last_validation_source": latest_validation.source if latest_validation else None,
        "last_validation_at": latest_validation.executed_at.isoformat() if latest_validation else None,
        "summary": latest_validation.summary if latest_validation else "No validation run available.",
        "details": latest_validation.details if latest_validation else {},
    }

    snapshot = {
        "identity": {
            "task_id": str(task.id),
            "task_title": task.title,
            "goal": task.goal,
            "phase": task.current_phase or "unknown",
        },
        "execution_state": {
            "focus": task.current_phase or "general_execution",
            "repo": task.repo,
            "branch": task.branch,
            "next_action": task.next_action,
            "status": task.status,
            "priority": task.priority,
        },
        "validation": validation_section,
        "decisions": {
            "count": len(active_decisions),
            "items": _decision_summary(active_decisions),
        },
        "errors": {
            "recent_errors_count": recent_errors_count,
            "dominant_error": dominant_error,
            "items": [
                {
                    "severity": error.severity,
                    "summary": error.summary,
                    "source": error.source,
                    "created_at": error.created_at.isoformat() if error.created_at else None,
                }
                for error in recent_errors
            ],
        },
        "next_action": task.next_action,
        "metadata": {
            "policy": policy_mode,
            "origin": generated_from,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        },
    }
    return snapshot


def get_last_validation_for_task(db: Session, task: Task) -> ValidationRun | None:
    return get_latest_validation_run_for_task(db, task.id)
