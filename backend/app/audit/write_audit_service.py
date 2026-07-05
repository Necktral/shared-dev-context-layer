from __future__ import annotations

import hashlib
import json
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.context_write_audit import ContextWriteAudit


def stable_hash(payload: Any) -> str:
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def get_existing_request_audit(
    db: Session,
    *,
    workspace_id: UUID,
    tool_name: str,
    request_id: str,
) -> ContextWriteAudit | None:
    return db.execute(
        select(ContextWriteAudit).where(
            ContextWriteAudit.workspace_id == workspace_id,
            ContextWriteAudit.tool_name == tool_name,
            ContextWriteAudit.request_id == request_id,
            # WP-0.1: el replay solo considera commits reales. Las filas dry_run
            # (histórico) quedan excluidas — casa con el índice parcial
            # ix_context_write_audit_replay (WHERE NOT dry_run).
            ContextWriteAudit.dry_run.is_(False),
        )
    ).scalars().first()


def record_write_audit(
    db: Session,
    *,
    workspace_id: UUID,
    project_id: UUID | None,
    task_id: UUID | None,
    tool_name: str,
    subject_id: str | None,
    request_id: str,
    actor_sub: str,
    scopes: list[str],
    before_payload: Any,
    after_payload: Any,
    result: str,
    dry_run: bool,
    metadata: dict[str, Any] | None = None,
) -> ContextWriteAudit:
    row = ContextWriteAudit(
        workspace_id=workspace_id,
        project_id=project_id,
        task_id=task_id,
        tool_name=tool_name,
        subject_id=subject_id,
        request_id=request_id,
        actor_sub=actor_sub,
        scopes_json=scopes,
        before_hash=stable_hash(before_payload) if before_payload is not None else None,
        after_hash=stable_hash(after_payload) if after_payload is not None else None,
        result=result,
        dry_run=dry_run,
        metadata_json=metadata or {},
    )
    db.add(row)
    # WP-0.4: sin commit propio; el commit único del pipeline de escritura
    # (hoy en _write_audit_and_filter) persiste dominio + auditoría atómicamente.
    db.flush()
    db.refresh(row)
    return row

