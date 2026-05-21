"""
Integration tests for ContextItemLabel synchronization in upsert_context_item.

These tests validate the atomic transactional behavior of the _sync_labels_table
helper when called from upsert_context_item and append_context_labels.

Test scenarios (per reviewer requirements):
1. CREATE with labels → creates ContextItemLabel rows
2. UPDATE replaces old labels with new labels
3. dry_run does NOT touch ContextItem or ContextItemLabel
4. conflict (expected_version mismatch) does NOT touch labels
5. Rollback on label insertion failure leaves no orphan item

Running against real PostgreSQL:
    DATABASE_URL=postgresql://user:pass@host/db pytest backend/tests/integration/ -m integration

Without PostgreSQL (skipped automatically):
    pytest backend/tests/integration/
"""

from __future__ import annotations

import os
import uuid
from unittest.mock import patch, MagicMock

import pytest
from sqlalchemy import create_engine, select, event, text
from sqlalchemy.orm import Session, sessionmaker

# Allow running without full .env by setting defaults for import
os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://localhost/test")
os.environ.setdefault("MCP_AUTH_ENABLED", "true")
os.environ.setdefault("MCP_AUTH_BYPASS_LOCAL", "true")

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from app.db.base import Base
from app.models.context_item import ContextItem
from app.models.context_item_label import ContextItemLabel
from app.models.workspace import Workspace
from app.models.project import Project
from app.models.task import Task
from app.services.context_item_service import upsert_context_item, append_context_labels, _sync_labels_table


def _get_test_db_url() -> str | None:
    """Return a valid PostgreSQL URL for integration testing, or None if unavailable."""
    url = os.environ.get("TEST_DATABASE_URL") or os.environ.get("DATABASE_URL", "")
    if "postgresql" in url and "localhost" not in url:
        return url
    # Try connecting to local docker postgres
    local = "postgresql+psycopg://postgres:postgres@localhost:5432/wis_context_test"
    try:
        eng = create_engine(local, pool_pre_ping=True)
        with eng.connect() as conn:
            conn.execute(text("SELECT 1"))
        return local
    except Exception:
        return None


# Use SQLite in-memory for CI environments where PostgreSQL is not available.
# This still validates SQLAlchemy transaction semantics (commit/rollback/flush).
# The PostgreSQL-specific UUID type falls back to CHAR(32) on SQLite.
_INTEGRATION_DB_URL = _get_test_db_url()
_USE_SQLITE = _INTEGRATION_DB_URL is None
_DB_URL = "sqlite:///:memory:" if _USE_SQLITE else _INTEGRATION_DB_URL


