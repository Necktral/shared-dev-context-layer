"""Paso 6 — coherencia de contexto / invalidación de staleness.

Tras ratificar un cambio de canon, marca ``is_current=false`` en los
``ContextScope`` y ``ContextSnapshot`` dependientes. Un consumidor con
``is_current=false`` debe re-resolver contexto antes de actuar (sin fallback al
snapshot viejo).
"""
from __future__ import annotations

from uuid import UUID

from sqlalchemy import update
from sqlalchemy.orm import Session

from app.models.context_scope import ContextScope
from app.models.context_snapshot import ContextSnapshot


def invalidate_context_for_scope(
    db: Session,
    *,
    workspace_id: UUID,
    project_id: UUID | None = None,
    task_id: UUID | None = None,
) -> dict[str, int]:
    scope_stmt = update(ContextScope).where(
        ContextScope.workspace_id == workspace_id,
        ContextScope.is_current.is_(True),
    )
    snap_stmt = update(ContextSnapshot).where(
        ContextSnapshot.workspace_id == workspace_id,
        ContextSnapshot.is_current.is_(True),
    )
    if project_id is not None:
        scope_stmt = scope_stmt.where(ContextScope.project_id == project_id)
        snap_stmt = snap_stmt.where(ContextSnapshot.project_id == project_id)
    if task_id is not None:
        scope_stmt = scope_stmt.where(ContextScope.task_id == task_id)
        snap_stmt = snap_stmt.where(ContextSnapshot.task_id == task_id)

    scopes = db.execute(scope_stmt.values(is_current=False)).rowcount or 0
    snaps = db.execute(snap_stmt.values(is_current=False)).rowcount or 0
    db.flush()
    return {"scopes_invalidated": scopes, "snapshots_invalidated": snaps}
