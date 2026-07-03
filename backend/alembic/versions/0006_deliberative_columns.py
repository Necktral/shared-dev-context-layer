"""deliberative ratification - additive columns (Pasos 2, 4, 6)

Revision ID: 0006_deliberative_columns
Revises: 0005_deliberative_ratification
Create Date: 2026-07-01 00:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0006_deliberative_columns"
down_revision: str | None = "0005_deliberative_ratification"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Paso 2 — deliberation trail sobre events (append-only).
    op.add_column("events", sa.Column("proposal_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_events_proposal", "events", "proposals", ["proposal_id"], ["id"], ondelete="SET NULL"
    )
    op.create_index("ix_events_proposal_id", "events", ["proposal_id"], unique=False)

    # Paso 4 — granularidad de aprobación (reemplaza approval_mode global).
    op.add_column(
        "policy_state",
        sa.Column(
            "approval_policy_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )

    # Paso 6 — coherencia / staleness sobre snapshots.
    op.add_column("context_snapshots", sa.Column("is_current", sa.Boolean(), nullable=False, server_default=sa.text("true")))
    op.add_column("context_snapshots", sa.Column("version", sa.Integer(), nullable=False, server_default=sa.text("1")))

    # ApprovedDecision pasa a ser resultado de una Proposal ratificada.
    op.add_column("approved_decisions", sa.Column("proposal_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_approved_decisions_proposal",
        "approved_decisions",
        "proposals",
        ["proposal_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_approved_decisions_proposal", "approved_decisions", type_="foreignkey")
    op.drop_column("approved_decisions", "proposal_id")
    op.drop_column("context_snapshots", "version")
    op.drop_column("context_snapshots", "is_current")
    op.drop_column("policy_state", "approval_policy_json")
    op.drop_index("ix_events_proposal_id", table_name="events")
    op.drop_constraint("fk_events_proposal", "events", type_="foreignkey")
    op.drop_column("events", "proposal_id")
