import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ContextSnapshot(Base):
    __tablename__ = "context_snapshots"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    task_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tasks.id", ondelete="CASCADE"),
        nullable=False,
    )
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    consumer_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("consumers.id", ondelete="SET NULL"),
        nullable=True,
    )
    execution_session_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("execution_sessions.id", ondelete="SET NULL"),
        nullable=True,
    )
    snapshot_type: Mapped[str] = mapped_column(Text, nullable=False)
    snapshot_content: Mapped[dict] = mapped_column(JSONB, nullable=False)
    policy_applied: Mapped[str] = mapped_column(Text, nullable=False)
    generated_from: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'unknown'"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
