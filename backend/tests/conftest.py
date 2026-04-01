import os
import sys
from pathlib import Path

import pytest
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


@pytest.fixture()
def active_task(db):
    task = db.execute(select(Task).where(Task.is_active.is_(True)).order_by(Task.updated_at.desc())).scalars().first()
    if task is None:
        raise AssertionError("Expected an active task in seed data.")
    return task
