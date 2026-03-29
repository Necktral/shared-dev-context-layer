from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.validation_run import ValidationRun


def get_latest_validation_run_for_task(db: Session, task_id: UUID) -> ValidationRun | None:
    statement = (
        select(ValidationRun)
        .where(ValidationRun.task_id == task_id)
        .order_by(ValidationRun.executed_at.desc(), ValidationRun.created_at.desc())
        .limit(1)
    )
    return db.execute(statement).scalars().first()


def get_latest_validation_run_for_scope(
    db: Session,
    *,
    workspace_id: UUID,
    project_id: UUID,
    task_id: UUID | None,
) -> ValidationRun | None:
    statement = select(ValidationRun)
    if task_id is not None:
        statement = statement.where(ValidationRun.task_id == task_id)
    else:
        statement = statement.where(
            ValidationRun.workspace_id == workspace_id,
            ValidationRun.project_id == project_id,
        )
    statement = statement.order_by(ValidationRun.executed_at.desc(), ValidationRun.created_at.desc()).limit(1)
    return db.execute(statement).scalars().first()