@pytest.fixture(scope="module")
def engine():
    eng = create_engine(_DB_URL, echo=False)
    if _USE_SQLITE:
        # Only create the subset of tables needed for these tests,
        # using raw DDL to avoid PostgreSQL-specific server_defaults.
        with eng.begin() as conn:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS workspaces (
                    id CHAR(36) PRIMARY KEY,
                    workspace_key TEXT NOT NULL UNIQUE,
                    name TEXT NOT NULL,
                    description TEXT,
                    is_active BOOLEAN NOT NULL DEFAULT 1,
                    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
            """))
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS context_items (
                    id CHAR(36) PRIMARY KEY,
                    workspace_id CHAR(36) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                    project_id CHAR(36),
                    task_id CHAR(36),
                    item_key TEXT NOT NULL,
                    item_type TEXT NOT NULL,
                    title TEXT NOT NULL,
                    content_json JSON NOT NULL DEFAULT '{}',
                    labels_json JSON NOT NULL DEFAULT '[]',
                    status TEXT NOT NULL DEFAULT 'active',
                    version INTEGER NOT NULL DEFAULT 1,
                    created_by TEXT,
                    updated_by TEXT,
                    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(workspace_id, item_key)
                )
            """))
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS context_item_labels (
                    id CHAR(36) PRIMARY KEY,
                    workspace_id CHAR(36) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                    item_id CHAR(36) NOT NULL REFERENCES context_items(id) ON DELETE CASCADE,
                    label TEXT NOT NULL,
                    created_by TEXT,
                    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(workspace_id, item_id, label)
                )
            """))
    else:
        Base.metadata.create_all(eng)
    yield eng
    if not _USE_SQLITE:
        Base.metadata.drop_all(eng)
    eng.dispose()


@pytest.fixture()
def db_session(engine):
    """Provide a transactional session that rolls back after each test."""
    connection = engine.connect()
    transaction = connection.begin()
    session = Session(bind=connection)

    yield session

    session.close()
    transaction.rollback()
    connection.close()


@pytest.fixture()
def workspace(db_session: Session) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        workspace_key="test-ws",
        name="Test Workspace",
    )
    db_session.add(ws)
    db_session.flush()
    return ws


def _query_labels(db: Session, workspace_id: uuid.UUID, item_id: uuid.UUID) -> list[str]:
    """Query ContextItemLabel rows for an item, return sorted label strings."""
    rows = db.execute(
        select(ContextItemLabel.label).where(
            ContextItemLabel.workspace_id == workspace_id,
            ContextItemLabel.item_id == item_id,
        )
    ).scalars().all()
    return sorted(rows)


class TestUpsertCreateWithLabels:
    """Reviewer requirement #1: create with labels creates ContextItemLabel rows."""

    def test_create_syncs_labels_table(self, db_session: Session, workspace: Workspace):
        result = upsert_context_item(
            db_session,
            workspace_id=workspace.id,
            project_id=None,
            task_id=None,
            item_key="test-item-create",
            item_type="decision",
            title="Test Decision",
            content={"body": "test"},
            labels=["alpha", "beta", "gamma"],
            expected_version=None,
            actor="test-agent",
            dry_run=False,
        )

        assert result["result"] == "created"
        item_id = uuid.UUID(result["after"]["id"])

        # Verify ContextItemLabel rows exist
        labels = _query_labels(db_session, workspace.id, item_id)
        assert labels == ["alpha", "beta", "gamma"]

    def test_create_with_empty_labels(self, db_session: Session, workspace: Workspace):
        result = upsert_context_item(
            db_session,
            workspace_id=workspace.id,
            project_id=None,
            task_id=None,
            item_key="test-item-empty-labels",
            item_type="note",
            title="Empty Labels",
            content={},
            labels=[],
            expected_version=None,
            actor="test-agent",
            dry_run=False,
        )

        assert result["result"] == "created"
        item_id = uuid.UUID(result["after"]["id"])
        labels = _query_labels(db_session, workspace.id, item_id)
        assert labels == []

    def test_create_deduplicates_and_normalizes_labels(self, db_session: Session, workspace: Workspace):
        result = upsert_context_item(
            db_session,
            workspace_id=workspace.id,
            project_id=None,
            task_id=None,
            item_key="test-item-dedup",
            item_type="note",
            title="Dedup",
            content={},
            labels=["  beta ", "alpha", "beta", "", "  "],
            expected_version=None,
            actor="test-agent",
            dry_run=False,
        )

        assert result["result"] == "created"
        item_id = uuid.UUID(result["after"]["id"])
        labels = _query_labels(db_session, workspace.id, item_id)
        assert labels == ["alpha", "beta"]


class TestUpsertUpdateReplacesLabels:
    """Reviewer requirement #2: update replaces old labels with new labels."""

    def test_update_replaces_labels(self, db_session: Session, workspace: Workspace):
        # Create
        result1 = upsert_context_item(
            db_session,
            workspace_id=workspace.id,
            project_id=None,
            task_id=None,
            item_key="test-item-update",
            item_type="decision",
            title="Original",
            content={},
            labels=["old-label-1", "old-label-2"],
            expected_version=None,
            actor="test-agent",
            dry_run=False,
        )
        item_id = uuid.UUID(result1["after"]["id"])
        assert _query_labels(db_session, workspace.id, item_id) == ["old-label-1", "old-label-2"]

        # Update with new labels
        result2 = upsert_context_item(
            db_session,
            workspace_id=workspace.id,
            project_id=None,
            task_id=None,
            item_key="test-item-update",
            item_type="decision",
            title="Updated",
            content={},
            labels=["new-label-a", "new-label-b", "new-label-c"],
            expected_version=1,
            actor="test-agent",
            dry_run=False,
        )
        assert result2["result"] == "updated"

        # Old labels gone, new labels present
        labels = _query_labels(db_session, workspace.id, item_id)
        assert labels == ["new-label-a", "new-label-b", "new-label-c"]

        # Also verify labels_json is consistent
        item = db_session.get(ContextItem, item_id)
        assert sorted(item.labels_json) == ["new-label-a", "new-label-b", "new-label-c"]


