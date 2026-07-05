"""Paso 2 — deliberation trail sobre ``events`` (append-only).

Registra el *porqué* de cada paso de una Proposal, ligado por ``events.proposal_id``.
Complementa el hash del *qué* que ya guarda ``ContextWriteAudit``.
"""
from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.event import Event
from app.models.proposal import Proposal

PROPOSAL_EVENT_TYPES = (
    "proposal.raised",
    "proposal.objected",
    "proposal.counter",
    "proposal.ratified",
    "proposal.rejected",
)


def record_proposal_event(
    db: Session,
    *,
    proposal: Proposal,
    event_type: str,
    summary: str,
    source: str = "mcp",
    severity: str = "info",
    consumer_id: UUID | None = None,
    payload: dict[str, Any] | None = None,
) -> Event:
    if event_type not in PROPOSAL_EVENT_TYPES:
        raise ValueError(f"event_type de proposal inválido: {event_type!r}")
    if proposal.task_id is None or proposal.project_id is None:
        raise ValueError("La Proposal debe estar task/project-scoped para registrar el trail")

    event = Event(
        task_id=proposal.task_id,
        workspace_id=proposal.workspace_id,
        project_id=proposal.project_id,
        consumer_id=consumer_id,
        proposal_id=proposal.id,
        event_type=event_type,
        summary=summary,
        source=source,
        severity=severity,
        payload_json={
            **(payload or {}),
            "proposal_id": str(proposal.id),
            "target_kind": proposal.target_kind,
            "target_key": proposal.target_key,
        },
    )
    db.add(event)
    db.flush()
    return event


def list_deliberation_trail(db: Session, *, proposal_id: UUID) -> list[Event]:
    stmt = (
        select(Event)
        .where(Event.proposal_id == proposal_id)
        .order_by(Event.event_ts.asc(), Event.created_at.asc())
    )
    return list(db.execute(stmt).scalars().all())
