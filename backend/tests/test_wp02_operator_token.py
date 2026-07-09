"""WP-0.2 — la ratificación exige un operator-token que el bypass NO satisface (F07).

Bajo MCP_AUTH_BYPASS_LOCAL=true el _scope_guard concede TODOS los scopes (incluido
wis.context.ratify) sin token, con lo que la "decisión humana" quedaba auto-aprobable
por máquina. El operator-token se verifica SIEMPRE, incluso bajo bypass.
"""

from uuid import uuid4

from app.db.session import SessionLocal
from app.mcp.server import ratify_proposal, reject_proposal
from app.services.proposal_service import create_proposal, transition_proposal

_TOKEN = "test-operator-token"  # coincide con OPERATOR_RATIFY_TOKEN del conftest


def _scope(active_task):
    return dict(
        workspace_id=str(active_task.workspace_id),
        project_id=str(active_task.project_id),
        task_id=str(active_task.id),
        consumer="chatgpt",
        session_key="canonical-chatgpt-session",
    )


def _proposal_in_review(active_task, target_key):
    db = SessionLocal()
    try:
        p = create_proposal(
            db,
            workspace_id=active_task.workspace_id,
            project_id=active_task.project_id,
            task_id=active_task.id,
            target_kind="decision",
            target_key=target_key,
            rationale="wp02e",
        )
        transition_proposal(db, p, "in_review")
        db.commit()
        return p.id
    finally:
        db.close()


def test_ratify_without_operator_token_is_rejected_even_under_bypass(active_task):
    pid = _proposal_in_review(active_task, f"wp02e.ratify.{uuid4().hex}")
    scope = _scope(active_task)
    # Sin token: rechazado aunque el bypass conceda el scope .ratify.
    blocked = ratify_proposal(proposal_id=str(pid), **scope)
    assert blocked["status"] == "operator_token_invalid"
    # Con token válido: pasa el gate del operator-token y ratifica.
    ok = ratify_proposal(proposal_id=str(pid), operator_token=_TOKEN, **scope)
    assert ok["status"] != "operator_token_invalid"


def test_reject_without_operator_token_is_rejected(active_task):
    pid = _proposal_in_review(active_task, f"wp02e.reject.{uuid4().hex}")
    scope = _scope(active_task)
    blocked = reject_proposal(proposal_id=str(pid), reason="no", **scope)
    assert blocked["status"] == "operator_token_invalid"
    ok = reject_proposal(proposal_id=str(pid), reason="no", operator_token=_TOKEN, **scope)
    assert ok["status"] != "operator_token_invalid"


def test_wrong_operator_token_is_rejected(active_task):
    pid = _proposal_in_review(active_task, f"wp02e.wrong.{uuid4().hex}")
    blocked = ratify_proposal(proposal_id=str(pid), operator_token="nope", **_scope(active_task))
    assert blocked["status"] == "operator_token_invalid"
