"""Monta el contexto de ERP_v2 en la memoria local (context store).

Crea/actualiza, dentro del workspace canonico ya sembrado:
  - proyecto  ERP v2
  - tarea ACTIVA "Bug: el cargo no se carga al crear un usuario"
  - sesion + ContextScope is_current -> ERP (lo que resuelve get_active_task)
  - 1 decision (via canonica de cargo, pendiente) + 1 validacion (repro fallida)
  - 1 snapshot operativo

Al final hace un READBACK usando resolve_scope() + build_operational_snapshot(),
es decir, imprime exactamente lo que devolverian las tools MCP get_active_task /
get_context_snapshot. Es idempotente: se puede correr varias veces.

Ejecucion (sin reconstruir la imagen):
  docker compose run --rm --no-deps \
    -e PYTHONPATH=/app -v "$PWD/scripts:/work:ro" \
    backend python /work/seed_erp_v2.py
"""

from __future__ import annotations

import json

from sqlalchemy import select, update

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
from app.services.focus_resolver import resolve_scope

ERP_PROJECT_KEY = "erp_v2"
ERP_SESSION_KEY = "erp-v2-local-session"
TASK_TITLE = "Bug: el cargo no se carga al crear un usuario"
DECISION_KEY = "erp.user.cargo_creation_canonical"
SNAPSHOT_TYPE = "erp_v2_seed"


