import pytest

from app.services.proposal_service import (
    InvalidProposalInput,
    InvalidProposalTransition,
    create_proposal,
    find_ratified_proposal,
    list_proposals_for_target,
    transition_proposal,
)


def _new(db, active_task, **kw):
    return create_proposal(
        db,
        workspace_id=active_task.workspace_id,
        project_id=active_task.project_id,
        task_id=active_task.id,
        target_kind=kw.pop("target_kind", "decision"),
        target_key=kw.pop("target_key", "money_path.assumptions"),
        rationale=kw.pop("rationale", "propuesta de prueba"),
        **kw,
    )


def test_create_defaults_to_proposed(db, active_task):
    p = _new(db, active_task)
    assert p.id is not None
    assert p.status == "proposed"
    assert p.ratified_by is None


def test_full_lifecycle_to_ratified(db, active_task):
    p = _new(db, active_task)
    transition_proposal(db, p, "in_review")
    assert p.status == "in_review"
    transition_proposal(db, p, "ratified", ratified_by="auth0|human-123")
    assert p.status == "ratified"
    assert p.ratified_by == "auth0|human-123"
    assert p.ratified_at is not None
    found = find_ratified_proposal(
        db, workspace_id=p.workspace_id, target_kind=p.target_kind, target_key=p.target_key
    )
    assert found is not None and found.id == p.id


def test_invalid_transition_skips_review(db, active_task):
    p = _new(db, active_task)
    with pytest.raises(InvalidProposalTransition):
        transition_proposal(db, p, "ratified", ratified_by="x")


def test_ratify_requires_human_identity(db, active_task):
    p = _new(db, active_task)
    transition_proposal(db, p, "in_review")
    with pytest.raises(InvalidProposalInput):
        transition_proposal(db, p, "ratified")  # falta ratified_by


def test_terminal_state_is_final(db, active_task):
    p = _new(db, active_task)
    transition_proposal(db, p, "rejected")
    assert p.status == "rejected"
    with pytest.raises(InvalidProposalTransition):
        transition_proposal(db, p, "in_review")


def test_invalid_target_kind_rejected(db, active_task):
    with pytest.raises(InvalidProposalInput):
        _new(db, active_task, target_kind="bogus")


def test_idempotent_create(db, active_task):
    a = _new(db, active_task, idempotency_key="idem-1", target_key="idem.target")
    b = _new(db, active_task, idempotency_key="idem-1", target_key="idem.target")
    assert a.id == b.id


def test_dissent_multiple_proposals_same_target(db, active_task):
    # I2: dos propuestas coexisten sobre el mismo target (disenso preservado).
    p1 = _new(db, active_task, target_key="same.target")
    p2 = _new(db, active_task, target_key="same.target")
    transition_proposal(db, p1, "in_review")
    transition_proposal(db, p2, "in_review")
    rows = list_proposals_for_target(
        db,
        workspace_id=active_task.workspace_id,
        target_kind="decision",
        target_key="same.target",
        statuses=["in_review"],
    )
    assert len({r.id for r in rows}) >= 2
