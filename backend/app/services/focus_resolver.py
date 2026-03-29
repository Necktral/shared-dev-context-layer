from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.consumer import Consumer
from app.models.context_scope import ContextScope
from app.models.execution_session import ExecutionSession
from app.models.project import Project
from app.models.task import Task
from app.models.workspace import Workspace


@dataclass
class ResolvedScope:
    status: str
    workspace: Workspace | None
    project: Project | None
    task: Task | None
    consumer: Consumer | None
    execution_session: ExecutionSession | None
    resolution_metadata: dict

    @property
    def is_ok(self) -> bool:
        return self.status == "ok"

    def scope_payload(self) -> dict:
        return {
            "workspace_id": str(self.workspace.id) if self.workspace else None,
            "project_id": str(self.project.id) if self.project else None,
            "task_id": str(self.task.id) if self.task else None,
        }

    def consumer_payload(self) -> dict:
        return {
            "consumer_type": self.consumer.consumer_type if self.consumer else None,
            "consumer_name": self.consumer.name if self.consumer else None,
            "session_key": self.execution_session.session_key if self.execution_session else None,
            "session_status": self.execution_session.status if self.execution_session else None,
        }


def _parse_uuid(value: str | None, field: str, flags: list[str]) -> UUID | None:
    if value is None:
        return None
    try:
        return UUID(value)
    except ValueError:
        flags.append(f"invalid_{field}")
        return None


def _find_effective_task_for_project(db: Session, project_id: UUID) -> Task | None:
    task = db.execute(
        select(Task).where(Task.project_id == project_id, Task.is_active.is_(True)).order_by(Task.updated_at.desc()).limit(1)
    ).scalars().first()
    if task:
        return task
    return db.execute(select(Task).where(Task.project_id == project_id).order_by(Task.updated_at.desc()).limit(1)).scalars().first()


def _find_effective_project_for_workspace(db: Session, workspace_id: UUID) -> Project | None:
    active_task = db.execute(
        select(Task).where(Task.workspace_id == workspace_id, Task.is_active.is_(True)).order_by(Task.updated_at.desc()).limit(1)
    ).scalars().first()
    if active_task:
        return db.execute(select(Project).where(Project.id == active_task.project_id)).scalars().first()

    return db.execute(
        select(Project).where(Project.workspace_id == workspace_id).order_by(Project.updated_at.desc()).limit(1)
    ).scalars().first()


