from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.task import Task


def get_active_task(db: Session) -> Task | None:
    statement = select(Task).where(Task.is_active.is_(True)).order_by(Task.updated_at.desc())
    return db.execute(statement).scalars().first()


def require_active_task(db: Session) -> Task:
    task = get_active_task(db)
    if not task:
        raise LookupError("No active task configured.")
    return task