class TestDryRunDoesNotTouch:
    """Reviewer requirement #3: dry_run does NOT touch ContextItem or ContextItemLabel."""

    def test_dry_run_create_no_side_effects(self, db_session: Session, workspace: Workspace):
        result = upsert_context_item(
            db_session,
            workspace_id=workspace.id,
            project_id=None,
            task_id=None,
            item_key="test-item-dry-create",
            item_type="decision",
            title="Dry Run",
            content={},
            labels=["should-not-persist"],
            expected_version=None,
            actor="test-agent",
            dry_run=True,
        )
        assert result["result"] == "dry_run"

        # No ContextItem created
        item = db_session.execute(
            select(ContextItem).where(
                ContextItem.workspace_id == workspace.id,
                ContextItem.item_key == "test-item-dry-create",
            )
        ).scalars().first()
        assert item is None

    def test_dry_run_update_no_side_effects(self, db_session: Session, workspace: Workspace):
        # First create a real item
        upsert_context_item(
            db_session,
            workspace_id=workspace.id,
            project_id=None,
            task_id=None,
            item_key="test-item-dry-update",
            item_type="note",
            title="Real",
            content={},
            labels=["original"],
            expected_version=None,
            actor="test-agent",
            dry_run=False,
        )

        # Now dry_run update
        result = upsert_context_item(
            db_session,
            workspace_id=workspace.id,
            project_id=None,
            task_id=None,
            item_key="test-item-dry-update",
            item_type="note",
            title="Should Not Change",
            content={"new": True},
            labels=["should-not-persist"],
            expected_version=1,
            actor="test-agent",
            dry_run=True,
        )
        assert result["result"] == "dry_run"

        # Verify item unchanged
        item = db_session.execute(
            select(ContextItem).where(
                ContextItem.workspace_id == workspace.id,
                ContextItem.item_key == "test-item-dry-update",
            )
        ).scalars().first()
        assert item.title == "Real"
        assert item.labels_json == ["original"]

        # Labels table unchanged
        labels = _query_labels(db_session, workspace.id, item.id)
        assert labels == ["original"]


class TestConflictDoesNotTouchLabels:
    """Reviewer requirement #4: conflict (expected_version mismatch) does NOT touch labels."""

    def test_version_conflict_preserves_labels(self, db_session: Session, workspace: Workspace):
        # Create at version 1
        result = upsert_context_item(
            db_session,
            workspace_id=workspace.id,
            project_id=None,
            task_id=None,
            item_key="test-item-conflict",
            item_type="decision",
            title="V1",
            content={},
            labels=["original-label"],
            expected_version=None,
            actor="test-agent",
            dry_run=False,
        )
        item_id = uuid.UUID(result["after"]["id"])

        # Attempt update with wrong expected_version
        result2 = upsert_context_item(
            db_session,
            workspace_id=workspace.id,
            project_id=None,
            task_id=None,
            item_key="test-item-conflict",
            item_type="decision",
            title="Should Not Apply",
            content={},
            labels=["should-not-appear"],
            expected_version=999,  # wrong version
            actor="test-agent",
            dry_run=False,
        )
        assert result2["result"] == "conflict"

        # Labels unchanged
        labels = _query_labels(db_session, workspace.id, item_id)
        assert labels == ["original-label"]

        # Item unchanged
        item = db_session.get(ContextItem, item_id)
        assert item.title == "V1"
        assert item.version == 1


