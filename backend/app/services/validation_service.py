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
