"""Integration test configuration.

This conftest overrides the root conftest to allow running integration tests
without a real PostgreSQL database (uses SQLite in-memory for CI).
"""

import os
import sys
from pathlib import Path

# Set required env vars BEFORE any app imports
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("MCP_AUTH_ENABLED", "true")
os.environ.setdefault("MCP_AUTH_BYPASS_LOCAL", "true")

# Ensure backend is on path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

# Register SQLite compilation hooks for PostgreSQL-specific types
from sqlalchemy import JSON
from sqlalchemy.dialects.postgresql import UUID as PG_UUID, JSONB
from sqlalchemy.ext.compiler import compiles


@compiles(JSONB, "sqlite")
def _compile_jsonb_sqlite(type_, compiler, **kw):
    return "JSON"


@compiles(PG_UUID, "sqlite")
def _compile_uuid_sqlite(type_, compiler, **kw):
    return "CHAR(32)"


# Override the root conftest's seeded_data fixture (not needed here)
import pytest


@pytest.fixture(scope="session", autouse=True)
def seeded_data():
    """No-op override: integration tests create their own data."""
    pass
