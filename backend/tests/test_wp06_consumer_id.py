"""WP-0.6 — atribución de consumer en eventos y proposals (F17).

Antes, todos los eventos quedaban con consumer_id NULL (append_context_event no
propagaba la identidad), lo que hacía imposible segmentar el brief por agente.
Ahora el evento y la proposal registran el consumer resuelto.
"""

import uuid
from uuid import uuid4

from sqlalchemy import select

from app.db.session import SessionLocal
from app.mcp.server import append_context_event, propose_change
from app.models.consumer import Consumer
from app.models.event import Event
from app.models.proposal import Proposal

_SCOPE = dict(
    workspace_id=None, consumer="chatgpt", session_key="canonical-chatgpt-session"
)


def _scope(active_task):
    return dict(
        workspace_id=str(active_task.workspace_id),
        project_id=str(active_task.project_id),
        task_id=str(active_task.id),
        consumer="chatgpt",
        session_key="canonical-chatgpt-session",
    )


def test_append_event_persists_consumer_id(active_task):
    db = SessionLocal()
    try:
        chatgpt = db.execute(
            select(Consumer).where(Consumer.consumer_type == "chatgpt")
        ).scalars().first()
        assert chatgpt is not None
        chatgpt_id = chatgpt.id
    finally:
        db.close()

    resp = append_context_event(
        event_type="info", summary="wp06 consumer", dry_run=False,
        idempotency_key=f"wp06-ev-{uuid4().hex}", **_scope(active_task),
    )
    assert resp["status"] == "ok"
    event_id = uuid.UUID(resp["event"]["id"])

    db = SessionLocal()
    try:
        ev = db.execute(select(Event).where(Event.id == event_id)).scalars().first()
        assert ev is not None
        assert ev.consumer_id == chatgpt_id  # antes era NULL
    finally:
        db.close()


def test_propose_change_registers_proposer_consumer(active_task):
    target_key = f"wp06.decision.{uuid4().hex}"
    resp = propose_change(
        target_kind="decision", target_key=target_key, rationale="wp06 proposer test",
        dry_run=False, idempotency_key=f"wp06-prop-{uuid4().hex}", **_scope(active_task),
    )
    assert resp["status"] == "ok"

    db = SessionLocal()
    try:
        proposal = db.execute(
            select(Proposal).where(Proposal.target_key == target_key).order_by(Proposal.created_at.desc())
        ).scalars().first()
        assert proposal is not None
        assert proposal.proposer_consumer_id is not None  # el consumer proponente queda registrado
    finally:
        db.close()
