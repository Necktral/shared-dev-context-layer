"""WP-0.1 — el replay idempotente no debe quemar keys en dry_run.

Cubre el hallazgo F01: antes, un dry_run con idempotency_key K registraba la
auditoría con request_id=K; un commit posterior con K se trataba como replay del
dry_run (no aplicaba) y, en BD con historial, colisionaba con el constraint único
(IntegrityError). El fix: (a) todo dry_run usa request_id sintético 'dryrun-<uuid>';
(b) el lookup de replay filtra dry_run==false; (c) la migración 0007 libera las
request_id reales quemadas por dry_run histórico.
"""

from uuid import uuid4

from sqlalchemy import func, select, text

from app.audit.write_audit_service import get_existing_request_audit
from app.db.session import SessionLocal
from app.mcp.server import upsert_context_item
from app.models.context_write_audit import ContextWriteAudit

_SCOPE = dict(consumer="chatgpt", session_key="canonical-chatgpt-session")


def _upsert(active_task, *, key, dry_run, item_key=None):
    return upsert_context_item(
        item_key=item_key or f"wp01.{uuid4().hex}",
        item_type="note",
        title="wp01",
        content={"wp": "0.1"},
        dry_run=dry_run,
        idempotency_key=key,
        workspace_id=str(active_task.workspace_id),
        project_id=str(active_task.project_id),
        task_id=str(active_task.id),
        **_SCOPE,
    )


def _count_request_id(request_id: str) -> int:
    db = SessionLocal()
    try:
        return db.execute(
            select(func.count()).select_from(ContextWriteAudit).where(
                ContextWriteAudit.request_id == request_id
            )
        ).scalar_one()
    finally:
        db.close()


def test_dry_run_does_not_burn_idempotency_key(active_task):
    key = f"wp01-dry-{uuid4().hex}"
    dry = _upsert(active_task, key=key, dry_run=True)
    assert dry["result"] == "dry_run"
    # El dry_run NO registró ninguna fila de auditoría con la key real (usó dryrun-<uuid>).
    assert _count_request_id(key) == 0
    # El commit posterior con la MISMA key aplica de verdad (no replay del dry_run).
    committed = _upsert(active_task, key=key, dry_run=False)
    assert committed["result"] in {"created", "updated"}
    assert committed["idempotent_replay"] is False


def test_second_commit_same_key_replays(active_task):
    key = f"wp01-commit-{uuid4().hex}"
    first = _upsert(active_task, key=key, dry_run=False)
    assert first["result"] in {"created", "updated"}
    assert first["idempotent_replay"] is False
    # Segundo commit con la misma key (item distinto) ⇒ replay idempotente.
    second = _upsert(active_task, key=key, dry_run=False, item_key=f"wp01.other.{uuid4().hex}")
    assert second["idempotent_replay"] is True


def test_get_existing_request_audit_ignores_dry_run_rows(active_task):
    key = f"wp01-filter-{uuid4().hex}"
    db = SessionLocal()
    try:
        db.add(
            ContextWriteAudit(
                workspace_id=active_task.workspace_id,
                tool_name="upsert_context_item",
                request_id=key,
                actor_sub="local_bypass",
                result="dry_run",
                dry_run=True,
            )
        )
        db.commit()
        # Una fila dry_run con key real NO participa en el replay.
        assert (
            get_existing_request_audit(
                db, workspace_id=active_task.workspace_id, tool_name="upsert_context_item", request_id=key
            )
            is None
        )
        # Una fila commit sí se encuentra.
        db.add(
            ContextWriteAudit(
                workspace_id=active_task.workspace_id,
                tool_name="upsert_context_item",
                request_id=f"{key}-commit",
                actor_sub="local_bypass",
                result="created",
                dry_run=False,
            )
        )
        db.commit()
        assert (
            get_existing_request_audit(
                db,
                workspace_id=active_task.workspace_id,
                tool_name="upsert_context_item",
                request_id=f"{key}-commit",
            )
            is not None
        )
    finally:
        db.close()


def test_historical_burned_key_freed_then_commit_applies(active_task):
    """F01: una key real quemada por un dry_run histórico se libera con el data-fix
    de 0007, y un commit posterior con esa key aplica sin IntegrityError."""
    key = f"wp01-historical-{uuid4().hex}"
    db = SessionLocal()
    try:
        # Simula la fila dry_run histórica que quemó la key real (pre-migración).
        db.add(
            ContextWriteAudit(
                workspace_id=active_task.workspace_id,
                tool_name="upsert_context_item",
                request_id=key,
                actor_sub="local_bypass",
                result="dry_run",
                dry_run=True,
            )
        )
        db.commit()
        assert _count_request_id(key) == 1
        # Aplica el data-fix EXACTO de la migración 0007 (idempotente sobre dry_run reales).
        db.execute(
            text(
                "UPDATE context_write_audit SET request_id = 'dryrun-' || gen_random_uuid() "
                "WHERE dry_run AND request_id NOT LIKE 'dryrun-%'"
            )
        )
        db.commit()
    finally:
        db.close()
    # La key real quedó liberada.
    assert _count_request_id(key) == 0
    # El commit con esa misma key aplica sin colisión de constraint.
    committed = _upsert(active_task, key=key, dry_run=False)
    assert committed["result"] in {"created", "updated"}
    assert committed["idempotent_replay"] is False