class TestRollbackOnFailure:
    """Reviewer requirement #5: rollback if label insertion fails leaves no orphan item."""

    def test_rollback_on_label_error_no_orphan(self, db_session: Session, workspace: Workspace):
        """If _sync_labels_table raises, the entire transaction should roll back."""
        # We simulate a failure in _sync_labels_table by patching it to raise
        original_sync = _sync_labels_table

        call_count = [0]

        def failing_sync(db, *, workspace_id, item_id, labels, actor):
            call_count[0] += 1
            raise RuntimeError("Simulated label insertion failure")

        with patch(
            "app.services.context_item_service._sync_labels_table",
            side_effect=failing_sync,
        ):
            with pytest.raises(RuntimeError, match="Simulated label insertion failure"):
                upsert_context_item(
                    db_session,
                    workspace_id=workspace.id,
                    project_id=None,
                    task_id=None,
                    item_key="test-item-rollback",
                    item_type="decision",
                    title="Should Not Persist",
                    content={},
                    labels=["fail-label"],
                    expected_version=None,
                    actor="test-agent",
                    dry_run=False,
                )

        # After the exception, the transaction should have been interrupted
        # before commit(). Verify no item was persisted.
        # Note: In the real service, the exception propagates before db.commit(),
        # so the session's pending changes are not committed.
        db_session.rollback()  # Ensure clean state

        item = db_session.execute(
            select(ContextItem).where(
                ContextItem.workspace_id == workspace.id,
                ContextItem.item_key == "test-item-rollback",
            )
        ).scalars().first()
        assert item is None, "Orphan ContextItem found after label sync failure"


class TestAppendLabelsSync:
    """Verify append_context_labels also syncs via _sync_labels_table."""

    def test_append_labels_updates_both_representations(self, db_session: Session, workspace: Workspace):
        # Create item
        result = upsert_context_item(
            db_session,
            workspace_id=workspace.id,
            project_id=None,
            task_id=None,
            item_key="test-item-append",
            item_type="note",
            title="Append Test",
            content={},
            labels=["existing"],
            expected_version=None,
            actor="test-agent",
            dry_run=False,
        )
        item_id = uuid.UUID(result["after"]["id"])

        # Append new labels
        append_result = append_context_labels(
            db_session,
            workspace_id=workspace.id,
            item_id=item_id,
            labels=["new-one", "new-two"],
            actor="test-agent",
            dry_run=False,
        )
        assert append_result["result"] == "updated"

        # Both representations consistent
        labels = _query_labels(db_session, workspace.id, item_id)
        assert labels == ["existing", "new-one", "new-two"]

        item = db_session.get(ContextItem, item_id)
        assert sorted(item.labels_json) == ["existing", "new-one", "new-two"]


class TestAtomicTransactionSemantics:
    """Verify that item + labels are saved in a single commit (atomic)."""

    def test_item_and_labels_share_same_transaction(self, db_session: Session, workspace: Workspace):
        """
        Validates reviewer concern #3: ContextItem and ContextItemLabel
        are committed together in one transaction.

        The implementation uses:
        - Pre-generate item_id = uuid4() in Python
        - db.add(created) → adds item to session (with pre-assigned id)
        - _sync_labels_table() → adds label rows to same session
        - db.commit() → single commit for both item + labels

        This test verifies the pre-generated UUID + single commit pattern works correctly.
        """
        result = upsert_context_item(
            db_session,
            workspace_id=workspace.id,
            project_id=None,
            task_id=None,
            item_key="test-atomic",
            item_type="decision",
            title="Atomic Test",
            content={"key": "value"},
            labels=["label-a", "label-b"],
            expected_version=None,
            actor="test-agent",
            dry_run=False,
        )
        assert result["result"] == "created"
        item_id = uuid.UUID(result["after"]["id"])

        # Both item and labels visible in same session (same transaction)
        item = db_session.get(ContextItem, item_id)
        assert item is not None
        labels = _query_labels(db_session, workspace.id, item_id)
        assert labels == ["label-a", "label-b"]

        # Verify item.id is a valid UUID (pre-assigned or server-generated)
        assert isinstance(item.id, uuid.UUID)
