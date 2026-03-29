from datetime import datetime, timezone

from sqlalchemy import select

from app.db.seed_v1 import run_seed as run_seed_v1
from app.db.session import SessionLocal
from app.models.approved_decision import ApprovedDecision
from app.models.consumer import Consumer
from app.models.context_scope import ContextScope
from app.models.context_snapshot import ContextSnapshot
from app.models.execution_session import ExecutionSession
from app.models.policy_state import PolicyState
from app.models.project import Project
from app.models.task import Task
from app.models.validation_run import ValidationRun
from app.models.workspace import Workspace
from app.services.context_snapshot_service import build_operational_snapshot

VALIDATION_SEEDS = [
    {
        "validation_type": "health",
        "status": "passed",
        "summary": "backend, db y mcp disponibles",
        "details": {"backend": "up", "db": "up", "mcp": "up"},
        "source": "manual",
    },
    {
        "validation_type": "mcp_tools",
        "status": "passed",
        "summary": "5 tools read-only validadas",
        "details": {"tools_ok": 5},
        "source": "manual",
    },
]

TASK_DECISION_SEEDS = [
    {
        "decision_key": "stack.backend.python_fastapi",
        "category": "stack",
        "title": "Backend en Python con FastAPI",
        "decision": "usar Python + FastAPI para backend, policy engine y mcp",
        "rationale": "velocidad de iteración y separación limpia del dominio",
    },
    {
        "decision_key": "stack.database.postgresql",
        "category": "stack",
        "title": "PostgreSQL como base principal",
        "decision": "usar PostgreSQL como fuente de verdad",
        "rationale": "robustez, auditoría y crecimiento",
    },
    {
        "decision_key": "policy.mode.delegated_limited",
        "category": "policy",
        "title": "Política delegated_limited",
        "decision": "la publicación de contexto queda gobernada por política controlada por WIS",
        "rationale": "control fuerte sin alterar instrucciones de agentes",
    },
    {
        "decision_key": "integration.v1.read_only",
        "category": "architecture",
        "title": "V1 read-only",
        "decision": "la primera integración con ChatGPT permanece solo lectura",
        "rationale": "minimizar riesgo mientras madura el dominio",
    },
]

PROJECT_DECISION_SEEDS = [
    {
        "decision_key": "project.default.branch_policy",
        "category": "operations",
        "title": "Project default branch policy",
        "decision": "usar main como branch por defecto del proyecto canónico",
        "rationale": "reducir ambigüedad de foco durante bootstrap multi-scope",
    },
]

WORKSPACE_DECISION_SEEDS = [
    {
        "decision_key": "policy.mode.delegated_limited",
        "category": "policy",
        "title": "Workspace delegated_limited baseline",
        "decision": "el workspace canónico opera en delegated_limited como regla base",
        "rationale": "establecer herencia de política por scope con fallback seguro",
    },
]

CONSUMER_SEEDS = [
    {"consumer_type": "chatgpt", "name": "ChatGPT Developer Mode", "version": "v1"},
    {"consumer_type": "vscode_extension", "name": "VS Code Extension", "version": "v1"},
    {"consumer_type": "codex", "name": "Codex CLI", "version": "v1"},
    {"consumer_type": "github_copilot", "name": "GitHub Copilot", "version": "v1"},
]

CANONICAL_SESSION_KEY = "canonical-chatgpt-session"


def _ensure_consumer(db, consumer_type: str, name: str, version: str) -> Consumer:
    consumer = db.execute(select(Consumer).where(Consumer.consumer_type == consumer_type)).scalars().first()
    if consumer:
        consumer.name = name
        consumer.version = version
        consumer.is_active = True
        return consumer

    consumer = Consumer(
        consumer_type=consumer_type,
        name=name,
        version=version,
        is_active=True,
    )
    db.add(consumer)
    db.flush()
    return consumer


def _upsert_decision(
    db,
    *,
    workspace_id,
    project_id,
    task_id,
    seed: dict,
) -> None:
    existing = db.execute(
        select(ApprovedDecision).where(
            ApprovedDecision.workspace_id == workspace_id,
            ApprovedDecision.project_id == project_id,
            ApprovedDecision.task_id == task_id,
            ApprovedDecision.decision_key == seed["decision_key"],
        )
    ).scalars().first()

    if existing:
        existing.title = seed["title"]
        existing.category = seed["category"]
        existing.decision = seed["decision"]
        existing.rationale = seed["rationale"]
        existing.constraints_json = {}
        existing.is_active = True
        existing.approved_by = "WIS"
        existing.superseded_by = None
        existing.approved_at = datetime.now(timezone.utc)
        return

    db.add(
        ApprovedDecision(
            workspace_id=workspace_id,
            project_id=project_id,
            task_id=task_id,
            decision_key=seed["decision_key"],
            title=seed["title"],
            category=seed["category"],
            decision=seed["decision"],
            rationale=seed["rationale"],
            constraints_json={},
            is_active=True,
            approved_by="WIS",
        )
    )


