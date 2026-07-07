"""WP-0.3 — apply_sync_batch aplica de verdad las operaciones (antes era un stub).

Antes, en modo commit apply_sync_batch devolvía 'applied' pero solo persistía una
fila de batch, sin ejecutar las operaciones. Ahora despacha cada operación a su
servicio en la MISMA transacción (all-or-nothing), con ratificación por operación.
"""

from uuid import uuid4

from sqlalchemy import func, select

from app.db.session import SessionLocal
from app.mcp.server import apply_sync_batch
from app.models.context_item import ContextItem
from app.models.policy_state import PolicyState
from app.services.approval_policy_service import get_policy_state

_SCOPE = dict(consumer="chatgpt", session_key="canonical-chatgpt-session")


def _batch(active_task, operations, **kw):
    return apply_sync_batch(
        operations=operations,
        dry_run=kw.pop("dry_run", False),
        idempotency_key=kw.pop("idempotency_key", f"wp03-{uuid4().hex}"),
        workspace_id=str(active_task.workspace_id),
        project_id=str(active_task.project_id),
        task_id=str(active_task.id),
        **_SCOPE,
    )


def _count_item(item_key: str) -> int:
    db = SessionLocal()
    try:
        return db.execute(
            select(func.count()).select_from(ContextItem).where(ContextItem.item_key == item_key)
        ).scalar_one()
    finally:
        db.close()


def _get_item(item_key: str) -> ContextItem | None:
    db = SessionLocal()
    try:
        return db.execute(select(ContextItem).where(ContextItem.item_key == item_key)).scalars().first()
    finally:
        db.close()


def test_batch_applies_all_operations(active_task):
    k1 = f"wp03.a.{uuid4().hex}"
    k2 = f"wp03.b.{uuid4().hex}"
    resp = _batch(
        active_task,
        [
            {"operation": "upsert_context_item", "payload": {"item_key": k1, "item_type": "note", "title": "a"}},
            {"operation": "upsert_context_item", "payload": {"item_key": k2, "item_type": "note", "title": "b"}},
        ],
    )
    assert resp["status"] == "ok"
    assert resp["result"] == "applied"
    assert len(resp["results"]) == 2
    assert _count_item(k1) == 1
    assert _count_item(k2) == 1


def test_batch_dry_run_applies_nothing(active_task):
    k = f"wp03.dry.{uuid4().hex}"
    resp = _batch(
        active_task,
        [{"operation": "upsert_context_item", "payload": {"item_key": k, "item_type": "note", "title": "d"}}],
        dry_run=True,
    )
    assert resp["result"] == "dry_run"
    assert _count_item(k) == 0


def test_batch_unknown_op_rolls_back(active_task):
    k = f"wp03.rollback.{uuid4().hex}"
    resp = _batch(
        active_task,
        [
            {"operation": "upsert_context_item", "payload": {"item_key": k, "item_type": "note", "title": "ok"}},
            {"operation": "frobnicate", "payload": {}},
        ],
    )
    assert resp["status"] == "invalid_request"
    # all-or-nothing: la op 0 (válida) NO persiste porque la op 1 abortó el batch.
    assert _count_item(k) == 0


def test_batch_missing_payload_field_rolls_back(active_task):
    resp = _batch(
        active_task,
        [{"operation": "upsert_context_item", "payload": {"item_type": "note", "title": "sin key"}}],
    )
    assert resp["status"] == "invalid_request"


def test_batch_canon_under_ratify_policy_is_blocked(active_task):
    """Un upsert de categoría canon (goal) bajo política ratify se bloquea con
    ratification_required y 0 mutaciones — cierra el bypass de gobernanza (F03)."""
    db = SessionLocal()
    try:
        ps = get_policy_state(db)
        original = dict(ps.approval_policy_json or {})
        ps.approval_policy_json = {"by_tool": {}, "by_category": {"goal": "ratify"}, "default": "auto"}
        db.add(ps)
        db.commit()
    finally:
        db.close()
    try:
        k = f"wp03.goal.{uuid4().hex}"
        resp = _batch(
            active_task,
            [{"operation": "upsert_context_item", "payload": {"item_key": k, "item_type": "goal", "title": "g"}}],
        )
        assert resp["status"] == "ratification_required"
        assert _count_item(k) == 0
    finally:
        db = SessionLocal()
        try:
            ps = get_policy_state(db)
            ps.approval_policy_json = original
            db.add(ps)
            db.commit()
        finally:
            db.close()


def test_batch_default_note_type_uses_note_ratification(active_task):
    db = SessionLocal()
    try:
        ps = get_policy_state(db)
        original = dict(ps.approval_policy_json or {})
        ps.approval_policy_json = {"by_tool": {}, "by_category": {"note": "ratify"}, "default": "auto"}
        db.add(ps)
        db.commit()
    finally:
        db.close()
    try:
        k = f"wp03.default-note.{uuid4().hex}"
        resp = _batch(
            active_task,
            [{"operation": "upsert_context_item", "payload": {"item_key": k, "title": "default note"}}],
        )
        assert resp["status"] == "ratification_required"
        assert _count_item(k) == 0
    finally:
        db = SessionLocal()
        try:
            ps = get_policy_state(db)
            ps.approval_policy_json = original
            db.add(ps)
            db.commit()
        finally:
            db.close()


def test_batch_conflict_result_aborts_and_rolls_back(active_task):
    existing_key = f"wp03.conflict.existing.{uuid4().hex}"
    before_key = f"wp03.conflict.before.{uuid4().hex}"
    after_key = f"wp03.conflict.after.{uuid4().hex}"

    created = _batch(
        active_task,
        [{"operation": "upsert_context_item", "payload": {"item_key": existing_key, "item_type": "note", "title": "v1"}}],
    )
    assert created["status"] == "ok"
    existing = _get_item(existing_key)
    assert existing is not None

    resp = _batch(
        active_task,
        [
            {"operation": "upsert_context_item", "payload": {"item_key": before_key, "item_type": "note", "title": "before"}},
            {
                "operation": "upsert_context_item",
                "payload": {
                    "item_key": existing_key,
                    "item_type": "note",
                    "title": "stale",
                    "expected_version": int(existing.version) + 1,
                },
            },
            {"operation": "upsert_context_item", "payload": {"item_key": after_key, "item_type": "note", "title": "after"}},
        ],
    )
    assert resp["status"] == "invalid_request"
    assert _count_item(before_key) == 0
    assert _count_item(after_key) == 0


def test_batch_not_found_result_aborts_and_rolls_back(active_task):
    before_key = f"wp03.not-found.before.{uuid4().hex}"
    after_key = f"wp03.not-found.after.{uuid4().hex}"

    resp = _batch(
        active_task,
        [
            {"operation": "upsert_context_item", "payload": {"item_key": before_key, "item_type": "note", "title": "before"}},
            {"operation": "set_context_labels", "payload": {"context_item_id": str(uuid4()), "labels": ["missing"]}},
            {"operation": "upsert_context_item", "payload": {"item_key": after_key, "item_type": "note", "title": "after"}},
        ],
    )
    assert resp["status"] == "invalid_request"
    assert _count_item(before_key) == 0
    assert _count_item(after_key) == 0
