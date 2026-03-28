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
