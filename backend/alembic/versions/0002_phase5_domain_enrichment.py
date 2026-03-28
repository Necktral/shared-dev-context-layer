"""phase 5 domain enrichment

Revision ID: 0002_phase5_domain_enrichment
Revises: 0001_init
Create Date: 2026-03-28 00:30:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0002_phase5_domain_enrichment"
down_revision: str | None = "0001_init"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "validation_runs",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("task_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("validation_type", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("details", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("executed_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_validation_runs_task_id", "validation_runs", ["task_id"], unique=False)
    op.create_index("ix_validation_runs_executed_at", "validation_runs", ["executed_at"], unique=False)

    op.add_column("tasks", sa.Column("current_phase", sa.Text(), nullable=True))

    op.add_column(
        "approved_decisions",
        sa.Column("decision_key", sa.Text(), nullable=True),
    )
    op.add_column(
        "approved_decisions",
        sa.Column("title", sa.Text(), nullable=True),
    )
    op.add_column(
        "approved_decisions",
        sa.Column("category", sa.Text(), nullable=True),
    )
    op.add_column(
        "approved_decisions",
        sa.Column("approved_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
    )
    op.add_column(
        "approved_decisions",
        sa.Column("approved_by", sa.Text(), server_default=sa.text("'WIS'"), nullable=True),
    )
    op.add_column(
        "approved_decisions",
        sa.Column("superseded_by", postgresql.UUID(as_uuid=True), nullable=True),
    )

    op.execute(
        """
        UPDATE approved_decisions
        SET
          decision_key = COALESCE(decision_key, 'legacy.' || id::text),
          title = COALESCE(title, left(decision, 120)),
          category = COALESCE(category, 'architecture'),
          approved_at = COALESCE(approved_at, created_at, now()),
          approved_by = COALESCE(approved_by, 'WIS')
        """
    )
    op.alter_column("approved_decisions", "decision_key", nullable=False)
    op.alter_column("approved_decisions", "title", nullable=False)
    op.alter_column("approved_decisions", "category", nullable=False)
    op.alter_column("approved_decisions", "approved_at", nullable=False)
    op.alter_column("approved_decisions", "approved_by", nullable=False)
    op.create_index(
        "uq_approved_decisions_task_decision_key",
        "approved_decisions",
        ["task_id", "decision_key"],
        unique=True,
    )

    op.add_column(
        "events",
        sa.Column(
            "payload_json",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=True,
        ),
    )
    op.add_column(
        "events",
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
    )
    op.execute(
        """
        UPDATE events
        SET
          payload_json = COALESCE(payload_json, metadata_json, '{}'::jsonb),
          created_at = COALESCE(created_at, event_ts, now())
        """
    )
    op.alter_column("events", "payload_json", nullable=False)
    op.alter_column("events", "created_at", nullable=False)
    op.create_index("ix_events_created_at", "events", ["created_at"], unique=False)

    op.add_column(
        "context_snapshots",
        sa.Column("generated_from", sa.Text(), server_default=sa.text("'unknown'"), nullable=True),
    )
    op.execute(
        """
        UPDATE context_snapshots
        SET generated_from = COALESCE(generated_from, 'legacy')
        """
    )
    op.alter_column("context_snapshots", "generated_from", nullable=False)


def downgrade() -> None:
    op.drop_column("context_snapshots", "generated_from")

    op.drop_index("ix_events_created_at", table_name="events")
    op.drop_column("events", "created_at")
    op.drop_column("events", "payload_json")

    op.drop_index("uq_approved_decisions_task_decision_key", table_name="approved_decisions")
    op.drop_column("approved_decisions", "superseded_by")
    op.drop_column("approved_decisions", "approved_by")
    op.drop_column("approved_decisions", "approved_at")
    op.drop_column("approved_decisions", "category")
    op.drop_column("approved_decisions", "title")
    op.drop_column("approved_decisions", "decision_key")

    op.drop_column("tasks", "current_phase")

    op.drop_index("ix_validation_runs_executed_at", table_name="validation_runs")
    op.drop_index("ix_validation_runs_task_id", table_name="validation_runs")
    op.drop_table("validation_runs")
