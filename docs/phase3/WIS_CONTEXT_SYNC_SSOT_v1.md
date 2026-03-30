# WIS Context Sync SSOT v1

## Mission

WIS Context Sync is the operational source of truth for shared development context across ChatGPT, Codex, and future consumers.

## Current baseline (frozen)

- MCP transport: `streamable-http`
- MCP path: `/mcp`
- Policy mode: `delegated_limited`
- Integration mode: read-only
- Stable MCP tools:
  - `get_active_task`
  - `get_context_snapshot`
  - `get_recent_errors`
  - `get_validation_status`
  - `get_approved_decisions`

## Authority model

- WIS backend is authoritative for scope resolution.
- Clients must not implement independent scope arbitration.
- MCP reads are audited in `publish_audit`.

## Invariants

- No write actions from VS Code extension in Fase 3.
- No MCP tool renames or transport changes.
- No backend/MCP behavioral drift without explicit delta.
