import pytest
from sqlalchemy import select

from app.models.context_scope import ContextScope
from app.models.context_snapshot import ContextSnapshot
from app.services.approval_policy_service import requires_ratification
from app.services.deliberation_service import (
    list_deliberation_trail,
    record_proposal_event,
)
from app.services.proposal_service import create_proposal
from app.services.staleness_service import invalidate_context_for_scope


def _proposal(db, active_task, **kw):
    return create_proposal(
        db,
        workspace_id=active_task.workspace_id,
        project_id=active_task.project_id,
        task_id=active_task.id,
        target_kind="decision",
        target_key=kw.pop("target_key", "money_path.assumptions"),
        rationale="r",
        **kw,
    )


# --- Paso 4: granularidad ---

def test_requires_ratification_default_auto():
    assert requires_ratification({}, category="decision") is False
    assert requires_ratification(None, tool_name="upsert_context_item") is False


def test_requires_ratification_by_category():
    pol = {"by_category": {"money_path": "ratify"}, "default": "auto"}
    assert requires_ratification(pol, category="money_path") is True
    assert requires_ratification(pol, category="label") is False


def test_by_tool_overrides_category():
    pol = {"by_tool": {"apply_sync_batch": "ratify"}, "by_category": {"decision": "auto"}, "default": "auto"}
    assert requires_ratification(pol, tool_name="apply_sync_batch", category="decision") is True


# --- Paso 2: deliberation trail ---

def test_record_and_list_trail(db, active_task):
    p = _proposal(db, active_task, target_key="trail.target")
    record_proposal_event(db, proposal=p, event_type="proposal.raised", summary="propuesta creada")
    record_proposal_event(db, proposal=p, event_type="proposal.objected", summary="objeción")
    trail = list_deliberation_trail(db, proposal_id=p.id)
    assert [e.event_type for e in trail] == ["proposal.raised", "proposal.objected"]
    assert all(e.proposal_id == p.id for e in trail)


def test_invalid_proposal_event_type(db, active_task):
    p = _proposal(db, active_task, target_key="trail.bad")
    with pytest.raises(ValueError):
        record_proposal_event(db, proposal=p, event_type="bogus", summary="x")


# --- Paso 6: staleness ---

def test_invalidate_snapshot(db, active_task):
    snap = ContextSnapshot(
        task_id=active_task.id,
        workspace_id=active_task.workspace_id,
        project_id=active_task.project_id,
        snapshot_type="operational",
        snapshot_content={"x": 1},
        policy_applied="delegated_limited",
        is_current=True,
        version=1,
    )
    db.add(snap)
    db.flush()
    res = invalidate_context_for_scope(
        db,
        workspace_id=active_task.workspace_id,
        project_id=active_task.project_id,
        task_id=active_task.id,
    )
    db.refresh(snap)
    assert snap.is_current is False
    assert res["snapshots_invalidated"] >= 1


def test_invalidate_existing_current_scope(db):
    # context_scopes tiene un scope current único (constraint global): usamos el sembrado.
    current = db.execute(
        select(ContextScope).where(ContextScope.is_current.is_(True))
    ).scalars().first()
    if current is None:
        pytest.skip("sin scope current sembrado")
    res = invalidate_context_for_scope(db, workspace_id=current.workspace_id)
    db.refresh(current)
    assert current.is_current is False
    assert res["scopes_invalidated"] >= 1
