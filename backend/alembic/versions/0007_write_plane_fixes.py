"""write plane fixes — Fase 0 (WP-0.1, comparte 0.2/0.4/0.6)

Reúne en una sola migración de Fase 0:
- (a) data-fix: libera las request_id reales quemadas por dry_run histórico
      (evita IntegrityError contra uq_context_write_audit_request cuando un commit
      posterior reusa esa misma key). Ver WP-0.1 / hallazgo F01.
- (b) índice parcial de replay: soporta el lookup de replay filtrado por NOT dry_run.
- (c) publish_audit multi-scope + task_id nullable (F14): permite auditar ratify/brief
      sobre scopes sin task activa.
- (d) policy_state.approval_mode nullable (F20/F35): approval_mode es campo muerto,
      reemplazado por approval_policy_json; deja de ser obligatorio.

Revision ID: 0007_write_plane_fixes
Revises: 0006_deliberative_columns
Create Date: 2026-07-04 00:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0007_write_plane_fixes"
down_revision: str | None = "0006_deliberative_columns"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # (a) data-fix — normaliza las filas dry_run que quemaron una request_id real.
    #     A partir de ahora todo dry_run lleva request_id sintético 'dryrun-<uuid>'
    #     (fix de código en el server), así que este UPDATE solo actúa sobre histórico.
    op.execute(
        "UPDATE context_write_audit "
        "SET request_id = 'dryrun-' || gen_random_uuid() "
        "WHERE dry_run AND request_id NOT LIKE 'dryrun-%'"
    )

    # (b) índice parcial de replay — solo commits reales participan en el replay.
    op.create_index(
        "ix_context_write_audit_replay",
        "context_write_audit",
        ["workspace_id", "tool_name", "request_id"],
        unique=False,
        postgresql_where=sa.text("NOT dry_run"),
    )

    # (c) publish_audit: multi-scope + task_id nullable.
    op.add_column(
        "publish_audit",
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        "publish_audit",
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_publish_audit_workspace", "publish_audit", "workspaces", ["workspace_id"], ["id"], ondelete="CASCADE"
    )
    op.create_foreign_key(
        "fk_publish_audit_project", "publish_audit", "projects", ["project_id"], ["id"], ondelete="CASCADE"
    )
    op.create_index("ix_publish_audit_workspace_id", "publish_audit", ["workspace_id"], unique=False)
    op.create_index("ix_publish_audit_project_id", "publish_audit", ["project_id"], unique=False)
    op.alter_column("publish_audit", "task_id", existing_type=postgresql.UUID(as_uuid=True), nullable=True)

    # (d) policy_state.approval_mode nullable (campo muerto).
    op.alter_column("policy_state", "approval_mode", existing_type=sa.Text(), nullable=True)


def downgrade() -> None:
    # (d)
    op.alter_column("policy_state", "approval_mode", existing_type=sa.Text(), nullable=False)  # aborta si hay NULLs (documentado)

    # (c) — aborta si hay filas publish_audit con task_id IS NULL (documentado).
    op.drop_index("ix_publish_audit_project_id", table_name="publish_audit")
    op.drop_index("ix_publish_audit_workspace_id", table_name="publish_audit")
    op.drop_constraint("fk_publish_audit_project", "publish_audit", type_="foreignkey")
    op.drop_constraint("fk_publish_audit_workspace", "publish_audit", type_="foreignkey")
    op.drop_column("publish_audit", "project_id")
    op.drop_column("publish_audit", "workspace_id")
    op.alter_column("publish_audit", "task_id", existing_type=postgresql.UUID(as_uuid=True), nullable=False)

    # (b)
    op.drop_index("ix_context_write_audit_replay", table_name="context_write_audit")

    # (a) es irreversible por diseño: las request_id originales quemadas no se recuperan (no-op).
