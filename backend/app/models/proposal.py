import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

# Lifecycle canónico del objeto de deliberación.
PROPOSAL_STATUSES = ("proposed", "in_review", "ratified", "rejected", "superseded")
PROPOSAL_TARGET_KINDS = ("decision", "context_item")


class Proposal(Base):
    """Estado de propuesta/deliberación (Paso 1 del ADR de ratificación).

    La *decisión* es la transición ``in_review -> ratified``. ``ApprovedDecision``
    pasa a ser el resultado de una Proposal ratificada. Ver
    ``docs/context/adr/ADR-deliberative-context-ratification.md``.
    """

    __tablename__ = "proposals"
    __table_args__ = (
        CheckConstraint(
            "status in ('proposed','in_review','ratified','rejected','superseded')",
            name="ck_proposals_status",
        ),
        CheckConstraint(
            "target_kind in ('decision','context_item')",
            name="ck_proposals_target_kind",
        ),
        Index("ix_proposals_ws_status", "workspace_id", "status"),
        Index("ix_proposals_target", "workspace_id", "target_kind", "target_key"),
        Index(
            "uq_proposals_idem",
            "workspace_id",
            "idempotency_key",
            unique=True,
            postgresql_where=text("idempotency_key IS NOT NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
    )
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=True,
    )
    task_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tasks.id", ondelete="SET NULL"),
        nullable=True,
    )
    proposer_consumer_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("consumers.id", ondelete="SET NULL"),
        nullable=True,
    )
    target_kind: Mapped[str] = mapped_column(Text, nullable=False)
    target_key: Mapped[str] = mapped_column(Text, nullable=False)
    proposed_payload: Mapped[dict] = mapped_column(
        JSONB,
        nullable=False,
        server_default=text("'{}'::jsonb"),
    )
    rationale: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'proposed'"))
    ratified_decision_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("approved_decisions.id", ondelete="SET NULL"),
        nullable=True,
    )
    ratified_by: Mapped[str | None] = mapped_column(Text, nullable=True)
    ratified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    superseded_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("proposals.id", ondelete="SET NULL"),
        nullable=True,
    )
    idempotency_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
