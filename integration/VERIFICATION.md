# Verificación funcional (evidencia)

**Fecha:** 2026-07-01 · **Entorno:** Ubuntu, sin Docker, Postgres embebido
(`pgserver`, PostgreSQL 16.2), Python 3.10.

Resultado: el stack completo (Postgres → migraciones Alembic → seed → backend
REST → servidor MCP `streamable-http`) levanta y responde de punta a punta. Read
plane, write plane (commit real), idempotencia y auditoría verificados sobre el
transporte MCP real.

## Backend REST (`:8001`)

- `GET /` → `{"service":"wis-context-sync","status":"ok",...}`
- `GET /health` → `{"status":"ok","app":"up","db":"up",...}`
- `GET /mcp/info` → `{"name":"WIS Context Sync MCP","mode":"read-write-v2","status":"ready","auth_enabled":"false"}`

## MCP (`:8002`, streamable-http)

- `initialize` + `list_tools` → **17 tools publicadas** (contrato `all_published`, sin drift):
  `get_active_task, get_context_snapshot, get_recent_errors, get_validation_status,
  get_approved_decisions, search_context, get_context_by_id, list_context_windows,
  resolve_related_items, get_sync_status, preview_write_impact, upsert_context_item,
  append_context_event, link_context_entities, set_context_labels, archive_context_item,
  apply_sync_batch`
- `get_active_task` → `status=ok` (tarea activa "bootstrap del sistema" del seed)
- `get_context_snapshot` → `status=ok`, `source=database`
- `upsert_context_item` (dry_run) → `status=ok`, `result=dry_run`
- `upsert_context_item` (commit + `idempotency_key`) → `status=ok`, `result=created`, `audit_ref` presente
- `upsert_context_item` (mismo `idempotency_key`) → `idempotent_replay=true` — **idempotencia OK**
- `search_context("hello")` → `total=1` — **persistencia OK**

## Tests

- **Extensión VS Code** (`node --test`): **133 passed, 0 failed, 17 skipped**
  (los skip requieren Postgres local, gate `LOCAL_DB_TESTS`).
- **Backend** (`pytest`): **50 passed, 0 failed, 5 skipped**
  (los skip son e2e contra un servidor en marcha).

## Reproducir

Sin Docker (Postgres embebido, no requiere root):

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements.txt pgserver
python scripts/dev_native.py      # deja el stack arriba (backend :8001, MCP :8002)
python scripts/smoke_mcp.py       # en otra terminal → SMOKE: PASS
```

Con Docker:

```bash
make up && make health && make smoke
```

> Nota: el Postgres embebido de `pgserver` no incluye el contrib `pgcrypto`; el
> esquema solo lo referencia por compatibilidad y usa `gen_random_uuid()` (core en
> PG16). `dev_native.py` instala un stub inocuo solo para ese modo. Tu Postgres
> real (`docker postgres:16`) sí trae `pgcrypto` y no necesita el stub.
