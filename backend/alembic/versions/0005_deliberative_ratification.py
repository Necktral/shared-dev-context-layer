"""deliberative ratification - proposals table (Paso 1)

Revision ID: 0005_deliberative_ratification
Revises: 0004_phase4_mcp_write_plane
Create Date: 2026-07-01 00:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0005_deliberative_ratification"
down_revision: str | None = "0004_phase4_mcp_write_plane"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "proposals",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("task_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("proposer_consumer_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("target_kind", sa.Text(), nullable=False),
        sa.Column("target_key", sa.Text(), nullable=False),
        sa.Column("proposed_payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("rationale", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'proposed'")),
        sa.Column("ratified_decision_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("ratified_by", sa.Text(), nullable=True),
        sa.Column("ratified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("superseded_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("idempotency_key", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["proposer_consumer_id"], ["consumers.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["ratified_decision_id"], ["approved_decisions.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["superseded_by"], ["proposals.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "status in ('proposed','in_review','ratified','rejected','superseded')",
            name="ck_proposals_status",
        ),
        sa.CheckConstraint(
            "target_kind in ('decision','context_item')",
            name="ck_proposals_target_kind",
        ),
    )
    op.create_index("ix_proposals_ws_status", "proposals", ["workspace_id", "status"], unique=False)
    op.create_index("ix_proposals_target", "proposals", ["workspace_id", "target_kind", "target_key"], unique=False)
    op.create_index(
        "uq_proposals_idem",
        "proposals",
        ["workspace_id", "idempotency_key"],
        unique=True,
        postgresql_where=sa.text("idempotency_key IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_proposals_idem", table_name="proposals")
    op.drop_index("ix_proposals_target", table_name="proposals")
    op.drop_index("ix_proposals_ws_status", table_name="proposals")
    op.drop_table("proposals")
