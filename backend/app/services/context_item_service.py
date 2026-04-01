from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session

from app.models.context_item import ContextItem
from app.models.context_item_label import ContextItemLabel
from app.models.context_item_link import ContextItemLink
from app.models.context_snapshot import ContextSnapshot
from app.models.context_sync_batch import ContextSyncBatch
from app.models.event import Event


def context_item_to_dict(item: ContextItem) -> dict[str, Any]:
    return {
        "id": str(item.id),
        "workspace_id": str(item.workspace_id),
        "project_id": str(item.project_id) if item.project_id else None,
        "task_id": str(item.task_id) if item.task_id else None,
        "item_key": item.item_key,
        "item_type": item.item_type,
        "title": item.title,
        "content": item.content_json,
        "labels": item.labels_json,
        "status": item.status,
        "version": item.version,
        "created_by": item.created_by,
        "updated_by": item.updated_by,
        "created_at": item.created_at.isoformat() if item.created_at else None,
        "updated_at": item.updated_at.isoformat() if item.updated_at else None,
    }


def search_context_items(
    db: Session,
    *,
    workspace_id: UUID,
    project_id: UUID | None = None,
    task_id: UUID | None = None,
    query: str | None = None,
    item_type: str | None = None,
    status: str | None = "active",
    limit: int = 20,
    offset: int = 0,
) -> list[ContextItem]:
    statement = select(ContextItem).where(ContextItem.workspace_id == workspace_id)
    if project_id:
        statement = statement.where(ContextItem.project_id == project_id)
    if task_id:
        statement = statement.where(ContextItem.task_id == task_id)
    if status:
        statement = statement.where(ContextItem.status == status)
    if item_type:
        statement = statement.where(ContextItem.item_type == item_type)
    if query:
        like = f"%{query.strip()}%"
        statement = statement.where(or_(ContextItem.title.ilike(like), ContextItem.item_key.ilike(like)))
    statement = statement.order_by(ContextItem.updated_at.desc()).offset(max(offset, 0)).limit(max(min(limit, 200), 1))
    return list(db.execute(statement).scalars().all())


def get_context_item_by_id(db: Session, *, workspace_id: UUID, item_id: UUID) -> ContextItem | None:
    return db.execute(
        select(ContextItem).where(
            ContextItem.workspace_id == workspace_id,
            ContextItem.id == item_id,
        )
    ).scalars().first()


def list_context_windows(
    db: Session,
    *,
    workspace_id: UUID,
    project_id: UUID | None = None,
    task_id: UUID | None = None,
    window_hours: int = 24,
    limit: int = 20,
) -> dict[str, Any]:
    since = datetime.now(timezone.utc) - timedelta(hours=max(window_hours, 1))
    items_stmt = select(ContextItem).where(ContextItem.workspace_id == workspace_id, ContextItem.updated_at >= since)
    events_stmt = select(Event).where(Event.workspace_id == workspace_id, Event.created_at >= since)
    snapshots_stmt = select(ContextSnapshot).where(ContextSnapshot.workspace_id == workspace_id, ContextSnapshot.created_at >= since)
    if project_id:
        items_stmt = items_stmt.where(ContextItem.project_id == project_id)
        events_stmt = events_stmt.where(Event.project_id == project_id)
        snapshots_stmt = snapshots_stmt.where(ContextSnapshot.project_id == project_id)
    if task_id:
        items_stmt = items_stmt.where(ContextItem.task_id == task_id)
        events_stmt = events_stmt.where(Event.task_id == task_id)
        snapshots_stmt = snapshots_stmt.where(ContextSnapshot.task_id == task_id)

    items = list(
        db.execute(items_stmt.order_by(ContextItem.updated_at.desc()).limit(max(min(limit, 200), 1))).scalars().all()
    )
    errors_query = events_stmt.where(Event.event_type == "error").subquery()
    snapshots_query = snapshots_stmt.subquery()
    errors_count = db.execute(select(func.count()).select_from(errors_query)).scalar_one()
    snapshots_count = db.execute(select(func.count()).select_from(snapshots_query)).scalar_one()
    return {
        "window_hours": max(window_hours, 1),
        "since": since.isoformat(),
        "items_total": len(items),
        "errors_total": int(errors_count),
        "snapshots_total": int(snapshots_count),
        "items": [context_item_to_dict(item) for item in items],
    }


