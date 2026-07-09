from uuid import uuid4

from sqlalchemy import func, select

from app.db.session import SessionLocal
from app.mcp.server import (
    append_context_event,
    apply_sync_batch,
    archive_context_item,
    get_context_by_id,
    get_active_task,
    get_approved_decisions,
    get_context_snapshot,
    get_recent_errors,
    get_sync_status,
    link_context_entities,
    list_context_windows,
    preview_write_impact,
    resolve_related_items,
    search_context,
    set_context_labels,
    upsert_context_item,
    get_validation_status,
)
from app.models.approved_decision import ApprovedDecision
from app.models.context_item import ContextItem
from app.models.context_item_label import ContextItemLabel
from app.models.context_item_link import ContextItemLink
from app.models.context_snapshot import ContextSnapshot
from app.models.context_sync_batch import ContextSyncBatch
from app.models.context_write_audit import ContextWriteAudit
from app.models.event import Event
from app.models.policy_state import PolicyState
from app.models.publish_audit import PublishAudit
from app.models.task import Task


def _read_counts() -> dict[str, int]:
    db = SessionLocal()
    try:
        return {
            "tasks": db.execute(select(func.count()).select_from(Task)).scalar_one(),
            "decisions": db.execute(select(func.count()).select_from(ApprovedDecision)).scalar_one(),
            "events": db.execute(select(func.count()).select_from(Event)).scalar_one(),
            "snapshots": db.execute(select(func.count()).select_from(ContextSnapshot)).scalar_one(),
            "context_items": db.execute(select(func.count()).select_from(ContextItem)).scalar_one(),
            "context_item_links": db.execute(select(func.count()).select_from(ContextItemLink)).scalar_one(),
            "context_item_labels": db.execute(select(func.count()).select_from(ContextItemLabel)).scalar_one(),
            "context_sync_batches": db.execute(select(func.count()).select_from(ContextSyncBatch)).scalar_one(),
            "context_write_audit": db.execute(select(func.count()).select_from(ContextWriteAudit)).scalar_one(),
            "policy": db.execute(select(func.count()).select_from(PolicyState)).scalar_one(),
            "audit": db.execute(select(func.count()).select_from(PublishAudit)).scalar_one(),
        }
    finally:
        db.close()


