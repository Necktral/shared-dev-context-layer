# MCP Remote v1 Runbook (Fase 4)

## Scope freeze (must stay true)

- Do not change models.
- Do not change MCP tools.
- Do not add write actions.
- Do not change policy mode (`delegated_limited`) except critical bugfixes.

This runbook is only for remote exposure and external connectivity validation.

## Current local baseline

- Backend health: `http://localhost:8001/health`
- MCP local endpoint: `http://localhost:8002/mcp`
- Required tools:
  - `get_active_task`
  - `get_context_snapshot`
  - `get_recent_errors`
  - `get_validation_status`
  - `get_approved_decisions`

## Preflight

1. `docker compose up --build -d`
2. `docker compose ps` must show `postgres`, `backend`, `mcp` as `Up`.
3. `curl -s http://localhost:8001/health` must return `db: up`.
4. `docker compose logs mcp --tail=60` must show Streamable HTTP startup.

## Tunnel (Cloudflare via Docker)

### Start

```bash
./scripts/start_cloudflare_tunnel.sh
```

Expected output includes:

- `Public base URL: https://<random>.trycloudflare.com`
- `MCP endpoint URL: https://<random>.trycloudflare.com/mcp`

### Stop

```bash
./scripts/stop_cloudflare_tunnel.sh
```

## Remote MCP validation (before ChatGPT)

Run:

```bash
./scripts/validate_remote_mcp.sh https://<random>.trycloudflare.com
```

What this validation enforces:

- HTTPS endpoint reachability with `Accept: text/event-stream`.
- MCP client can list and call all 5 required tools.
- Domain tables do not change from tool consumption.
- `publish_audit` increases exactly by `+5` (one row per tool call).

Pass criteria:

- Script ends with `Remote MCP validation PASSED`.

## ChatGPT Developer Mode registration

Create app using:

- Name: `WIS Context Sync`
- Description: read-only operational context sync for tasks, decisions, errors and validations under WIS policy
- MCP Server URL: `https://<random>.trycloudflare.com/mcp`
- Authentication: `No Authentication`

After saving:

1. Refresh tool list.
2. Confirm all 5 tools are visible.
3. Invoke each tool once from ChatGPT conversation.

## Evidence checklist (manual)

- Screenshot or copy of app config URL and auth mode.
- One successful invocation per tool.
- SQL evidence:
  - domain tables unchanged after tool usage
  - `publish_audit` rows added with correct `package_type`.

## Fast diagnostics matrix

- Symptom: URL works without `/mcp` but tools fail.
  - Cause: wrong endpoint path.
  - Action: use exact URL ending in `/mcp`.
- Symptom: tunnel URL unreachable.
  - Cause: tunnel container stopped.
  - Action: restart `./scripts/start_cloudflare_tunnel.sh`, inspect `docker logs wis_context_cloudflared_tunnel`.
- Symptom: MCP responds `Not Acceptable` or handshake errors.
  - Cause: bad headers or non-MCP client.
  - Action: run `./scripts/validate_remote_mcp.sh <public-url>` to validate transport and tool calls.
- Symptom: tools visible but call fails.
  - Cause: backend/mcp dependency issue or DB unavailable.
  - Action: check `docker compose logs mcp` and `docker compose logs backend`; verify `GET /health`.
- Symptom: audit does not increment.
  - Cause: tool path bypassing audit or DB write failure.
  - Action: run remote validation script and inspect `publish_audit` query output.
- Symptom: tunnel drops after some time.
  - Cause: ephemeral tunnel lifecycle.
  - Action: restart tunnel and update ChatGPT app URL to new domain.
