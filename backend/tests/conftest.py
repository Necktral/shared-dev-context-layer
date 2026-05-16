import os
import sys
from pathlib import Path

import pytest
import socket
import urllib.parse
from sqlalchemy import select

sys.path.append(str(Path(__file__).resolve().parents[1]))

os.environ.setdefault("MCP_AUTH_ENABLED", "true")
os.environ.setdefault("MCP_AUTH_BYPASS_LOCAL", "true")

from app.db.seed_v5 import run_seed as run_seed_v5
from app.db.session import SessionLocal
from app.models.task import Task


@pytest.fixture(scope="session", autouse=True)
def seeded_data() -> None:
    run_seed_v5()


@pytest.fixture()
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def _server_reachable(base_url: str, timeout: float = 2.0) -> bool:
    """Devuelve True si host:port del base_url acepta conexión TCP."""
    parsed = urllib.parse.urlparse(base_url)
    host = parsed.hostname or "localhost"
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line("markers", "e2e: tests de integración contra servidor real (requiere servidor en marcha)")


@pytest.fixture(autouse=True)
def skip_e2e_if_server_down(request: pytest.FixtureRequest) -> None:
    """Auto-skip tests marcados con @pytest.mark.e2e si el servidor no es accesible."""
    if request.node.get_closest_marker("e2e"):
        base_url = os.environ.get("MCP_E2E_BASE_URL", "http://localhost:8002")
        if not _server_reachable(base_url):
            pytest.skip(f"Servidor E2E no accesible: {base_url}")


@pytest.fixture()
def active_task(db):
    task = db.execute(select(Task).where(Task.is_active.is_(True)).order_by(Task.updated_at.desc())).scalars().first()
    if task is None:
        raise AssertionError("Expected an active task in seed data.")
    return task