def resolve_scope(
    db: Session,
    *,
    workspace_id: str | None = None,
    project_id: str | None = None,
    task_id: str | None = None,
    consumer: str | None = None,
    session_key: str | None = None,
) -> ResolvedScope:
    conflict_flags: list[str] = []
    requested = {
        "workspace_id": workspace_id,
        "project_id": project_id,
        "task_id": task_id,
        "consumer": consumer,
        "session_key": session_key,
    }

    workspace_uuid = _parse_uuid(workspace_id, "workspace_id", conflict_flags)
    project_uuid = _parse_uuid(project_id, "project_id", conflict_flags)
    task_uuid = _parse_uuid(task_id, "task_id", conflict_flags)
    if conflict_flags:
        return ResolvedScope(
            status="scope_invalid",
            workspace=None,
            project=None,
            task=None,
            consumer=None,
            execution_session=None,
            resolution_metadata={
                "source": "request",
                "fallback_level": "none",
                "conflict_flags": conflict_flags,
                "requested": requested,
                "resolved_scope": {"workspace_id": None, "project_id": None, "task_id": None},
            },
        )

    consumer_row: Consumer | None = None
    if consumer is not None:
        consumer_row = db.execute(select(Consumer).where(Consumer.consumer_type == consumer)).scalars().first()
        if consumer_row is None:
            return ResolvedScope(
                status="scope_not_found",
                workspace=None,
                project=None,
                task=None,
                consumer=None,
                execution_session=None,
                resolution_metadata={
                    "source": "request",
                    "fallback_level": "none",
                    "conflict_flags": ["consumer_not_found"],
                    "requested": requested,
                    "resolved_scope": {"workspace_id": None, "project_id": None, "task_id": None},
                },
            )

    session_row: ExecutionSession | None = None
    if session_key is not None:
        session_row = db.execute(select(ExecutionSession).where(ExecutionSession.session_key == session_key)).scalars().first()
        if session_row is None:
            return ResolvedScope(
                status="scope_not_found",
                workspace=None,
                project=None,
                task=None,
                consumer=consumer_row,
                execution_session=None,
                resolution_metadata={
                    "source": "request",
                    "fallback_level": "none",
                    "conflict_flags": ["session_not_found"],
                    "requested": requested,
                    "resolved_scope": {"workspace_id": None, "project_id": None, "task_id": None},
                },
            )
        if consumer_row and session_row.consumer_id != consumer_row.id:
            return ResolvedScope(
                status="scope_conflict",
                workspace=None,
                project=None,
                task=None,
                consumer=consumer_row,
                execution_session=session_row,
                resolution_metadata={
                    "source": "request",
                    "fallback_level": "none",
                    "conflict_flags": ["consumer_session_mismatch"],
                    "requested": requested,
                    "resolved_scope": {"workspace_id": None, "project_id": None, "task_id": None},
                },
            )

    workspace_row: Workspace | None = None
    project_row: Project | None = None
    task_row: Task | None = None
    source = "canonical_scope"
    fallback_level = "none"

    if task_uuid:
        task_row = db.execute(select(Task).where(Task.id == task_uuid)).scalars().first()
        if task_row is None:
            return ResolvedScope(
                status="scope_not_found",
                workspace=None,
                project=None,
                task=None,
                consumer=consumer_row,
                execution_session=session_row,
                resolution_metadata={
                    "source": "task_id",
                    "fallback_level": "none",
                    "conflict_flags": ["task_not_found"],
                    "requested": requested,
                    "resolved_scope": {"workspace_id": None, "project_id": None, "task_id": None},
                },
            )

        if project_uuid and task_row.project_id != project_uuid:
            return ResolvedScope(
                status="scope_conflict",
                workspace=None,
                project=None,
                task=task_row,
                consumer=consumer_row,
                execution_session=session_row,
                resolution_metadata={
                    "source": "task_id",
                    "fallback_level": "none",
                    "conflict_flags": ["task_project_mismatch"],
                    "requested": requested,
                    "resolved_scope": {
                        "workspace_id": str(task_row.workspace_id),
                        "project_id": str(task_row.project_id),
                        "task_id": str(task_row.id),
                    },
                },
            )
        if workspace_uuid and task_row.workspace_id != workspace_uuid:
            return ResolvedScope(
                status="scope_conflict",
                workspace=None,
                project=None,
                task=task_row,
                consumer=consumer_row,
                execution_session=session_row,
                resolution_metadata={
                    "source": "task_id",
                    "fallback_level": "none",
                    "conflict_flags": ["task_workspace_mismatch"],
                    "requested": requested,
                    "resolved_scope": {
                        "workspace_id": str(task_row.workspace_id),
                        "project_id": str(task_row.project_id),
                        "task_id": str(task_row.id),
                    },
                },
            )
        source = "task_id"
    elif project_uuid:
        project_row = db.execute(select(Project).where(Project.id == project_uuid)).scalars().first()
        if project_row is None:
            return ResolvedScope(
                status="scope_not_found",
                workspace=None,
                project=None,
                task=None,
                consumer=consumer_row,
                execution_session=session_row,
                resolution_metadata={
                    "source": "project_id",
                    "fallback_level": "none",
                    "conflict_flags": ["project_not_found"],
                    "requested": requested,
                    "resolved_scope": {"workspace_id": None, "project_id": None, "task_id": None},
                },
            )
        if workspace_uuid and project_row.workspace_id != workspace_uuid:
            return ResolvedScope(
                status="scope_conflict",
                workspace=None,
                project=project_row,
                task=None,
                consumer=consumer_row,
                execution_session=session_row,
                resolution_metadata={
                    "source": "project_id",
                    "fallback_level": "none",
                    "conflict_flags": ["project_workspace_mismatch"],
                    "requested": requested,
                    "resolved_scope": {
                        "workspace_id": str(project_row.workspace_id),
                        "project_id": str(project_row.id),
                        "task_id": None,
                    },
                },
            )
        task_row = _find_effective_task_for_project(db, project_row.id)
        source = "project_id"
        fallback_level = "task_from_project" if task_row else "project_only"
    elif workspace_uuid:
        workspace_row = db.execute(select(Workspace).where(Workspace.id == workspace_uuid)).scalars().first()
        if workspace_row is None:
            return ResolvedScope(
                status="scope_not_found",
                workspace=None,
                project=None,
                task=None,
                consumer=consumer_row,
                execution_session=session_row,
                resolution_metadata={
                    "source": "workspace_id",
                    "fallback_level": "none",
                    "conflict_flags": ["workspace_not_found"],
                    "requested": requested,
                    "resolved_scope": {"workspace_id": None, "project_id": None, "task_id": None},
                },
            )
        project_row = _find_effective_project_for_workspace(db, workspace_row.id)
        task_row = _find_effective_task_for_project(db, project_row.id) if project_row else None
        source = "workspace_id"
        fallback_level = "task_from_workspace" if task_row else ("project_from_workspace" if project_row else "workspace_only")
    elif session_row:
        workspace_row = db.execute(select(Workspace).where(Workspace.id == session_row.workspace_id)).scalars().first()
        project_row = db.execute(select(Project).where(Project.id == session_row.project_id)).scalars().first()
        task_row = db.execute(select(Task).where(Task.id == session_row.task_id)).scalars().first() if session_row.task_id else None
        if task_row is None and project_row:
            task_row = _find_effective_task_for_project(db, project_row.id)
        source = "session_key"
        fallback_level = "task_from_session_project" if task_row and session_row.task_id is None else "session_context"
    else:
        scope_row = db.execute(
            select(ContextScope).where(ContextScope.is_current.is_(True)).order_by(ContextScope.created_at.desc()).limit(1)
        ).scalars().first()
        if scope_row:
            workspace_row = db.execute(select(Workspace).where(Workspace.id == scope_row.workspace_id)).scalars().first()
            project_row = db.execute(select(Project).where(Project.id == scope_row.project_id)).scalars().first()
            task_row = db.execute(select(Task).where(Task.id == scope_row.task_id)).scalars().first() if scope_row.task_id else None
            source = "canonical_scope"
            fallback_level = "none"
        else:
            task_row = db.execute(
                select(Task).where(Task.is_active.is_(True)).order_by(Task.updated_at.desc()).limit(1)
            ).scalars().first()
            source = "legacy_active_task"
            fallback_level = "legacy_active_task" if task_row else "none"

    if task_row and project_row is None:
        project_row = db.execute(select(Project).where(Project.id == task_row.project_id)).scalars().first()
    if task_row and workspace_row is None:
        workspace_row = db.execute(select(Workspace).where(Workspace.id == task_row.workspace_id)).scalars().first()
    if project_row and workspace_row is None:
        workspace_row = db.execute(select(Workspace).where(Workspace.id == project_row.workspace_id)).scalars().first()

    status = "ok" if workspace_row and project_row else "no_scope"

    resolution_metadata = {
        "source": source,
        "fallback_level": fallback_level,
        "conflict_flags": conflict_flags,
        "requested": requested,
        "resolved_scope": {
            "workspace_id": str(workspace_row.id) if workspace_row else None,
            "project_id": str(project_row.id) if project_row else None,
            "task_id": str(task_row.id) if task_row else None,
        },
    }
    return ResolvedScope(
        status=status,
        workspace=workspace_row,
        project=project_row,
        task=task_row,
        consumer=consumer_row,
        execution_session=session_row,
        resolution_metadata=resolution_metadata,
    )
