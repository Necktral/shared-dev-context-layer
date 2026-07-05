"""Servicio de dominio para el objeto ``Proposal`` (Paso 1 del ADR de ratificación).

Contiene solo lógica de dominio + validación del lifecycle. NO toca el write path
MCP todavía (eso es el Paso 3). Todas las escrituras son ``flush`` dentro de la
transacción del caller; el commit lo decide quien invoca.
"""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.proposal import PROPOSAL_STATUSES, PROPOSAL_TARGET_KINDS, Proposal

# Transiciones permitidas del lifecycle. Los estados terminales mapean a set vacío.
ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    "proposed": {"in_review", "rejected", "superseded"},
    "in_review": {"ratified", "rejected", "superseded"},
    "ratified": set(),
    "rejected": set(),
    "superseded": set(),
}


class InvalidProposalTransition(ValueError):
    """Transición de estado no permitida por el lifecycle."""


class InvalidProposalInput(ValueError):
    """Entrada inválida al crear o transicionar una Proposal."""


def create_proposal(
    db: Session,
    *,
    workspace_id: UUID,
    target_kind: str,
    target_key: str,
    rationale: str,
    proposed_payload: dict | None = None,
    project_id: UUID | None = None,
    task_id: UUID | None = None,
    proposer_consumer_id: UUID | None = None,
    idempotency_key: str | None = None,
) -> Proposal:
    if target_kind not in PROPOSAL_TARGET_KINDS:
        raise InvalidProposalInput(f"target_kind inválido: {target_kind!r}")
    if not target_key or not target_key.strip():
        raise InvalidProposalInput("target_key es obligatorio")
    if not rationale or not rationale.strip():
        raise InvalidProposalInput("rationale es obligatorio")

    if idempotency_key:
        existing = (
            db.execute(
                select(Proposal).where(
                    Proposal.workspace_id == workspace_id,
                    Proposal.idempotency_key == idempotency_key,
                )
            )
            .scalars()
            .first()
        )
        if existing is not None:
            return existing

    proposal = Proposal(
        workspace_id=workspace_id,
        project_id=project_id,
        task_id=task_id,
        proposer_consumer_id=proposer_consumer_id,
        target_kind=target_kind,
        target_key=target_key,
        proposed_payload=proposed_payload or {},
        rationale=rationale,
        status="proposed",
        idempotency_key=idempotency_key,
    )
    db.add(proposal)
    db.flush()
    return proposal


def transition_proposal(
    db: Session,
    proposal: Proposal,
    new_status: str,
    *,
    ratified_by: str | None = None,
    ratified_decision_id: UUID | None = None,
    superseded_by: UUID | None = None,
) -> Proposal:
    if new_status not in PROPOSAL_STATUSES:
        raise InvalidProposalInput(f"status inválido: {new_status!r}")
    if new_status not in ALLOWED_TRANSITIONS.get(proposal.status, set()):
        raise InvalidProposalTransition(f"{proposal.status} -> {new_status} no permitido")

    if new_status == "ratified":
        # I1: la ratificación exige identidad humana verificada, no un default.
        if not ratified_by or not ratified_by.strip():
            raise InvalidProposalInput(
                "ratified_by (identidad humana verificada) es obligatorio para ratificar"
            )
        proposal.ratified_by = ratified_by
        proposal.ratified_at = datetime.now(timezone.utc)
        proposal.ratified_decision_id = ratified_decision_id

    if new_status == "superseded":
        proposal.superseded_by = superseded_by

    proposal.status = new_status
    db.flush()
    return proposal


def get_proposal(db: Session, proposal_id: UUID) -> Proposal | None:
    return db.get(Proposal, proposal_id)


def list_proposals_for_target(
    db: Session,
    *,
    workspace_id: UUID,
    target_kind: str,
    target_key: str,
    statuses: list[str] | None = None,
) -> list[Proposal]:
    stmt = select(Proposal).where(
        Proposal.workspace_id == workspace_id,
        Proposal.target_kind == target_kind,
        Proposal.target_key == target_key,
    )
    if statuses:
        stmt = stmt.where(Proposal.status.in_(statuses))
    return list(db.execute(stmt.order_by(Proposal.created_at.desc())).scalars().all())


def find_ratified_proposal(
    db: Session,
    *,
    workspace_id: UUID,
    target_kind: str,
    target_key: str,
) -> Proposal | None:
    """Hook para el gate de ratificación (Paso 3): la Proposal ratificada más
    reciente para el target, o None."""
    stmt = (
        select(Proposal)
        .where(
            Proposal.workspace_id == workspace_id,
            Proposal.target_kind == target_kind,
            Proposal.target_key == target_key,
            Proposal.status == "ratified",
        )
        .order_by(Proposal.ratified_at.desc())
    )
    return db.execute(stmt).scalars().first()
