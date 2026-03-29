"""phase 2 multi-scope read model

Revision ID: 0003_multi_scope_read_model
Revises: 0002_phase5_domain_enrichment
Create Date: 2026-03-29 00:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0003_multi_scope_read_model"
down_revision: str | None = "0002_phase5_domain_enrichment"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CANON_WORKSPACE_ID = "11111111-1111-4111-8111-111111111111"
CANON_PROJECT_ID = "22222222-2222-4222-8222-222222222222"
CONSUMER_CHATGPT_ID = "33333333-3333-4333-8333-333333333333"
CONSUMER_VSCODE_ID = "44444444-4444-4444-8444-444444444444"
CONSUMER_CODEX_ID = "55555555-5555-4555-8555-555555555555"
CONSUMER_COPILOT_ID = "66666666-6666-4666-8666-666666666666"
CANON_SESSION_ID = "77777777-7777-4777-8777-777777777777"
CANON_SCOPE_ID = "88888888-8888-4888-8888-888888888888"


def upgrade() -> None:
    op.create_table(
        "workspaces",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("workspace_key", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("workspace_key", name="uq_workspaces_workspace_key"),
    )
    op.create_index("ix_workspaces_is_active", "workspaces", ["is_active"], unique=False)

    op.create_table(
        "projects",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_key", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("repo_url", sa.Text(), nullable=True),
        sa.Column("default_branch", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'active'")),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("workspace_id", "project_key", name="uq_projects_workspace_project_key"),
    )
    op.create_index("ix_projects_workspace_id", "projects", ["workspace_id"], unique=False)
    op.create_index("ix_projects_is_active", "projects", ["is_active"], unique=False)

    op.create_table(
        "consumers",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("consumer_type", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("version", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("consumer_type", name="uq_consumers_consumer_type"),
    )

    op.create_table(
        "execution_sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("consumer_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("task_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("session_key", sa.Text(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'active'")),
        sa.ForeignKeyConstraint(["consumer_id"], ["consumers.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("session_key", name="uq_execution_sessions_session_key"),
    )
    op.create_index("ix_execution_sessions_consumer_id", "execution_sessions", ["consumer_id"], unique=False)
    op.create_index("ix_execution_sessions_started_at", "execution_sessions", ["started_at"], unique=False)

    op.create_table(
        "context_scopes",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("task_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("consumer_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("execution_session_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("scope_kind", sa.Text(), nullable=False, server_default=sa.text("'task'")),
        sa.Column("is_current", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("resolved_by", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["consumer_id"], ["consumers.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["execution_session_id"], ["execution_sessions.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_context_scopes_workspace_id", "context_scopes", ["workspace_id"], unique=False)
    op.create_index("ix_context_scopes_project_id", "context_scopes", ["project_id"], unique=False)
    op.create_index("ix_context_scopes_task_id", "context_scopes", ["task_id"], unique=False)
    op.create_index("ix_context_scopes_consumer_id", "context_scopes", ["consumer_id"], unique=False)
    op.create_index(
        "uq_context_scopes_single_current",
        "context_scopes",
        ["is_current"],
        unique=True,
        postgresql_where=sa.text("is_current = true"),
    )

    bind = op.get_bind()

    bind.execute(
        sa.text(
            """
            INSERT INTO workspaces (id, workspace_key, name, description, is_active)
            VALUES (:id, 'default', 'Default Workspace', 'Canonical workspace generated by migration 0003', true)
            ON CONFLICT (workspace_key) DO NOTHING
            """
        ),
        {"id": CANON_WORKSPACE_ID},
    )
    bind.execute(
        sa.text(
            """
            INSERT INTO projects (id, workspace_id, project_key, name, repo_url, default_branch, status, is_active)
            VALUES (:id, :workspace_id, 'default_project', 'Default Project', 'shared-dev-context-layer', 'main', 'active', true)
            ON CONFLICT (workspace_id, project_key) DO NOTHING
            """
        ),
        {"id": CANON_PROJECT_ID, "workspace_id": CANON_WORKSPACE_ID},
    )
    bind.execute(
        sa.text(
            """
            INSERT INTO consumers (id, consumer_type, name, version, is_active)
            VALUES
              (:chatgpt_id, 'chatgpt', 'ChatGPT Developer Mode', 'v1', true),
              (:vscode_id, 'vscode_extension', 'VS Code Extension', 'v1', true),
              (:codex_id, 'codex', 'Codex CLI', 'v1', true),
              (:copilot_id, 'github_copilot', 'GitHub Copilot', 'v1', true)
            ON CONFLICT (consumer_type) DO NOTHING
            """
        ),
        {
            "chatgpt_id": CONSUMER_CHATGPT_ID,
            "vscode_id": CONSUMER_VSCODE_ID,
            "codex_id": CONSUMER_CODEX_ID,
            "copilot_id": CONSUMER_COPILOT_ID,
        },
    )

    op.add_column("tasks", sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("tasks", sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key("fk_tasks_workspace_id", "tasks", "workspaces", ["workspace_id"], ["id"], ondelete="RESTRICT")
    op.create_foreign_key("fk_tasks_project_id", "tasks", "projects", ["project_id"], ["id"], ondelete="RESTRICT")
    bind.execute(
        sa.text(
            """
            UPDATE tasks
            SET workspace_id = :workspace_id
            WHERE workspace_id IS NULL
            """
        ),
        {"workspace_id": CANON_WORKSPACE_ID},
    )
    bind.execute(
        sa.text(
            """
            UPDATE tasks
            SET project_id = :project_id
            WHERE project_id IS NULL
            """
        ),
        {"project_id": CANON_PROJECT_ID},
    )
    op.alter_column("tasks", "workspace_id", nullable=False)
    op.alter_column("tasks", "project_id", nullable=False)
    op.create_index("ix_tasks_workspace_id", "tasks", ["workspace_id"], unique=False)
    op.create_index("ix_tasks_project_id", "tasks", ["project_id"], unique=False)
    op.drop_index("uq_tasks_single_active", table_name="tasks")
    op.create_index(
        "uq_tasks_active_per_project",
        "tasks",
        ["project_id"],
        unique=True,
        postgresql_where=sa.text("is_active = true"),
    )

    op.add_column("approved_decisions", sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("approved_decisions", sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_approved_decisions_workspace_id",
        "approved_decisions",
        "workspaces",
        ["workspace_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "fk_approved_decisions_project_id",
        "approved_decisions",
        "projects",
        ["project_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.execute(
        """
        UPDATE approved_decisions ad
        SET
          workspace_id = t.workspace_id,
          project_id = t.project_id
        FROM tasks t
        WHERE ad.task_id = t.id
        """
    )
    bind.execute(
        sa.text(
            """
            UPDATE approved_decisions
            SET workspace_id = :workspace_id
            WHERE workspace_id IS NULL
            """
        ),
        {"workspace_id": CANON_WORKSPACE_ID},
    )
    op.alter_column("approved_decisions", "task_id", nullable=True)
    op.alter_column("approved_decisions", "workspace_id", nullable=False)
    op.drop_index("uq_approved_decisions_task_decision_key", table_name="approved_decisions")
    op.create_index("ix_approved_decisions_workspace_id", "approved_decisions", ["workspace_id"], unique=False)
    op.create_index("ix_approved_decisions_project_id", "approved_decisions", ["project_id"], unique=False)
    op.create_index(
        "uq_approved_decisions_task_decision_key",
        "approved_decisions",
        ["task_id", "decision_key"],
        unique=True,
        postgresql_where=sa.text("task_id IS NOT NULL"),
    )
    op.create_index(
        "uq_approved_decisions_project_decision_key",
        "approved_decisions",
        ["project_id", "decision_key"],
        unique=True,
        postgresql_where=sa.text("task_id IS NULL AND project_id IS NOT NULL"),
    )
    op.create_index(
        "uq_approved_decisions_workspace_decision_key",
        "approved_decisions",
        ["workspace_id", "decision_key"],
        unique=True,
        postgresql_where=sa.text("task_id IS NULL AND project_id IS NULL"),
    )

    op.add_column("events", sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("events", sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("events", sa.Column("consumer_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("events", sa.Column("execution_session_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key("fk_events_workspace_id", "events", "workspaces", ["workspace_id"], ["id"], ondelete="CASCADE")
    op.create_foreign_key("fk_events_project_id", "events", "projects", ["project_id"], ["id"], ondelete="CASCADE")
    op.create_foreign_key("fk_events_consumer_id", "events", "consumers", ["consumer_id"], ["id"], ondelete="SET NULL")
    op.create_foreign_key(
        "fk_events_execution_session_id",
        "events",
        "execution_sessions",
        ["execution_session_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.execute(
        """
        UPDATE events e
        SET
          workspace_id = t.workspace_id,
          project_id = t.project_id
        FROM tasks t
        WHERE e.task_id = t.id
        """
    )
    op.alter_column("events", "workspace_id", nullable=False)
    op.alter_column("events", "project_id", nullable=False)
    op.create_index("ix_events_workspace_id", "events", ["workspace_id"], unique=False)
    op.create_index("ix_events_project_id", "events", ["project_id"], unique=False)
    op.create_index("ix_events_consumer_id", "events", ["consumer_id"], unique=False)

    op.add_column("validation_runs", sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("validation_runs", sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("validation_runs", sa.Column("consumer_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("validation_runs", sa.Column("execution_session_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_validation_runs_workspace_id",
        "validation_runs",
        "workspaces",
        ["workspace_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "fk_validation_runs_project_id",
        "validation_runs",
        "projects",
        ["project_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "fk_validation_runs_consumer_id",
        "validation_runs",
        "consumers",
        ["consumer_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_validation_runs_execution_session_id",
        "validation_runs",
        "execution_sessions",
        ["execution_session_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.execute(
        """
        UPDATE validation_runs vr
        SET
          workspace_id = t.workspace_id,
          project_id = t.project_id
        FROM tasks t
        WHERE vr.task_id = t.id
        """
    )
    op.alter_column("validation_runs", "workspace_id", nullable=False)
    op.alter_column("validation_runs", "project_id", nullable=False)
    op.create_index("ix_validation_runs_workspace_id", "validation_runs", ["workspace_id"], unique=False)
    op.create_index("ix_validation_runs_project_id", "validation_runs", ["project_id"], unique=False)
    op.create_index("ix_validation_runs_consumer_id", "validation_runs", ["consumer_id"], unique=False)

    op.add_column("context_snapshots", sa.Column("workspace_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("context_snapshots", sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("context_snapshots", sa.Column("consumer_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("context_snapshots", sa.Column("execution_session_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_context_snapshots_workspace_id",
        "context_snapshots",
        "workspaces",
        ["workspace_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "fk_context_snapshots_project_id",
        "context_snapshots",
        "projects",
        ["project_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "fk_context_snapshots_consumer_id",
        "context_snapshots",
        "consumers",
        ["consumer_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_context_snapshots_execution_session_id",
        "context_snapshots",
        "execution_sessions",
        ["execution_session_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.execute(
        """
        UPDATE context_snapshots cs
        SET
          workspace_id = t.workspace_id,
          project_id = t.project_id
        FROM tasks t
        WHERE cs.task_id = t.id
        """
    )
    op.alter_column("context_snapshots", "workspace_id", nullable=False)
    op.alter_column("context_snapshots", "project_id", nullable=False)
    op.create_index("ix_context_snapshots_workspace_id", "context_snapshots", ["workspace_id"], unique=False)
    op.create_index("ix_context_snapshots_project_id", "context_snapshots", ["project_id"], unique=False)
    op.create_index("ix_context_snapshots_consumer_id", "context_snapshots", ["consumer_id"], unique=False)

    bind.execute(
        sa.text(
            """
            INSERT INTO execution_sessions (
              id, consumer_id, workspace_id, project_id, task_id, session_key, status
            )
            VALUES (
              :id, :consumer_id, :workspace_id, :project_id,
              (
                SELECT id FROM tasks WHERE is_active = true ORDER BY updated_at DESC LIMIT 1
              ),
              'canonical-chatgpt-session',
              'active'
            )
            ON CONFLICT (session_key) DO NOTHING
            """
        ),
        {
            "id": CANON_SESSION_ID,
            "consumer_id": CONSUMER_CHATGPT_ID,
            "workspace_id": CANON_WORKSPACE_ID,
            "project_id": CANON_PROJECT_ID,
        },
    )

    active_task = bind.execute(
        sa.text(
            """
            SELECT id, workspace_id, project_id
            FROM tasks
            WHERE is_active = true
            ORDER BY updated_at DESC
            LIMIT 1
            """
        )
    ).mappings().first()
    if active_task:
        workspace_id = active_task["workspace_id"]
        project_id = active_task["project_id"]
        task_id = active_task["id"]
    else:
        workspace_id = CANON_WORKSPACE_ID
        project_id = CANON_PROJECT_ID
        task_id = None

    bind.execute(sa.text("UPDATE context_scopes SET is_current = false WHERE is_current = true"))
    bind.execute(
        sa.text(
            """
            INSERT INTO context_scopes (
              id, workspace_id, project_id, task_id, consumer_id, execution_session_id, scope_kind, is_current, resolved_by
            )
            VALUES (
              :id, :workspace_id, :project_id, :task_id, :consumer_id, :session_id, 'task', true, 'migration_0003'
            )
            ON CONFLICT (id) DO NOTHING
            """
        ),
        {
            "id": CANON_SCOPE_ID,
            "workspace_id": workspace_id,
            "project_id": project_id,
            "task_id": task_id,
            "consumer_id": CONSUMER_CHATGPT_ID,
            "session_id": CANON_SESSION_ID,
        },
    )


def downgrade() -> None:
    op.drop_index("ix_context_snapshots_consumer_id", table_name="context_snapshots")
    op.drop_index("ix_context_snapshots_project_id", table_name="context_snapshots")
    op.drop_index("ix_context_snapshots_workspace_id", table_name="context_snapshots")
    op.drop_constraint("fk_context_snapshots_execution_session_id", "context_snapshots", type_="foreignkey")
    op.drop_constraint("fk_context_snapshots_consumer_id", "context_snapshots", type_="foreignkey")
    op.drop_constraint("fk_context_snapshots_project_id", "context_snapshots", type_="foreignkey")
    op.drop_constraint("fk_context_snapshots_workspace_id", "context_snapshots", type_="foreignkey")
    op.drop_column("context_snapshots", "execution_session_id")
    op.drop_column("context_snapshots", "consumer_id")
    op.drop_column("context_snapshots", "project_id")
    op.drop_column("context_snapshots", "workspace_id")

    op.drop_index("ix_validation_runs_consumer_id", table_name="validation_runs")
    op.drop_index("ix_validation_runs_project_id", table_name="validation_runs")
    op.drop_index("ix_validation_runs_workspace_id", table_name="validation_runs")
    op.drop_constraint("fk_validation_runs_execution_session_id", "validation_runs", type_="foreignkey")
    op.drop_constraint("fk_validation_runs_consumer_id", "validation_runs", type_="foreignkey")
    op.drop_constraint("fk_validation_runs_project_id", "validation_runs", type_="foreignkey")
    op.drop_constraint("fk_validation_runs_workspace_id", "validation_runs", type_="foreignkey")
    op.drop_column("validation_runs", "execution_session_id")
    op.drop_column("validation_runs", "consumer_id")
    op.drop_column("validation_runs", "project_id")
    op.drop_column("validation_runs", "workspace_id")

    op.drop_index("ix_events_consumer_id", table_name="events")
    op.drop_index("ix_events_project_id", table_name="events")
    op.drop_index("ix_events_workspace_id", table_name="events")
    op.drop_constraint("fk_events_execution_session_id", "events", type_="foreignkey")
    op.drop_constraint("fk_events_consumer_id", "events", type_="foreignkey")
    op.drop_constraint("fk_events_project_id", "events", type_="foreignkey")
    op.drop_constraint("fk_events_workspace_id", "events", type_="foreignkey")
    op.drop_column("events", "execution_session_id")
    op.drop_column("events", "consumer_id")
    op.drop_column("events", "project_id")
    op.drop_column("events", "workspace_id")

    op.drop_index("uq_approved_decisions_workspace_decision_key", table_name="approved_decisions")
    op.drop_index("uq_approved_decisions_project_decision_key", table_name="approved_decisions")
    op.drop_index("uq_approved_decisions_task_decision_key", table_name="approved_decisions")
    op.drop_index("ix_approved_decisions_project_id", table_name="approved_decisions")
    op.drop_index("ix_approved_decisions_workspace_id", table_name="approved_decisions")
    op.drop_constraint("fk_approved_decisions_project_id", "approved_decisions", type_="foreignkey")
    op.drop_constraint("fk_approved_decisions_workspace_id", "approved_decisions", type_="foreignkey")
    op.execute("DELETE FROM approved_decisions WHERE task_id IS NULL")
    op.alter_column("approved_decisions", "task_id", nullable=False)
    op.drop_column("approved_decisions", "project_id")
    op.drop_column("approved_decisions", "workspace_id")
    op.create_index(
        "uq_approved_decisions_task_decision_key",
        "approved_decisions",
        ["task_id", "decision_key"],
        unique=True,
    )

    op.drop_index("uq_tasks_active_per_project", table_name="tasks")
    op.create_index(
        "uq_tasks_single_active",
        "tasks",
        ["is_active"],
        unique=True,
        postgresql_where=sa.text("is_active = true"),
    )
    op.drop_index("ix_tasks_project_id", table_name="tasks")
    op.drop_index("ix_tasks_workspace_id", table_name="tasks")
    op.drop_constraint("fk_tasks_project_id", "tasks", type_="foreignkey")
    op.drop_constraint("fk_tasks_workspace_id", "tasks", type_="foreignkey")
    op.drop_column("tasks", "project_id")
    op.drop_column("tasks", "workspace_id")

    op.drop_index("uq_context_scopes_single_current", table_name="context_scopes")
    op.drop_index("ix_context_scopes_consumer_id", table_name="context_scopes")
    op.drop_index("ix_context_scopes_task_id", table_name="context_scopes")
    op.drop_index("ix_context_scopes_project_id", table_name="context_scopes")
    op.drop_index("ix_context_scopes_workspace_id", table_name="context_scopes")
    op.drop_table("context_scopes")

    op.drop_index("ix_execution_sessions_started_at", table_name="execution_sessions")
    op.drop_index("ix_execution_sessions_consumer_id", table_name="execution_sessions")
    op.drop_table("execution_sessions")

    op.drop_table("consumers")

    op.drop_index("ix_projects_is_active", table_name="projects")
    op.drop_index("ix_projects_workspace_id", table_name="projects")
    op.drop_table("projects")

    op.drop_index("ix_workspaces_is_active", table_name="workspaces")
    op.drop_table("workspaces")
