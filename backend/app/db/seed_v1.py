from sqlalchemy import select, update

from app.db.session import SessionLocal
from app.models.policy_state import PolicyState
from app.models.project import Project
from app.models.task import Task
from app.models.workspace import Workspace

DEFAULT_WORKSPACE_KEY = "default"
DEFAULT_PROJECT_KEY = "default_project"


def run_seed() -> None:
    db = SessionLocal()
    try:
        workspace = db.execute(select(Workspace).where(Workspace.workspace_key == DEFAULT_WORKSPACE_KEY)).scalars().first()
        if workspace is None:
            workspace = Workspace(
                workspace_key=DEFAULT_WORKSPACE_KEY,
                name="Default Workspace",
                description="Canonical workspace for local development",
                is_active=True,
            )
            db.add(workspace)
            db.flush()

        project = db.execute(
            select(Project).where(Project.workspace_id == workspace.id, Project.project_key == DEFAULT_PROJECT_KEY)
        ).scalars().first()
        if project is None:
            project = Project(
                workspace_id=workspace.id,
                project_key=DEFAULT_PROJECT_KEY,
                name="Default Project",
                repo_url="shared-dev-context-layer",
                default_branch="main",
                status="active",
                is_active=True,
            )
            db.add(project)
            db.flush()

        active_task = db.execute(select(Task).where(Task.is_active.is_(True))).scalars().first()
        if active_task is None:
            db.execute(update(Task).values(is_active=False))
            db.add(
                Task(
                    title="bootstrap del sistema",
                    goal="levantar arquitectura base",
                    status="in_progress",
                    priority="alta",
                    branch="main",
                    repo="shared-dev-context-layer",
                    next_action="definir tools MCP v1",
                    workspace_id=workspace.id,
                    project_id=project.id,
                    is_active=True,
                )
            )
        else:
            if active_task.workspace_id is None:
                active_task.workspace_id = workspace.id
            if active_task.project_id is None:
                active_task.project_id = project.id

        policy = db.execute(select(PolicyState).order_by(PolicyState.updated_at.desc())).scalars().first()
        if policy is None:
            db.add(
                PolicyState(
                    sync_enabled=False,
                    mode="delegated_limited",
                    scope="task",
                    redaction_level="strict",
                    approval_mode="wis_controlled",
                )
            )
        else:
            policy.sync_enabled = False
            policy.mode = "delegated_limited"
            policy.scope = "task"
            policy.redaction_level = "strict"
            policy.approval_mode = "wis_controlled"

        db.commit()
        print("Seed v1 completed.")
    finally:
        db.close()


if __name__ == "__main__":
    run_seed()