def run() -> None:
    db = SessionLocal()
    try:
        workspace = db.execute(
            select(Workspace).where(Workspace.is_active.is_(True)).order_by(Workspace.created_at.asc()).limit(1)
        ).scalars().first()
        if workspace is None:
            raise RuntimeError("No hay workspace activo. Corre primero los seeds base (servicio migrate).")

        # --- Proyecto ERP_v2 ---
        project = db.execute(
            select(Project).where(Project.workspace_id == workspace.id, Project.project_key == ERP_PROJECT_KEY)
        ).scalars().first()
        if project is None:
            project = Project(
                workspace_id=workspace.id,
                project_key=ERP_PROJECT_KEY,
                name="ERP v2",
                repo_url="ERP_v2",
                default_branch="main",
                status="active",
                is_active=True,
            )
            db.add(project)
            db.flush()

        # --- Tarea activa = el bug del cargo (solo una activa en todo el sistema) ---
        task = db.execute(
            select(Task).where(Task.project_id == project.id, Task.title == TASK_TITLE)
        ).scalars().first()
        db.execute(update(Task).values(is_active=False))
        if task is None:
            task = Task(
                title=TASK_TITLE,
                goal=(
                    "Diagnosticar por que el cargo asignado no se persiste al crear un usuario "
                    "y fijar la via canonica de creacion de cargo."
                ),
                status="in_progress",
                priority="alta",
                branch="main",
                repo="ERP_v2",
                next_action=(
                    "Rastrear los caminos de creacion de usuario y aislar donde se pierde "
                    "la persistencia del cargo."
                ),
                current_phase="diagnostico",
                workspace_id=workspace.id,
                project_id=project.id,
                is_active=True,
            )
            db.add(task)
            db.flush()
        else:
            task.is_active = True
            task.status = "in_progress"

        # --- Consumer (reutiliza el de la extension VS Code) ---
        consumer = db.execute(
            select(Consumer).where(Consumer.consumer_type == "vscode_extension")
        ).scalars().first()
        if consumer is None:
            consumer = Consumer(consumer_type="vscode_extension", name="VS Code Extension", version="v1", is_active=True)
            db.add(consumer)
            db.flush()

        # --- Sesion de ejecucion para ERP ---
        session = db.execute(
            select(ExecutionSession).where(ExecutionSession.session_key == ERP_SESSION_KEY)
        ).scalars().first()
        if session is None:
            session = ExecutionSession(
                consumer_id=consumer.id,
                workspace_id=workspace.id,
                project_id=project.id,
                task_id=task.id,
                session_key=ERP_SESSION_KEY,
                status="active",
            )
            db.add(session)
            db.flush()
        else:
            session.consumer_id = consumer.id
            session.workspace_id = workspace.id
            session.project_id = project.id
            session.task_id = task.id
            session.status = "active"
            session.ended_at = None

        # --- Scope actual -> ERP (lo que get_active_task resuelve sin argumentos) ---
        db.query(ContextScope).filter(ContextScope.is_current.is_(True)).update({"is_current": False})
        scope = db.execute(
            select(ContextScope).where(
                ContextScope.workspace_id == workspace.id,
                ContextScope.project_id == project.id,
                ContextScope.task_id == task.id,
                ContextScope.consumer_id == consumer.id,
                ContextScope.execution_session_id == session.id,
                ContextScope.scope_kind == "task",
            )
        ).scalars().first()
        if scope is None:
            db.add(
                ContextScope(
                    workspace_id=workspace.id,
                    project_id=project.id,
                    task_id=task.id,
                    consumer_id=consumer.id,
                    execution_session_id=session.id,
                    scope_kind="task",
                    is_current=True,
                    resolved_by="seed_erp_v2",
                )
            )
        else:
            scope.is_current = True
            scope.resolved_by = "seed_erp_v2"

        # --- Decision: via canonica de creacion de cargo (pendiente de definir) ---
        decision = db.execute(
            select(ApprovedDecision).where(
                ApprovedDecision.workspace_id == workspace.id,
                ApprovedDecision.project_id == project.id,
                ApprovedDecision.task_id == task.id,
                ApprovedDecision.decision_key == DECISION_KEY,
            )
        ).scalars().first()
        if decision is None:
            db.add(
                ApprovedDecision(
                    workspace_id=workspace.id,
                    project_id=project.id,
                    task_id=task.id,
                    decision_key=DECISION_KEY,
                    title="Via canonica de creacion de cargo (pendiente)",
                    category="architecture",
                    decision="PENDIENTE: definir el unico servicio que crea y persiste el cargo al crear un usuario.",
                    rationale="Hay multiples caminos de creacion de usuario y ninguno persiste el cargo; consolidar en una sola via.",
                    constraints_json={},
                    is_active=True,
                    approved_by="WIS",
                )
            )

        # --- Validacion: repro fallida del bug ---
        validation = db.execute(
            select(ValidationRun).where(
                ValidationRun.task_id == task.id,
                ValidationRun.validation_type == "repro",
                ValidationRun.source == "manual",
            )
        ).scalars().first()
        if validation is None:
            db.add(
                ValidationRun(
                    task_id=task.id,
                    workspace_id=workspace.id,
                    project_id=project.id,
                    consumer_id=consumer.id,
                    execution_session_id=session.id,
                    validation_type="repro",
                    status="failed",
                    summary="Repro: crear usuario + asignar cargo -> el cargo no queda persistido.",
                    details={"observacion": "multiples caminos de creacion de usuario; ninguno persiste el cargo"},
                    source="manual",
                )
            )

        policy = db.execute(select(PolicyState).order_by(PolicyState.updated_at.desc())).scalars().first()
        policy_mode = policy.mode if policy else "delegated_limited"

        consumer_context = {
            "consumer_type": consumer.consumer_type,
            "consumer_name": consumer.name,
            "session_key": session.session_key,
            "session_status": session.status,
        }
        resolution_metadata = {
            "source": "seed_erp_v2",
            "fallback_level": "none",
            "conflict_flags": [],
            "requested": {},
            "resolved_scope": {
                "workspace_id": str(workspace.id),
                "project_id": str(project.id),
                "task_id": str(task.id),
            },
        }

        snapshot_payload = build_operational_snapshot(
            db,
            task,
            policy_mode=policy_mode,
            generated_from=SNAPSHOT_TYPE,
            workspace_id=workspace.id,
            project_id=project.id,
            consumer_context=consumer_context,
            resolution_metadata=resolution_metadata,
        )
        existing_snap = db.execute(
            select(ContextSnapshot).where(
                ContextSnapshot.task_id == task.id,
                ContextSnapshot.snapshot_type == SNAPSHOT_TYPE,
            )
        ).scalars().first()
        if existing_snap is None:
            db.add(
                ContextSnapshot(
                    task_id=task.id,
                    workspace_id=workspace.id,
                    project_id=project.id,
                    consumer_id=consumer.id,
                    execution_session_id=session.id,
                    snapshot_type=SNAPSHOT_TYPE,
                    snapshot_content=snapshot_payload,
                    policy_applied=policy_mode,
                    generated_from=SNAPSHOT_TYPE,
                )
            )
        else:
            existing_snap.snapshot_content = snapshot_payload
            existing_snap.policy_applied = policy_mode
            existing_snap.generated_from = SNAPSHOT_TYPE

        db.commit()
        print("=== Contexto ERP_v2 sembrado correctamente ===")

        # ----------------- READBACK (lo que devolveran las tools MCP) -----------------
        resolved = resolve_scope(db)
        print("\n[get_active_task] tarea activa resuelta sin argumentos:")
        print("  proyecto :", resolved.project.name if resolved.project else None)
        print("  tarea    :", resolved.task.title if resolved.task else None)
        print("  status   :", resolved.status, "| source:", resolved.resolution_metadata.get("source"))

        snap = build_operational_snapshot(
            db,
            resolved.task,
            policy_mode=policy_mode,
            generated_from="readback",
            workspace_id=resolved.workspace.id,
            project_id=resolved.project.id,
            consumer_context=consumer_context,
            resolution_metadata=resolved.resolution_metadata,
        )
        print("\n[get_context_snapshot] claves del snapshot:", list(snap.keys()))
        print(json.dumps(snap, indent=2, ensure_ascii=False, default=str)[:1800])
    finally:
        db.close()


if __name__ == "__main__":
    run()
