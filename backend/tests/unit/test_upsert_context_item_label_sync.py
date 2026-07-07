"""
Tests for upsert_context_item label sync behaviour.

These tests verify that upsert_context_item keeps the normalized
context_item_labels table in sync with context_items.labels_json for both
the create and update paths.  They use unittest.mock to avoid a real DB.
"""
from __future__ import annotations

import uuid
from unittest.mock import MagicMock, call, patch

from app.services.context_item_service import upsert_context_item


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_WORKSPACE_ID = uuid.uuid4()
_PROJECT_ID = uuid.uuid4()
_TASK_ID = uuid.uuid4()


def _make_item(item_id: uuid.UUID, *, labels: list[str], version: int = 1) -> MagicMock:
    item = MagicMock()
    item.id = item_id
    item.workspace_id = _WORKSPACE_ID
    item.project_id = _PROJECT_ID
    item.task_id = _TASK_ID
    item.item_key = "test-key"
    item.item_type = "note"
    item.title = "Test Item"
    item.content_json = {}
    item.labels_json = labels
    item.status = "active"
    item.version = version
    item.created_by = "actor"
    item.updated_by = "actor"
    item.created_at = None
    item.updated_at = None
    return item


def _db_stub(existing_item=None) -> MagicMock:
    """Return a minimal Session-like mock."""
    db = MagicMock()
    # scalars().first() return value for SELECT ContextItem
    db.execute.return_value.scalars.return_value.first.return_value = existing_item
    return db


# ---------------------------------------------------------------------------
# Tests – create path
# ---------------------------------------------------------------------------

def test_upsert_create_syncs_label_table() -> None:
    """Creating a new item must populate context_item_labels."""
    db = _db_stub(existing_item=None)

    with patch(
        "app.services.context_item_service._sync_labels_table"
    ) as mock_sync:
        result = upsert_context_item(
            db,
            workspace_id=_WORKSPACE_ID,
            project_id=_PROJECT_ID,
            task_id=_TASK_ID,
            item_key="test-key",
            item_type="note",
            title="Test Item",
            content=None,
            labels=["alpha", "beta"],
            expected_version=None,
            actor="actor",
            dry_run=False,
        )

    mock_sync.assert_called_once()
    call_kwargs = mock_sync.call_args.kwargs
    assert call_kwargs["workspace_id"] == _WORKSPACE_ID
    assert call_kwargs["labels"] == ["alpha", "beta"]
    assert call_kwargs["actor"] == "actor"


def test_upsert_create_dry_run_does_not_sync_label_table() -> None:
    """dry_run=True must not touch the DB at all."""
    db = _db_stub(existing_item=None)

    with patch(
        "app.services.context_item_service._sync_labels_table"
    ) as mock_sync:
        result = upsert_context_item(
            db,
            workspace_id=_WORKSPACE_ID,
            project_id=_PROJECT_ID,
            task_id=_TASK_ID,
            item_key="test-key",
            item_type="note",
            title="Test Item",
            content=None,
            labels=["alpha"],
            expected_version=None,
            actor="actor",
            dry_run=True,
        )

    mock_sync.assert_not_called()
    assert result["result"] == "dry_run"


# ---------------------------------------------------------------------------
# Tests – update path
# ---------------------------------------------------------------------------

def test_upsert_update_syncs_label_table() -> None:
    """Updating an existing item must rebuild context_item_labels."""
    item_id = uuid.uuid4()
    existing = _make_item(item_id, labels=["old"], version=3)
    db = _db_stub(existing_item=existing)

    with patch(
        "app.services.context_item_service._sync_labels_table"
    ) as mock_sync:
        result = upsert_context_item(
            db,
            workspace_id=_WORKSPACE_ID,
            project_id=_PROJECT_ID,
            task_id=_TASK_ID,
            item_key="test-key",
            item_type="note",
            title="Updated Title",
            content={"x": 1},
            labels=["new-a", "new-b"],
            expected_version=None,
            actor="updater",
            dry_run=False,
        )

    mock_sync.assert_called_once()
    call_kwargs = mock_sync.call_args.kwargs
    assert call_kwargs["workspace_id"] == _WORKSPACE_ID
    assert call_kwargs["item_id"] == item_id
    assert call_kwargs["labels"] == ["new-a", "new-b"]
    assert call_kwargs["actor"] == "updater"


def test_upsert_update_dry_run_does_not_sync_label_table() -> None:
    """dry_run=True on update must not touch the DB."""
    existing = _make_item(uuid.uuid4(), labels=["old"], version=1)
    db = _db_stub(existing_item=existing)

    with patch(
        "app.services.context_item_service._sync_labels_table"
    ) as mock_sync:
        result = upsert_context_item(
            db,
            workspace_id=_WORKSPACE_ID,
            project_id=_PROJECT_ID,
            task_id=_TASK_ID,
            item_key="test-key",
            item_type="note",
            title="Title",
            content=None,
            labels=["new"],
            expected_version=None,
            actor="actor",
            dry_run=True,
        )

    mock_sync.assert_not_called()
    assert result["result"] == "dry_run"


def test_upsert_conflict_does_not_sync_label_table() -> None:
    """Version conflict must abort without touching labels."""
    existing = _make_item(uuid.uuid4(), labels=["old"], version=5)
    db = _db_stub(existing_item=existing)

    with patch(
        "app.services.context_item_service._sync_labels_table"
    ) as mock_sync:
        result = upsert_context_item(
            db,
            workspace_id=_WORKSPACE_ID,
            project_id=_PROJECT_ID,
            task_id=_TASK_ID,
            item_key="test-key",
            item_type="note",
            title="Title",
            content=None,
            labels=["new"],
            expected_version=1,  # wrong version → conflict
            actor="actor",
            dry_run=False,
        )

    mock_sync.assert_not_called()
    assert result["result"] == "conflict"
    assert result["actual_version"] == 5
    assert result["expected_version"] == 1