def run_seed() -> None:
    run_seed_v1()
    db = SessionLocal()
    try:
        task = db.execute(select(Task).where(Task.is_active.is_(True))).scalars().first()
        if not task:
            raise RuntimeError("No active task available for seed_v5.")

        workspace = db.execute(select(Workspace).where(Workspace.id == task.workspace_id)).scalars().first()
        project = db.execute(select(Project).where(Project.id == task.project_id)).scalars().first()
        if workspace is None or project is None:
            raise RuntimeError("Task scope is not linked to workspace/project.")

        if not task.current_phase:
            task.current_phase = "phase5_domain_enrichment"

        policy = db.execute(select(PolicyState).order_by(PolicyState.updated_at.desc())).scalars().first()
        policy_mode = policy.mode if policy else "delegated_limited"

        consumer_rows: dict[str, Consumer] = {}
        for seed in CONSUMER_SEEDS:
            consumer_rows[seed["consumer_type"]] = _ensure_consumer(
                db=db,
                consumer_type=seed["consumer_type"],
                name=seed["name"],
                version=seed["version"],
            )

        chatgpt_consumer = consumer_rows["chatgpt"]
        canonical_session = db.execute(
            select(ExecutionSession).where(ExecutionSession.session_key == CANONICAL_SESSION_KEY)
        ).scalars().first()
        if canonical_session:
            canonical_session.consumer_id = chatgpt_consumer.id
            canonical_session.workspace_id = workspace.id
            canonical_session.project_id = project.id
            canonical_session.task_id = task.id
            canonical_session.status = "active"
            canonical_session.ended_at = None
        else:
            canonical_session = ExecutionSession(
                consumer_id=chatgpt_consumer.id,
                workspace_id=workspace.id,
                project_id=project.id,
                task_id=task.id,
                session_key=CANONICAL_SESSION_KEY,
                status="active",
            )
            db.add(canonical_session)
            db.flush()

        db.query(ContextScope).filter(ContextScope.is_current.is_(True)).update({"is_current": False})
        canonical_scope = db.execute(
            select(ContextScope).where(
                ContextScope.workspace_id == workspace.id,
                ContextScope.project_id == project.id,
                ContextScope.task_id == task.id,
                ContextScope.consumer_id == chatgpt_consumer.id,
                ContextScope.execution_session_id == canonical_session.id,
                ContextScope.scope_kind == "task",
            )
        ).scalars().first()
        if canonical_scope:
            canonical_scope.is_current = True
            canonical_scope.resolved_by = "seed_v5"
        else:
            db.add(
                ContextScope(
                    workspace_id=workspace.id,
                    project_id=project.id,
                    task_id=task.id,
                    consumer_id=chatgpt_consumer.id,
                    execution_session_id=canonical_session.id,
                    scope_kind="task",
                    is_current=True,
                    resolved_by="seed_v5",
                )
            )

        for seed in VALIDATION_SEEDS:
            existing = db.execute(
                select(ValidationRun).where(
                    ValidationRun.task_id == task.id,
                    ValidationRun.validation_type == seed["validation_type"],
                    ValidationRun.source == seed["source"],
                )
            ).scalars().first()

            if existing:
                existing.workspace_id = workspace.id
                existing.project_id = project.id
                existing.consumer_id = chatgpt_consumer.id
                existing.execution_session_id = canonical_session.id
                existing.status = seed["status"]
                existing.summary = seed["summary"]
                existing.details = seed["details"]
                existing.executed_at = datetime.now(timezone.utc)
            else:
                db.add(
                    ValidationRun(
                        task_id=task.id,
                        workspace_id=workspace.id,
                        project_id=project.id,
                        consumer_id=chatgpt_consumer.id,
                        execution_session_id=canonical_session.id,
                        validation_type=seed["validation_type"],
                        status=seed["status"],
                        summary=seed["summary"],
                        details=seed["details"],
                        source=seed["source"],
                    )
                )

        for seed in TASK_DECISION_SEEDS:
            _upsert_decision(
                db,
                workspace_id=workspace.id,
                project_id=project.id,
                task_id=task.id,
                seed=seed,
            )
        for seed in PROJECT_DECISION_SEEDS:
            _upsert_decision(
                db,
                workspace_id=workspace.id,
                project_id=project.id,
                task_id=None,
                seed=seed,
            )
        for seed in WORKSPACE_DECISION_SEEDS:
            _upsert_decision(
                db,
                workspace_id=workspace.id,
                project_id=None,
                task_id=None,
                seed=seed,
            )

        snapshot_payload = build_operational_snapshot(
            db,
            task,
            policy_mode=policy_mode,
            generated_from="phase5_seed",
            workspace_id=workspace.id,
            project_id=project.id,
            consumer_context={
                "consumer_type": chatgpt_consumer.consumer_type,
                "consumer_name": chatgpt_consumer.name,
                "session_key": canonical_session.session_key,
                "session_status": canonical_session.status,
            },
            resolution_metadata={
                "source": "seed_v5",
                "fallback_level": "none",
                "conflict_flags": [],
                "requested": {},
                "resolved_scope": {
                    "workspace_id": str(workspace.id),
                    "project_id": str(project.id),
                    "task_id": str(task.id),
                },
            },
        )

        existing_snapshot = db.execute(
            select(ContextSnapshot).where(
                ContextSnapshot.task_id == task.id,
                ContextSnapshot.snapshot_type == "phase5_seed",
            )
        ).scalars().first()

        if existing_snapshot:
            existing_snapshot.workspace_id = workspace.id
            existing_snapshot.project_id = project.id
            existing_snapshot.consumer_id = chatgpt_consumer.id
            existing_snapshot.execution_session_id = canonical_session.id
            existing_snapshot.snapshot_content = snapshot_payload
            existing_snapshot.policy_applied = policy_mode
            existing_snapshot.generated_from = "phase5_seed"
        else:
            db.add(
                ContextSnapshot(
                    task_id=task.id,
                    workspace_id=workspace.id,
                    project_id=project.id,
                    consumer_id=chatgpt_consumer.id,
                    execution_session_id=canonical_session.id,
                    snapshot_type="phase5_seed",
                    snapshot_content=snapshot_payload,
                    policy_applied=policy_mode,
                    generated_from="phase5_seed",
                )
            )

        db.commit()
        print("Seed v5 completed.")
    finally:
        db.close()


if __name__ == "__main__":
    run_seed()
