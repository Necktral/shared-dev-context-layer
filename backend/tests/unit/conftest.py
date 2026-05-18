"""Conftest for unit tests that don't require a database."""
import os
import sys
from pathlib import Path

import pytest

sys.path.append(str(Path(__file__).resolve().parents[2]))

os.environ.setdefault("DATABASE_URL", "postgresql://dummy:dummy@localhost/dummy")
os.environ.setdefault("MCP_AUTH_ENABLED", "true")
os.environ.setdefault("MCP_AUTH_BYPASS_LOCAL", "true")


@pytest.fixture(scope="session", autouse=True)
def seeded_data() -> None:  # type: ignore[override]
    """No-op override: unit tests don't require a seeded database."""
