from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.event import Event
from app.models.task import Task
from app.schemas.event import EventCreate


def list_recent_events_for_task(db: Session, task_id: UUID, limit: int = 20) -> list[Event]:
    statement = (
        select(Event)
        .where(Event.task_id == task_id)
        .order_by(Event.event_ts.desc())
        .limit(limit)
    )
    return list(db.execute(statement).scalars().all())


def create_event_for_task(db: Session, task_id: UUID, payload: EventCreate) -> Event:
    task = db.execute(select(Task).where(Task.id == task_id)).scalars().first()
    if task is None:
        raise LookupError("Task not found.")

    event = Event(
        task_id=task_id,
        workspace_id=task.workspace_id,
        project_id=task.project_id,
        event_type=payload.event_type,
        summary=payload.summary,
        source=payload.source,
        severity=payload.severity,
        metadata_json=payload.metadata_json,
        payload_json=payload.metadata_json,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def list_recent_errors_for_task(db: Session, task_id: UUID, limit: int = 20, window_hours: int = 24) -> list[Event]:
    window_start = datetime.now(timezone.utc) - timedelta(hours=window_hours)
    statement = (
        select(Event)
        .where(
            Event.task_id == task_id,
            Event.event_type == "error",
            Event.severity.in_(["error", "critical"]),
            Event.created_at >= window_start,
        )
        .order_by(Event.created_at.desc())
        .limit(limit)
    )
    return list(db.execute(statement).scalars().all())
