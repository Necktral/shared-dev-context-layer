"""initial v1 schema

Revision ID: 0001_init
Revises:
Create Date: 2026-03-28 00:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0001_init"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")

    op.create_table(
        "tasks",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("goal", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("priority", sa.Text(), nullable=False),
        sa.Column("branch", sa.Text(), nullable=True),
        sa.Column("repo", sa.Text(), nullable=True),
        sa.Column("next_action", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_tasks_is_active", "tasks", ["is_active"], unique=False)
    op.create_index(
        "uq_tasks_single_active",
        "tasks",
        ["is_active"],
        unique=True,
        postgresql_where=sa.text("is_active = true"),
    )

    op.create_table(
        "approved_decisions",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("task_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("decision", sa.Text(), nullable=False),
        sa.Column("rationale", sa.Text(), nullable=False),
        sa.Column("constraints_json", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_approved_decisions_task_id", "approved_decisions", ["task_id"], unique=False)
    op.create_index("ix_approved_decisions_created_at", "approved_decisions", ["created_at"], unique=False)

    op.create_table(
        "events",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("task_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("event_type", sa.Text(), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("severity", sa.Text(), nullable=False),
        sa.Column("metadata_json", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("event_ts", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_events_task_id", "events", ["task_id"], unique=False)
    op.create_index("ix_events_event_ts", "events", ["event_ts"], unique=False)

    op.create_table(
        "context_snapshots",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("task_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("snapshot_type", sa.Text(), nullable=False),
        sa.Column("snapshot_content", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("policy_applied", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_context_snapshots_task_id", "context_snapshots", ["task_id"], unique=False)
    op.create_index("ix_context_snapshots_created_at", "context_snapshots", ["created_at"], unique=False)

    op.create_table(
        "publish_audit",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("task_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("destination", sa.Text(), nullable=False),
        sa.Column("package_type", sa.Text(), nullable=False),
        sa.Column("fields_included", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'[]'::jsonb"), nullable=False),
        sa.Column("fields_redacted", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'[]'::jsonb"), nullable=False),
        sa.Column("result", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_publish_audit_task_id", "publish_audit", ["task_id"], unique=False)
    op.create_index("ix_publish_audit_created_at", "publish_audit", ["created_at"], unique=False)

    op.create_table(
        "policy_state",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("sync_enabled", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("mode", sa.Text(), nullable=False),
        sa.Column("scope", sa.Text(), nullable=False),
        sa.Column("redaction_level", sa.Text(), nullable=False),
        sa.Column("approval_mode", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_policy_state_updated_at", "policy_state", ["updated_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_policy_state_updated_at", table_name="policy_state")
    op.drop_table("policy_state")

    op.drop_index("ix_publish_audit_created_at", table_name="publish_audit")
    op.drop_index("ix_publish_audit_task_id", table_name="publish_audit")
    op.drop_table("publish_audit")

    op.drop_index("ix_context_snapshots_created_at", table_name="context_snapshots")
    op.drop_index("ix_context_snapshots_task_id", table_name="context_snapshots")
    op.drop_table("context_snapshots")

    op.drop_index("ix_events_event_ts", table_name="events")
    op.drop_index("ix_events_task_id", table_name="events")
    op.drop_table("events")

    op.drop_index("ix_approved_decisions_created_at", table_name="approved_decisions")
    op.drop_index("ix_approved_decisions_task_id", table_name="approved_decisions")
    op.drop_table("approved_decisions")

    op.drop_index("uq_tasks_single_active", table_name="tasks")
    op.drop_index("ix_tasks_is_active", table_name="tasks")
    op.drop_table("tasks")