def resolve_related_items(
    db: Session,
    *,
    workspace_id: UUID,
    item_id: UUID,
    limit: int = 20,
) -> list[dict[str, Any]]:
    links = list(
        db.execute(
            select(ContextItemLink).where(
                ContextItemLink.workspace_id == workspace_id,
                ContextItemLink.source_item_id == item_id,
            ).order_by(ContextItemLink.created_at.desc()).limit(max(min(limit, 200), 1))
        ).scalars().all()
    )
    if not links:
        return []
    target_ids = [link.target_item_id for link in links]
    targets = {
        row.id: row
        for row in db.execute(
            select(ContextItem).where(
                ContextItem.workspace_id == workspace_id,
                ContextItem.id.in_(target_ids),
            )
        ).scalars().all()
    }
    related: list[dict[str, Any]] = []
    for link in links:
        target = targets.get(link.target_item_id)
        related.append(
            {
                "link_id": str(link.id),
                "relation": link.relation,
                "metadata": link.metadata_json,
                "target_item": context_item_to_dict(target) if target else None,
            }
        )
    return related


def get_sync_status(
    db: Session,
    *,
    workspace_id: UUID,
    project_id: UUID | None = None,
    task_id: UUID | None = None,
    limit: int = 20,
) -> list[dict[str, Any]]:
    statement = select(ContextSyncBatch).where(ContextSyncBatch.workspace_id == workspace_id)
    if project_id:
        statement = statement.where(ContextSyncBatch.project_id == project_id)
    if task_id:
        statement = statement.where(ContextSyncBatch.task_id == task_id)
    batches = list(
        db.execute(statement.order_by(ContextSyncBatch.created_at.desc()).limit(max(min(limit, 200), 1))).scalars().all()
    )
    return [
        {
            "id": str(batch.id),
            "workspace_id": str(batch.workspace_id),
            "project_id": str(batch.project_id) if batch.project_id else None,
            "task_id": str(batch.task_id) if batch.task_id else None,
            "idempotency_key": batch.idempotency_key,
            "operation_count": batch.operation_count,
            "status": batch.status,
            "dry_run": batch.dry_run,
            "summary": batch.summary_json,
            "requested_by": batch.requested_by,
            "created_at": batch.created_at.isoformat() if batch.created_at else None,
            "updated_at": batch.updated_at.isoformat() if batch.updated_at else None,
        }
        for batch in batches
    ]


def upsert_context_item(
    db: Session,
    *,
    workspace_id: UUID,
    project_id: UUID | None,
    task_id: UUID | None,
    item_key: str,
    item_type: str,
    title: str,
    content: dict[str, Any] | None,
    labels: list[str] | None,
    expected_version: int | None,
    actor: str,
    dry_run: bool,
) -> dict[str, Any]:
    existing = db.execute(
        select(ContextItem).where(
            ContextItem.workspace_id == workspace_id,
            ContextItem.item_key == item_key,
        )
    ).scalars().first()
    normalized_labels = sorted(set(label.strip() for label in (labels or []) if label and label.strip()))
    normalized_content = content or {}

    if existing is None:
        preview = {
            "operation": "create",
            "item_key": item_key,
            "item_type": item_type,
            "title": title,
            "content": normalized_content,
            "labels": normalized_labels,
        }
        if dry_run:
            return {"result": "dry_run", "before": None, "after": preview}

        created = ContextItem(
            workspace_id=workspace_id,
            project_id=project_id,
            task_id=task_id,
            item_key=item_key,
            item_type=item_type,
            title=title,
            content_json=normalized_content,
            labels_json=normalized_labels,
            status="active",
            version=1,
            created_by=actor,
            updated_by=actor,
        )
        db.add(created)
        db.commit()
        db.refresh(created)
        return {"result": "created", "before": None, "after": context_item_to_dict(created)}

    before = context_item_to_dict(existing)
    if expected_version is not None and existing.version != expected_version:
        return {
            "result": "conflict",
            "before": before,
            "after": before,
            "expected_version": expected_version,
            "actual_version": existing.version,
        }

    after_preview = {
        **before,
        "project_id": str(project_id) if project_id else before["project_id"],
        "task_id": str(task_id) if task_id else before["task_id"],
        "item_type": item_type,
        "title": title,
        "content": normalized_content,
        "labels": normalized_labels,
        "version": int(before["version"]) + 1,
    }
    if dry_run:
        return {"result": "dry_run", "before": before, "after": after_preview}

    existing.project_id = project_id or existing.project_id
    existing.task_id = task_id or existing.task_id
    existing.item_type = item_type
    existing.title = title
    existing.content_json = normalized_content
    existing.labels_json = normalized_labels
    existing.version = existing.version + 1
    existing.status = "active"
    existing.updated_by = actor
    db.add(existing)
    db.commit()
    db.refresh(existing)
    return {"result": "updated", "before": before, "after": context_item_to_dict(existing)}


