import uuid

from app.services.focus_resolver import resolve_scope


def test_focus_resolver_resolves_by_task_precedence(db, active_task):
    resolved = resolve_scope(
        db,
        task_id=str(active_task.id),
        project_id=str(active_task.project_id),
        workspace_id=str(active_task.workspace_id),
        consumer="chatgpt",
        session_key="canonical-chatgpt-session",
    )
    assert resolved.status == "ok"
    assert resolved.task is not None
    assert resolved.task.id == active_task.id
    assert resolved.project is not None
    assert resolved.project.id == active_task.project_id
    assert resolved.workspace is not None
    assert resolved.workspace.id == active_task.workspace_id
    assert resolved.resolution_metadata["source"] == "task_id"


def test_focus_resolver_detects_task_project_conflict(db, active_task):
    resolved = resolve_scope(
        db,
        task_id=str(active_task.id),
        project_id=str(uuid.uuid4()),
    )
    assert resolved.status == "scope_conflict"
    assert "task_project_mismatch" in resolved.resolution_metadata["conflict_flags"]


def test_focus_resolver_fallbacks_to_canonical_scope(db, active_task):
    resolved = resolve_scope(db)
    assert resolved.status == "ok"
    assert resolved.task is not None
    assert resolved.task.id == active_task.id
    assert resolved.resolution_metadata["source"] in {"canonical_scope", "legacy_active_task"}


def test_focus_resolver_rejects_invalid_uuid(db):
    resolved = resolve_scope(db, task_id="not-a-uuid")
    assert resolved.status == "scope_invalid"
    assert "invalid_task_id" in resolved.resolution_metadata["conflict_flags"]
