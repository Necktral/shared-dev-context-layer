#!/usr/bin/env python3
"""Arranque NATIVO del stack WIS (sin docker) para desarrollo en Ubuntu.

Levanta un Postgres embebido (pgserver, no requiere root ni instalar Postgres),
aplica migraciones Alembic + seed y corre el backend REST (:8001) y el servidor
MCP (:8002) en modo local sin auth (MCP_AUTH_BYPASS_LOCAL).

Pensado como alternativa a `docker compose up` cuando no hay Docker disponible.

Requisitos (una sola vez):
    python3 -m venv .venv && . .venv/bin/activate
    pip install -r backend/requirements.txt pgserver

Uso:
    python scripts/dev_native.py        # Ctrl-C para detener todo

Variables opcionales:
    PGDATA_DIR   (default: .pg-dev)   BACKEND_PORT (8001)   MCP_PORT (8002)
"""
from __future__ import annotations

import atexit
import os
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
BACKEND = REPO / "backend"
PGDATA = Path(os.environ.get("PGDATA_DIR", str(REPO / ".pg-dev")))
BACKEND_PORT = os.environ.get("BACKEND_PORT", "8001")
MCP_PORT = os.environ.get("MCP_PORT", "8002")

try:
    import pgserver
except ImportError:
    sys.exit("Falta pgserver. Instala:  pip install pgserver")


def ensure_pgcrypto_stub() -> None:
    """El Postgres embebido de pgserver no incluye el contrib `pgcrypto`.
    El esquema solo lo referencia por compatibilidad y usa gen_random_uuid(),
    que es parte del core en PG13+. Dejamos un stub para que
    `CREATE EXTENSION IF NOT EXISTS pgcrypto` no falle en este modo dev."""
    ext = Path(pgserver.__file__).parent / "pginstall/share/postgresql/extension"
    control = ext / "pgcrypto.control"
    if ext.exists() and not control.exists():
        control.write_text("comment = 'dev stub'\ndefault_version = '1.3'\nrelocatable = true\n")
        (ext / "pgcrypto--1.3.sql").write_text("-- dev stub: gen_random_uuid() is core in PG16\n")


def port_open(port: str) -> bool:
    with socket.socket() as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", int(port))) == 0


print(f"[dev] Postgres embebido en {PGDATA}")
PGDATA.mkdir(parents=True, exist_ok=True)
server = pgserver.get_server(str(PGDATA))
ensure_pgcrypto_stub()
if "1" not in server.psql("SELECT 1 FROM pg_database WHERE datname='wis_context';"):
    server.psql("CREATE DATABASE wis_context;")
database_url = server.get_uri(database="wis_context")

env = dict(os.environ)
env.update({
    "DATABASE_URL": database_url,
    "MCP_AUTH_ENABLED": "false",
    "MCP_AUTH_BYPASS_LOCAL": "true",
    "SYSTEM_MODE": "delegated_limited",
    "BACKEND_PORT": BACKEND_PORT,
    "MCP_PORT": MCP_PORT,
    "PYTHONPATH": str(BACKEND),
})

print("[dev] alembic upgrade head")
subprocess.run([sys.executable, "-m", "alembic", "-c", "alembic.ini", "upgrade", "head"],
               cwd=BACKEND, env=env, check=True)
print("[dev] seed inicial (seed_v5)")
subprocess.run([sys.executable, "-m", "app.db.seed_v5"], cwd=BACKEND, env=env, check=True)

procs: list[tuple[str, subprocess.Popen]] = []


def spawn(name: str, args: list[str]) -> None:
    procs.append((name, subprocess.Popen(args, cwd=BACKEND, env=env)))


def shutdown(*_: object) -> None:
    for _name, p in procs:
        try:
            p.send_signal(signal.SIGINT)
        except Exception:
            pass
    for _name, p in procs:
        try:
            p.wait(5)
        except Exception:
            p.kill()
    try:
        server.cleanup()
    except Exception:
        pass
    sys.exit(0)


signal.signal(signal.SIGINT, shutdown)
signal.signal(signal.SIGTERM, shutdown)
atexit.register(lambda: None)

spawn("backend", [sys.executable, "-m", "uvicorn", "app.main:app",
                  "--host", "0.0.0.0", "--port", BACKEND_PORT, "--log-level", "warning"])
spawn("mcp", [sys.executable, "-m", "app.mcp.server"])

for _ in range(60):
    if port_open(BACKEND_PORT) and port_open(MCP_PORT):
        break
    time.sleep(0.5)

print("\n[dev] LISTO")
print(f"[dev] Backend REST : http://localhost:{BACKEND_PORT}/health")
print(f"[dev] MCP endpoint : http://localhost:{MCP_PORT}/mcp")
print("[dev] Verifica con :  python scripts/smoke_mcp.py")
print("[dev] Ctrl-C para detener.\n")

for _name, p in procs:
    p.wait()