def test_mcp_tools_compatibility_and_non_mutating_reads(active_task):
    nonce = uuid4().hex
    before = _read_counts()

    base_responses = {
        "get_active_task": get_active_task(),
        "get_context_snapshot": get_context_snapshot(),
        "get_recent_errors": get_recent_errors(),
        "get_validation_status": get_validation_status(),
        "get_approved_decisions": get_approved_decisions(),
        "search_context": search_context(query="bootstrap", limit=10, offset=0),
        "list_context_windows": list_context_windows(window_hours=24, limit=10),
        "get_sync_status": get_sync_status(limit=10),
        "preview_write_impact": preview_write_impact(operation="upsert_context_item", payload={"item_key": "x"}),
    }
    scoped_responses = {
        "get_active_task": get_active_task(
            workspace_id=str(active_task.workspace_id),
            project_id=str(active_task.project_id),
            task_id=str(active_task.id),
            consumer="chatgpt",
            session_key="canonical-chatgpt-session",
        ),
        "get_context_snapshot": get_context_snapshot(
            workspace_id=str(active_task.workspace_id),
            project_id=str(active_task.project_id),
            task_id=str(active_task.id),
            consumer="chatgpt",
            session_key="canonical-chatgpt-session",
        ),
        "get_recent_errors": get_recent_errors(
            workspace_id=str(active_task.workspace_id),
            project_id=str(active_task.project_id),
            task_id=str(active_task.id),
            consumer="chatgpt",
            session_key="canonical-chatgpt-session",
        ),
        "get_validation_status": get_validation_status(
            workspace_id=str(active_task.workspace_id),
            project_id=str(active_task.project_id),
            task_id=str(active_task.id),
            consumer="chatgpt",
            session_key="canonical-chatgpt-session",
        ),
        "get_approved_decisions": get_approved_decisions(
            workspace_id=str(active_task.workspace_id),
            project_id=str(active_task.project_id),
            task_id=str(active_task.id),
            consumer="chatgpt",
            session_key="canonical-chatgpt-session",
        ),
        "search_context": search_context(
            workspace_id=str(active_task.workspace_id),
            project_id=str(active_task.project_id),
            task_id=str(active_task.id),
            query="bootstrap",
            consumer="chatgpt",
            session_key="canonical-chatgpt-session",
        ),
        "list_context_windows": list_context_windows(
            workspace_id=str(active_task.workspace_id),
            project_id=str(active_task.project_id),
            task_id=str(active_task.id),
            window_hours=48,
            consumer="chatgpt",
            session_key="canonical-chatgpt-session",
        ),
        "get_sync_status": get_sync_status(
            workspace_id=str(active_task.workspace_id),
            project_id=str(active_task.project_id),
            task_id=str(active_task.id),
            limit=5,
            consumer="chatgpt",
            session_key="canonical-chatgpt-session",
        ),
    }

    write_dry_run = {
        "upsert_context_item": upsert_context_item(
            item_key="test.dryrun.item",
            item_type="note",
            title="dry run item",
            content={"hello": "world"},
            labels=["dry-run"],
            dry_run=True,
            workspace_id=str(active_task.workspace_id),
            project_id=str(active_task.project_id),
            task_id=str(active_task.id),
            consumer="chatgpt",
            session_key="canonical-chatgpt-session",
        ),
        "append_context_event": append_context_event(
            event_type="info",
            summary="dry run event",
            dry_run=True,
            workspace_id=str(active_task.workspace_id),
            project_id=str(active_task.project_id),
            task_id=str(active_task.id),
            consumer="chatgpt",
            session_key="canonical-chatgpt-session",
        ),
        "apply_sync_batch": apply_sync_batch(
            operations=[{"operation": "upsert_context_item"}],
            dry_run=True,
            workspace_id=str(active_task.workspace_id),
            project_id=str(active_task.project_id),
            task_id=str(active_task.id),
            consumer="chatgpt",
            session_key="canonical-chatgpt-session",
        ),
    }

    for name, payload in {
        **base_responses,
        **{f"scoped_{k}": v for k, v in scoped_responses.items()},
        **write_dry_run,
    }.items():
        assert payload["status"] == "ok", f"{name} returned unexpected status: {payload}"
        assert "resolution_metadata" in payload

    assert base_responses["get_validation_status"]["current_status"] != "unknown"
    assert base_responses["get_recent_errors"]["total"] >= 0
    assert isinstance(base_responses["get_recent_errors"]["errors"], list)
    assert "scope" in base_responses["get_context_snapshot"]
    assert "consumer_context" in base_responses["get_context_snapshot"]
    assert base_responses["get_approved_decisions"]["total"] >= 4
    assert isinstance(base_responses["get_approved_decisions"]["decisions"], list)
    assert isinstance(base_responses["search_context"]["items"], list)
    assert base_responses["preview_write_impact"]["dry_run"] is True
    assert write_dry_run["upsert_context_item"]["result"] in {"dry_run", "created", "updated", "conflict"}
    assert write_dry_run["append_context_event"]["result"] == "dry_run"
    assert write_dry_run["apply_sync_batch"]["result"] == "dry_run"

    created = upsert_context_item(
        item_key=f"test.commit.item.{nonce}",
        item_type="note",
        title="commit item",
        content={"mode": "commit"},
        labels=["alpha", "beta"],
        dry_run=False,
        idempotency_key=f"test-commit-upsert-1-{nonce}",
        workspace_id=str(active_task.workspace_id),
        project_id=str(active_task.project_id),
        task_id=str(active_task.id),
        consumer="chatgpt",
        session_key="canonical-chatgpt-session",
    )
    assert created["status"] == "ok"
    created_item_id = created["after"]["id"]

    labels = set_context_labels(
        context_item_id=created_item_id,
        labels=["alpha", "gamma"],
        dry_run=False,
        idempotency_key=f"test-set-labels-1-{nonce}",
        workspace_id=str(active_task.workspace_id),
        project_id=str(active_task.project_id),
        task_id=str(active_task.id),
        consumer="chatgpt",
        session_key="canonical-chatgpt-session",
    )
    assert labels["status"] == "ok"

    link_target = upsert_context_item(
        item_key=f"test.commit.item.target.{nonce}",
        item_type="note",
        title="commit item target",
        dry_run=False,
        idempotency_key=f"test-commit-upsert-2-{nonce}",
        workspace_id=str(active_task.workspace_id),
        project_id=str(active_task.project_id),
        task_id=str(active_task.id),
        consumer="chatgpt",
        session_key="canonical-chatgpt-session",
    )
    target_item_id = link_target["after"]["id"]

    linked = link_context_entities(
        source_item_id=created_item_id,
        target_item_id=target_item_id,
        relation="depends_on",
        metadata={"kind": "test"},
        dry_run=False,
        idempotency_key=f"test-link-1-{nonce}",
        workspace_id=str(active_task.workspace_id),
        project_id=str(active_task.project_id),
        task_id=str(active_task.id),
        consumer="chatgpt",
        session_key="canonical-chatgpt-session",
    )
    assert linked["status"] == "ok"

    related = resolve_related_items(
        context_item_id=created_item_id,
        limit=10,
        workspace_id=str(active_task.workspace_id),
        project_id=str(active_task.project_id),
        task_id=str(active_task.id),
        consumer="chatgpt",
        session_key="canonical-chatgpt-session",
    )
    assert related["status"] == "ok"
    assert related["total"] >= 1

    fetched = get_context_by_id(
        context_item_id=created_item_id,
        workspace_id=str(active_task.workspace_id),
        project_id=str(active_task.project_id),
        task_id=str(active_task.id),
        consumer="chatgpt",
        session_key="canonical-chatgpt-session",
    )
    assert fetched["status"] == "ok"
    assert fetched["item"]["id"] == created_item_id

    event_created = append_context_event(
        event_type="error",
        summary="commit event",
        severity="error",
        dry_run=False,
        idempotency_key=f"test-append-event-1-{nonce}",
        workspace_id=str(active_task.workspace_id),
        project_id=str(active_task.project_id),
        task_id=str(active_task.id),
        consumer="chatgpt",
        session_key="canonical-chatgpt-session",
    )
    assert event_created["status"] == "ok"
    assert event_created["result"] == "created"

    archived = archive_context_item(
        context_item_id=created_item_id,
        dry_run=False,
        idempotency_key=f"test-archive-1-{nonce}",
        workspace_id=str(active_task.workspace_id),
        project_id=str(active_task.project_id),
        task_id=str(active_task.id),
        consumer="chatgpt",
        session_key="canonical-chatgpt-session",
    )
    assert archived["status"] == "ok"
    assert archived["result"] == "archived"

    batch = apply_sync_batch(
        operations=[
            {
                "operation": "upsert_context_item",
                "payload": {"item_key": f"batch.item.{nonce}", "item_type": "note", "title": "batch upsert"},
            }
        ],
        dry_run=False,
        idempotency_key=f"test-batch-1-{nonce}",
        workspace_id=str(active_task.workspace_id),
        project_id=str(active_task.project_id),
        task_id=str(active_task.id),
        consumer="chatgpt",
        session_key="canonical-chatgpt-session",
    )
    assert batch["status"] == "ok"
    assert batch["result"] == "applied"

    batch_replay = apply_sync_batch(
        operations=[
            {
                "operation": "upsert_context_item",
                "payload": {"item_key": f"batch.item.{nonce}", "item_type": "note", "title": "batch upsert"},
            }
        ],
        dry_run=False,
        idempotency_key=f"test-batch-1-{nonce}",
        workspace_id=str(active_task.workspace_id),
        project_id=str(active_task.project_id),
        task_id=str(active_task.id),
        consumer="chatgpt",
        session_key="canonical-chatgpt-session",
    )
    assert batch_replay["status"] == "ok"
    assert batch_replay["idempotent_replay"] is True

    after = _read_counts()
    assert after["tasks"] == before["tasks"]
    assert after["decisions"] == before["decisions"]
    assert after["events"] == before["events"] + 1
    assert after["snapshots"] == before["snapshots"]
    assert after["context_items"] >= before["context_items"] + 2
    assert after["context_item_links"] >= before["context_item_links"] + 1
    assert after["context_item_labels"] >= before["context_item_labels"] + 2
    assert after["context_sync_batches"] >= before["context_sync_batches"] + 1
    assert after["context_write_audit"] >= before["context_write_audit"] + 9
    assert after["policy"] == before["policy"]
    assert after["audit"] >= before["audit"] + 18
