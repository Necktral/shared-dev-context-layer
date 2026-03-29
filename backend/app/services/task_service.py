from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.context_scope import ContextScope
from app.models.task import Task


def get_active_task(db: Session) -> Task | None:
    canonical_scope = db.execute(
        select(ContextScope).where(ContextScope.is_current.is_(True)).order_by(ContextScope.created_at.desc()).limit(1)
    ).scalars().first()
    if canonical_scope and canonical_scope.task_id:
        task = db.execute(select(Task).where(Task.id == canonical_scope.task_id)).scalars().first()
        if task:
            return task

    statement = select(Task).where(Task.is_active.is_(True)).order_by(Task.updated_at.desc())
    return db.execute(statement).scalars().first()


def get_task_by_id(db: Session, task_id: UUID) -> Task | None:
    return db.execute(select(Task).where(Task.id == task_id)).scalars().first()


def get_active_task_for_project(db: Session, project_id: UUID) -> Task | None:
    task = db.execute(
        select(Task).where(Task.project_id == project_id, Task.is_active.is_(True)).order_by(Task.updated_at.desc()).limit(1)
    ).scalars().first()
    if task:
        return task
    return db.execute(select(Task).where(Task.project_id == project_id).order_by(Task.updated_at.desc()).limit(1)).scalars().first()


def get_active_task_for_workspace(db: Session, workspace_id: UUID) -> Task | None:
    task = db.execute(
        select(Task).where(Task.workspace_id == workspace_id, Task.is_active.is_(True)).order_by(Task.updated_at.desc()).limit(1)
    ).scalars().first()
    if task:
        return task
    return db.execute(
        select(Task).where(Task.workspace_id == workspace_id).order_by(Task.updated_at.desc()).limit(1)
    ).scalars().first()


def require_active_task(db: Session) -> Task:
    task = get_active_task(db)
    if not task:
        raise LookupError("No active task configured.")
    return task
