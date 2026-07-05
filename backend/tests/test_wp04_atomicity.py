"""WP-0.4 — atomicidad dominio+auditoría: un único commit por escritura.

Antes, los servicios comiteaban el dominio por su cuenta y la auditoría hacía OTRO
commit: si la auditoría fallaba, quedaba mutación de dominio sin registro. Ahora los
servicios solo hacen flush() y el pipeline de escritura comitea UNA sola vez, de modo
que un fallo en la auditoría revierte también el dominio. El camino de lectura conserva
su commit propio (record_publish_audit commit=True).
"""

from uuid import uuid4

import pytest
from sqlalchemy import func, select

import app.mcp.governed_write as governed_write
from app.db.session import SessionLocal
from app.mcp.server import get_active_task, upsert_context_item
from app.models.context_item import ContextItem
from app.models.publish_audit import PublishAudit

_SCOPE = dict(consumer="chatgpt", session_key="canonical-chatgpt-session")


def _count(model) -> int:
    db = SessionLocal()
    try:
        return db.execute(select(func.count()).select_from(model)).scalar_one()
    finally:
        db.close()


def _count_item(item_key: str) -> int:
    db = SessionLocal()
    try:
        return db.execute(
            select(func.count()).select_from(ContextItem).where(ContextItem.item_key == item_key)
        ).scalar_one()
    finally:
        db.close()


def test_read_tool_still_records_publish_audit(active_task):
    """El camino de lectura conserva su commit: deja fila en publish_audit (F15)."""
    before = _count(PublishAudit)
    resp = get_active_task(
        workspace_id=str(active_task.workspace_id),
        project_id=str(active_task.project_id),
        task_id=str(active_task.id),
        **_SCOPE,
    )
    assert resp["status"] == "ok"
    assert _count(PublishAudit) > before


def test_write_is_atomic_when_audit_fails(active_task, monkeypatch):
    """Si la auditoría de escritura falla, el dominio se revierte (no hay mutación
    sin registro). Este test falla con el código viejo (el servicio ya había
    comiteado el item) y pasa con el commit único de WP-0.4."""
    item_key = f"wp04.atomic.{uuid4().hex}"

    def _boom(*args, **kwargs):
        raise RuntimeError("audit failure injected")

    # record_write_audit se ejecuta desde el pipeline (governed_write), no desde server.
    monkeypatch.setattr(governed_write, "record_write_audit", _boom)
    with pytest.raises(RuntimeError):
        upsert_context_item(
            item_key=item_key,
            item_type="note",
            title="atomic",
            content={"wp": "0.4"},
            dry_run=False,
            idempotency_key=f"wp04-{uuid4().hex}",
            workspace_id=str(active_task.workspace_id),
            project_id=str(active_task.project_id),
            task_id=str(active_task.id),
            **_SCOPE,
        )
    assert _count_item(item_key) == 0


def test_committed_write_persists_domain_and_audit(active_task):
    """El camino feliz sigue persistiendo dominio + auditoría (regresión)."""
    item_key = f"wp04.ok.{uuid4().hex}"
    audit_before = _count(PublishAudit)
    resp = upsert_context_item(
        item_key=item_key,
        item_type="note",
        title="ok",
        content={"wp": "0.4"},
        dry_run=False,
        idempotency_key=f"wp04-ok-{uuid4().hex}",
        workspace_id=str(active_task.workspace_id),
        project_id=str(active_task.project_id),
        task_id=str(active_task.id),
        **_SCOPE,
    )
    assert resp["status"] == "ok"
    assert resp["result"] in {"created", "updated"}
    assert "audit_ref" in resp
    assert _count_item(item_key) == 1
    assert _count(PublishAudit) > audit_before
