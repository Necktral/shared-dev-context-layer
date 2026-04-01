"""phase 4 mcp write plane

Revision ID: 0004_phase4_mcp_write_plane
Revises: 0003_multi_scope_read_model
Create Date: 2026-03-31 00:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0004_phase4_mcp_write_plane"
down_revision: str | None = "0003_multi_scope_read_model"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "context_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("task_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("item_key", sa.Text(), nullable=False),
        sa.Column("item_type", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("content_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("labels_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'active'")),
        sa.Column("version", sa.Integer(), nullable=False, server_default=sa.text("1")),
        sa.Column("created_by", sa.Text(), nullable=True),
        sa.Column("updated_by", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("workspace_id", "item_key", name="uq_context_items_workspace_item_key"),
    )
    op.create_index("ix_context_items_workspace_id", "context_items", ["workspace_id"], unique=False)
    op.create_index("ix_context_items_project_id", "context_items", ["project_id"], unique=False)
    op.create_index("ix_context_items_task_id", "context_items", ["task_id"], unique=False)
    op.create_index("ix_context_items_status", "context_items", ["status"], unique=False)
    op.create_index("ix_context_items_item_type", "context_items", ["item_type"], unique=False)

    op.create_table(
        "context_item_links",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("source_item_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("target_item_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("relation", sa.Text(), nullable=False),
        sa.Column("metadata_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_by", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["source_item_id"], ["context_items.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["target_item_id"], ["context_items.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "workspace_id",
            "source_item_id",
            "target_item_id",
            "relation",
            name="uq_context_item_links_relation",
        ),
    )
    op.create_index("ix_context_item_links_workspace_id", "context_item_links", ["workspace_id"], unique=False)
    op.create_index("ix_context_item_links_source_item_id", "context_item_links", ["source_item_id"], unique=False)
    op.create_index("ix_context_item_links_target_item_id", "context_item_links", ["target_item_id"], unique=False)

    op.create_table(
        "context_item_labels",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("item_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("label", sa.Text(), nullable=False),
        sa.Column("created_by", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["item_id"], ["context_items.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("workspace_id", "item_id", "label", name="uq_context_item_labels_item_label"),
    )
    op.create_index("ix_context_item_labels_workspace_id", "context_item_labels", ["workspace_id"], unique=False)
    op.create_index("ix_context_item_labels_item_id", "context_item_labels", ["item_id"], unique=False)
    op.create_index("ix_context_item_labels_label", "context_item_labels", ["label"], unique=False)

    op.create_table(
        "context_sync_batches",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("task_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("idempotency_key", sa.Text(), nullable=False),
        sa.Column("operation_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'draft'")),
        sa.Column("dry_run", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("summary_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("requested_by", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("workspace_id", "idempotency_key", name="uq_context_sync_batches_idempotency"),
    )
    op.create_index("ix_context_sync_batches_workspace_id", "context_sync_batches", ["workspace_id"], unique=False)
    op.create_index("ix_context_sync_batches_project_id", "context_sync_batches", ["project_id"], unique=False)
    op.create_index("ix_context_sync_batches_task_id", "context_sync_batches", ["task_id"], unique=False)
    op.create_index("ix_context_sync_batches_status", "context_sync_batches", ["status"], unique=False)

    op.create_table(
        "context_write_audit",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("task_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("tool_name", sa.Text(), nullable=False),
        sa.Column("subject_id", sa.Text(), nullable=True),
        sa.Column("request_id", sa.Text(), nullable=False),
        sa.Column("actor_sub", sa.Text(), nullable=False),
        sa.Column("scopes_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("before_hash", sa.Text(), nullable=True),
        sa.Column("after_hash", sa.Text(), nullable=True),
        sa.Column("result", sa.Text(), nullable=False),
        sa.Column("dry_run", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("metadata_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("workspace_id", "tool_name", "request_id", name="uq_context_write_audit_request"),
    )
    op.create_index("ix_context_write_audit_workspace_id", "context_write_audit", ["workspace_id"], unique=False)
    op.create_index("ix_context_write_audit_project_id", "context_write_audit", ["project_id"], unique=False)
    op.create_index("ix_context_write_audit_task_id", "context_write_audit", ["task_id"], unique=False)
    op.create_index("ix_context_write_audit_tool_name", "context_write_audit", ["tool_name"], unique=False)
    op.create_index("ix_context_write_audit_result", "context_write_audit", ["result"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_context_write_audit_result", table_name="context_write_audit")
    op.drop_index("ix_context_write_audit_tool_name", table_name="context_write_audit")
    op.drop_index("ix_context_write_audit_task_id", table_name="context_write_audit")
    op.drop_index("ix_context_write_audit_project_id", table_name="context_write_audit")
    op.drop_index("ix_context_write_audit_workspace_id", table_name="context_write_audit")
    op.drop_table("context_write_audit")

    op.drop_index("ix_context_sync_batches_status", table_name="context_sync_batches")
    op.drop_index("ix_context_sync_batches_task_id", table_name="context_sync_batches")
    op.drop_index("ix_context_sync_batches_project_id", table_name="context_sync_batches")
    op.drop_index("ix_context_sync_batches_workspace_id", table_name="context_sync_batches")
    op.drop_table("context_sync_batches")

    op.drop_index("ix_context_item_labels_label", table_name="context_item_labels")
    op.drop_index("ix_context_item_labels_item_id", table_name="context_item_labels")
    op.drop_index("ix_context_item_labels_workspace_id", table_name="context_item_labels")
    op.drop_table("context_item_labels")

    op.drop_index("ix_context_item_links_target_item_id", table_name="context_item_links")
    op.drop_index("ix_context_item_links_source_item_id", table_name="context_item_links")
    op.drop_index("ix_context_item_links_workspace_id", table_name="context_item_links")
    op.drop_table("context_item_links")

    op.drop_index("ix_context_items_item_type", table_name="context_items")
    op.drop_index("ix_context_items_status", table_name="context_items")
    op.drop_index("ix_context_items_task_id", table_name="context_items")
    op.drop_index("ix_context_items_project_id", table_name="context_items")
    op.drop_index("ix_context_items_workspace_id", table_name="context_items")
    op.drop_table("context_items")

