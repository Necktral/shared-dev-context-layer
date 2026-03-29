from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.approved_decision import ApprovedDecision


def list_active_decisions_for_task(db: Session, task_id: UUID) -> list[ApprovedDecision]:
    statement = (
        select(ApprovedDecision)
        .where(ApprovedDecision.task_id == task_id, ApprovedDecision.is_active.is_(True))
        .order_by(ApprovedDecision.approved_at.desc(), ApprovedDecision.updated_at.desc())
    )
    return list(db.execute(statement).scalars().all())


def list_active_decisions_for_project(db: Session, project_id: UUID) -> list[ApprovedDecision]:
    statement = (
        select(ApprovedDecision)
        .where(
            ApprovedDecision.project_id == project_id,
            ApprovedDecision.task_id.is_(None),
            ApprovedDecision.is_active.is_(True),
        )
        .order_by(ApprovedDecision.approved_at.desc(), ApprovedDecision.updated_at.desc())
    )
    return list(db.execute(statement).scalars().all())


def list_active_decisions_for_workspace(db: Session, workspace_id: UUID) -> list[ApprovedDecision]:
    statement = (
        select(ApprovedDecision)
        .where(
            ApprovedDecision.workspace_id == workspace_id,
            ApprovedDecision.project_id.is_(None),
            ApprovedDecision.task_id.is_(None),
            ApprovedDecision.is_active.is_(True),
        )
        .order_by(ApprovedDecision.approved_at.desc(), ApprovedDecision.updated_at.desc())
    )
    return list(db.execute(statement).scalars().all())


def list_active_decisions_for_scope(
    db: Session,
    *,
    workspace_id: UUID,
    project_id: UUID,
    task_id: UUID | None,
) -> list[ApprovedDecision]:
    task_level = list_active_decisions_for_task(db, task_id) if task_id else []
    project_level = list_active_decisions_for_project(db, project_id)
    workspace_level = list_active_decisions_for_workspace(db, workspace_id)

    deduped: dict[str, ApprovedDecision] = {}
    ordered: list[ApprovedDecision] = []
    for decision in task_level + project_level + workspace_level:
        if decision.decision_key in deduped:
            continue
        deduped[decision.decision_key] = decision
        ordered.append(decision)
    return ordered
