from sqlalchemy import select, update

from app.db.session import SessionLocal
from app.models.policy_state import PolicyState
from app.models.task import Task


def run_seed() -> None:
    db = SessionLocal()
    try:
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
                    is_active=True,
                )
            )

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
