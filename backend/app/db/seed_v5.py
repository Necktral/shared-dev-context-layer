from datetime import datetime, timezone

from sqlalchemy import select

from app.db.seed_v1 import run_seed as run_seed_v1
from app.db.session import SessionLocal
from app.models.approved_decision import ApprovedDecision
from app.models.context_snapshot import ContextSnapshot
from app.models.policy_state import PolicyState
from app.models.task import Task
from app.models.validation_run import ValidationRun
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

DECISION_SEEDS = [
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


def run_seed() -> None:
    run_seed_v1()
    db = SessionLocal()
    try:
        task = db.execute(select(Task).where(Task.is_active.is_(True))).scalars().first()
        if not task:
            raise RuntimeError("No active task available for seed_v5.")

        if not task.current_phase:
            task.current_phase = "phase5_domain_enrichment"

        policy = db.execute(select(PolicyState).order_by(PolicyState.updated_at.desc())).scalars().first()
        policy_mode = policy.mode if policy else "delegated_limited"

        for seed in VALIDATION_SEEDS:
            existing = db.execute(
                select(ValidationRun).where(
                    ValidationRun.task_id == task.id,
                    ValidationRun.validation_type == seed["validation_type"],
                    ValidationRun.source == seed["source"],
                )
            ).scalars().first()

            if existing:
                existing.status = seed["status"]
                existing.summary = seed["summary"]
                existing.details = seed["details"]
                existing.executed_at = datetime.now(timezone.utc)
            else:
                db.add(
                    ValidationRun(
                        task_id=task.id,
                        validation_type=seed["validation_type"],
                        status=seed["status"],
                        summary=seed["summary"],
                        details=seed["details"],
                        source=seed["source"],
                    )
                )

        for seed in DECISION_SEEDS:
            existing = db.execute(
                select(ApprovedDecision).where(
                    ApprovedDecision.task_id == task.id,
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
            else:
                db.add(
                    ApprovedDecision(
                        task_id=task.id,
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

        snapshot_payload = build_operational_snapshot(db, task, policy_mode=policy_mode, generated_from="phase5_seed")
        existing_snapshot = db.execute(
            select(ContextSnapshot).where(
                ContextSnapshot.task_id == task.id,
                ContextSnapshot.snapshot_type == "phase5_seed",
            )
        ).scalars().first()

        if existing_snapshot:
            existing_snapshot.snapshot_content = snapshot_payload
            existing_snapshot.policy_applied = policy_mode
            existing_snapshot.generated_from = "phase5_seed"
        else:
            db.add(
                ContextSnapshot(
                    task_id=task.id,
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
