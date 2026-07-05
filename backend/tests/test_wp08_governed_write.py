"""WP-0.8 — pipeline gobernado de escritura (run_governed_write).

Prueba la función de forma aislada (apply_fn fake): que aplica+audita, que el
replay corta ANTES de apply_fn, y que un fallo en apply_fn revierte todo sin
dejar fila de auditoría. Complementa a los tests a nivel de tool.
"""

from uuid import uuid4

import pytest
from sqlalchemy import func, select

from app.db.session import SessionLocal
from app.mcp.governed_write import RatificationSpec, WriteOutcome, run_governed_write
from app.models.context_write_audit import ContextWriteAudit
from app.services.focus_resolver import resolve_scope


def _resolved(db, active_task):
    return resolve_scope(
        db,
        workspace_id=str(active_task.workspace_id),
        project_id=str(active_task.project_id),
        task_id=str(active_task.id),
        consumer="chatgpt",
        session_key="canonical-chatgpt-session",
    )


def _outcome():
    return WriteOutcome(
        result="created", subject_id=None, before_payload=None, after_payload={"x": 1}, extra={"x": 1}
    )


def test_pipeline_applies_and_audits(active_task):
    db = SessionLocal()
    try:
        resolved = _resolved(db, active_task)
        calls = []

        def _apply(db, request_id):
            calls.append(request_id)
            return _outcome()

        resp = run_governed_write(
            db, tool_name="upsert_context_item", resolved=resolved, dry_run=False,
            idempotency_key=f"wp08-{uuid4().hex}", ratification=None, apply_fn=_apply,
        )
        assert resp["status"] == "ok"
        assert resp["result"] == "created"
        assert resp["idempotent_replay"] is False
        assert "audit_ref" in resp
        assert len(calls) == 1  # apply_fn se invocó exactamente una vez
    finally:
        db.close()


def test_pipeline_replay_shortcircuits_before_apply(active_task):
    key = f"wp08-replay-{uuid4().hex}"
    db = SessionLocal()
    try:
        run_governed_write(
            db, tool_name="upsert_context_item", resolved=_resolved(db, active_task), dry_run=False,
            idempotency_key=key, ratification=None, apply_fn=lambda db, rid: _outcome(),
        )
    finally:
        db.close()
    db = SessionLocal()
    try:
        called = []

        def _apply2(db, request_id):
            called.append(1)
            return _outcome()

        resp = run_governed_write(
            db, tool_name="upsert_context_item", resolved=_resolved(db, active_task), dry_run=False,
            idempotency_key=key, ratification=None, apply_fn=_apply2,
        )
        assert resp.get("idempotent_replay") is True
        assert called == []  # el replay corta ANTES de apply_fn
    finally:
        db.close()


def test_pipeline_rollback_on_apply_failure(active_task):
    key = f"wp08-boom-{uuid4().hex}"
    db = SessionLocal()
    try:
        def _boom(db, request_id):
            raise RuntimeError("apply boom")

        with pytest.raises(RuntimeError):
            run_governed_write(
                db, tool_name="upsert_context_item", resolved=_resolved(db, active_task), dry_run=False,
                idempotency_key=key, ratification=None, apply_fn=_boom,
            )
    finally:
        db.close()
    db = SessionLocal()
    try:
        n = db.execute(
            select(func.count()).select_from(ContextWriteAudit).where(ContextWriteAudit.request_id == key)
        ).scalar_one()
        assert n == 0  # un fallo en apply_fn no deja rastro de auditoría
    finally:
        db.close()


def test_pipeline_dry_run_requires_no_key_and_uses_synthetic_request_id(active_task):
    db = SessionLocal()
    try:
        resp = run_governed_write(
            db, tool_name="upsert_context_item", resolved=_resolved(db, active_task), dry_run=True,
            idempotency_key=None, ratification=None,
            apply_fn=lambda db, rid: WriteOutcome(
                result="dry_run", subject_id=None, before_payload=None, after_payload=None, extra={}
            ),
        )
        assert resp["status"] == "ok"
        assert resp["request_id"].startswith("dryrun-")
    finally:
        db.close()
