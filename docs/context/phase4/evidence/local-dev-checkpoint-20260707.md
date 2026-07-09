# Local Dev Checkpoint 2026-07-07

Status: `PASS local`
Scope: Docker local, VS Code extension install/config, local_private profile, Codex CLI binding, backend batch fix tests, Agent Council config seed.

This checkpoint does not declare the remote/Auth0 global GO. The global gate remains governed by `phase4/evidence/README.md` and the remote backlog.

## Environment

- Host: Windows + Docker Desktop
- Repo branch: `wp/phase0-close`
- Docker: available
- GitHub CLI: authenticated as `Necktral`
- Codex CLI command resolved by VS Code setting: `codex`

## Docker Stack

Command:

```bash
docker compose up --build -d postgres migrate backend mcp
docker compose ps
```

Observed:

- `wis_context_postgres`: `Up`, healthy, `127.0.0.1:5432->5432`
- `wis_context_backend`: `Up`, `127.0.0.1:8001->8001`
- `wis_context_mcp`: `Up`, `127.0.0.1:8002->8002`

MCP service info:

```bash
curl -sS http://127.0.0.1:8001/mcp/info
```

Observed:

```json
{"name":"WIS Context Sync MCP","mode":"read-write-v2","status":"ready"}
```

## VS Code Extension

Installed package:

```text
necktral.wis-context-sync-control-plane@0.2.0-internal
```

Recommended local settings:

```json
{
  "wisContextSync.runtimeMode": "mcp",
  "wisContextSync.mcpEndpoint": "http://localhost:8002/mcp",
  "wisContextSync.requestTimeoutMs": 10000,
  "wisContextSync.authMode": "none",
  "wisContextSync.requireAuthentication": false,
  "wisContextSync.operationProfile": "local_private",
  "wisContextSync.codexCliCommand": "codex",
  "wisContextSync.localDb.enabled": true,
  "wisContextSync.localDb.host": "localhost",
  "wisContextSync.localDb.port": 5432,
  "wisContextSync.localDb.database": "wis_context",
  "wisContextSync.localDb.user": "wis_admin",
  "wisContextSync.localDb.schema": "local_private",
  "wisContextSync.localDb.ssl": false,
  "wisContextSync.localIndex.excludeDirs": [
    ".git",
    "node_modules",
    "dist",
    "build",
    ".venv",
    "venv",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache"
  ],
  "wisContextSync.localIndex.includeExtensions": [
    ".py",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".json",
    ".md",
    ".yml",
    ".yaml",
    ".toml",
    ".sql"
  ],
  "wisContextSync.localIndex.maxFileBytes": 2097152,
  "wisContextSync.localIndex.chunkSizeChars": 1200,
  "wisContextSync.localIndex.chunkOverlapChars": 120
}
```

Security note:

- Do not store `wisContextSync.localDb.password` in plaintext settings.
- Use `WIS: Local Configure DB Password` so the extension stores the password in VS Code SecretStorage.

## LLM And Agent Council Config

Versioned seed:

- `docs/context/AGENT-COUNCIL-ORCHESTRATOR.md`
- `docs/context/AGENT-COUNCIL-DEFAULT-CONFIG.json`

Default posture:

- Provider: `codex_cli`
- Command: `codex`
- Model: `runtime_default`
- Output contract: `agent_council_packet_v1`
- Agents can deliberate, object, counterpropose, request probes, and create proposal candidates.
- Agents cannot ratify, commit canon, hide dissent, or bypass audit/idempotency/scope requirements.

Configured roles:

- `architect`
- `implementer`
- `critic`
- `operator_advocate`
- `risk_auditor`
- `historian`
- `wildcard`

## Backend Verification

Targeted batch dispatch tests:

```bash
docker compose exec -T -e MCP_AUTH_BYPASS_LOCAL=true backend python -m pytest -q tests/test_wp03_batch_dispatch.py
```

Result:

```text
8 passed
```

Full backend suite:

```bash
docker compose exec -T -e MCP_AUTH_BYPASS_LOCAL=true backend python -m pytest -q
```

Result:

```text
90 passed, 7 skipped
```

Note: the explicit `MCP_AUTH_BYPASS_LOCAL=true` override is required when the container environment has auth enabled. The backend test `conftest.py` uses `setdefault`, so it does not override an already-defined container env var.

## Outstanding Local Items

- Store PostgreSQL password through VS Code SecretStorage before using `WIS: Local *` commands that need DB persistence.
- Run `./scripts/run_contract_closure.sh backend` from a working Bash shell. On this Windows host, plain `bash` resolved to a WSL shim without `/bin/bash`; Git Bash is the expected fallback.
- Remote PR governance check remains separate from this local checkpoint.
