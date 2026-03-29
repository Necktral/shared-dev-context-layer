from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.context_snapshot import ContextSnapshot
from app.models.task import Task
from app.schemas.snapshot import ManualSnapshotCreate


def create_manual_snapshot(
    db: Session,
    task_id: UUID,
    payload: ManualSnapshotCreate,
    policy_mode: str,
) -> ContextSnapshot:
    task = db.execute(select(Task).where(Task.id == task_id)).scalars().first()
    if task is None:
        raise LookupError("Task not found.")

    snapshot = ContextSnapshot(
        task_id=task_id,
        workspace_id=task.workspace_id,
        project_id=task.project_id,
        snapshot_type=payload.snapshot_type,
        snapshot_content=payload.snapshot_content,
        policy_applied=payload.policy_applied or policy_mode,
        generated_from="manual_api",
    )
    db.add(snapshot)
    db.commit()
    db.refresh(snapshot)
    return snapshot


def get_latest_snapshot_for_task(db: Session, task_id: UUID) -> ContextSnapshot | None:
    statement = (
        select(ContextSnapshot)
        .where(ContextSnapshot.task_id == task_id)
        .order_by(ContextSnapshot.created_at.desc())
    )
    return db.execute(statement).scalars().first()