def append_context_labels(
    db: Session,
    *,
    workspace_id: UUID,
    item_id: UUID,
    labels: list[str],
    actor: str,
    dry_run: bool,
) -> dict[str, Any]:
    item = get_context_item_by_id(db, workspace_id=workspace_id, item_id=item_id)
    if item is None:
        return {"result": "not_found", "before": None, "after": None}
    before = context_item_to_dict(item)
    normalized = sorted(set(label.strip() for label in labels if label and label.strip()))
    new_labels = sorted(set((item.labels_json or []) + normalized))
    if dry_run:
        preview = {**before, "labels": new_labels}
        return {"result": "dry_run", "before": before, "after": preview}

    # keep explicit normalized labels table and denormalized labels_json on item
    db.execute(
        delete(ContextItemLabel).where(
            ContextItemLabel.workspace_id == workspace_id,
            ContextItemLabel.item_id == item_id,
        )
    )
    for label in new_labels:
        db.add(
            ContextItemLabel(
                workspace_id=workspace_id,
                item_id=item_id,
                label=label,
                created_by=actor,
            )
        )

    item.labels_json = new_labels
    item.updated_by = actor
    item.version = item.version + 1
    db.add(item)
    db.commit()
    db.refresh(item)
    return {"result": "updated", "before": before, "after": context_item_to_dict(item)}


def archive_context_item(
    db: Session,
    *,
    workspace_id: UUID,
    item_id: UUID,
    actor: str,
    dry_run: bool,
) -> dict[str, Any]:
    item = get_context_item_by_id(db, workspace_id=workspace_id, item_id=item_id)
    if item is None:
        return {"result": "not_found", "before": None, "after": None}
    before = context_item_to_dict(item)
    if dry_run:
        preview = {**before, "status": "archived", "version": int(before["version"]) + 1}
        return {"result": "dry_run", "before": before, "after": preview}
    item.status = "archived"
    item.updated_by = actor
    item.version = item.version + 1
    db.add(item)
    db.commit()
    db.refresh(item)
    return {"result": "archived", "before": before, "after": context_item_to_dict(item)}


def link_context_entities(
    db: Session,
    *,
    workspace_id: UUID,
    source_item_id: UUID,
    target_item_id: UUID,
    relation: str,
    metadata: dict[str, Any] | None,
    actor: str,
    dry_run: bool,
) -> dict[str, Any]:
    source = get_context_item_by_id(db, workspace_id=workspace_id, item_id=source_item_id)
    target = get_context_item_by_id(db, workspace_id=workspace_id, item_id=target_item_id)
    if source is None or target is None:
        return {
            "result": "not_found",
            "before": None,
            "after": None,
            "missing": {
                "source_exists": source is not None,
                "target_exists": target is not None,
            },
        }
    existing = db.execute(
        select(ContextItemLink).where(
            ContextItemLink.workspace_id == workspace_id,
            ContextItemLink.source_item_id == source_item_id,
            ContextItemLink.target_item_id == target_item_id,
            ContextItemLink.relation == relation,
        )
    ).scalars().first()
    before = (
        {
            "id": str(existing.id),
            "relation": existing.relation,
            "metadata": existing.metadata_json,
        }
        if existing
        else None
    )
    after = {
        "source_item_id": str(source_item_id),
        "target_item_id": str(target_item_id),
        "relation": relation,
        "metadata": metadata or {},
    }
    if dry_run:
        return {"result": "dry_run", "before": before, "after": after}
    if existing:
        existing.metadata_json = metadata or {}
        existing.created_by = actor
        db.add(existing)
        db.commit()
        db.refresh(existing)
        return {
            "result": "updated",
            "before": before,
            "after": {
                "id": str(existing.id),
                "relation": existing.relation,
                "metadata": existing.metadata_json,
            },
        }
    created = ContextItemLink(
        workspace_id=workspace_id,
        source_item_id=source_item_id,
        target_item_id=target_item_id,
        relation=relation,
        metadata_json=metadata or {},
        created_by=actor,
    )
    db.add(created)
    db.commit()
    db.refresh(created)
    return {
        "result": "created",
        "before": None,
        "after": {
            "id": str(created.id),
            "relation": created.relation,
            "metadata": created.metadata_json,
        },
    }


def create_or_reuse_sync_batch(
    db: Session,
    *,
    workspace_id: UUID,
    project_id: UUID | None,
    task_id: UUID | None,
    idempotency_key: str,
    operation_count: int,
    dry_run: bool,
    summary: dict[str, Any],
    actor: str,
) -> tuple[ContextSyncBatch, bool]:
    existing = db.execute(
        select(ContextSyncBatch).where(
            ContextSyncBatch.workspace_id == workspace_id,
            ContextSyncBatch.idempotency_key == idempotency_key,
        )
    ).scalars().first()
    if existing:
        return existing, True
    row = ContextSyncBatch(
        workspace_id=workspace_id,
        project_id=project_id,
        task_id=task_id,
        idempotency_key=idempotency_key,
        operation_count=operation_count,
        dry_run=dry_run,
        status="dry_run" if dry_run else "applied",
        summary_json=summary,
        requested_by=actor,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row, False


def make_preview_item_key() -> str:
    return f"preview-{uuid.uuid4()}"
