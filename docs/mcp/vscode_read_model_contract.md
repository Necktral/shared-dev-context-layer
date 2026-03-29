# VS Code Read-Only Handoff Contract (Fase 2)

## Purpose

Define the read-only payload contract the future VS Code extension will use to resolve scope and request context without triggering write actions.

## Scope input contract

The extension may send any subset of:

- `workspace_id`
- `project_id`
- `task_id`
- `consumer` (`vscode_extension`)
- `session_key`

Resolver precedence is:

1. `task_id`
2. `project_id`
3. `workspace_id`
4. canonical current scope (`context_scopes.is_current = true`)

If a conflict exists (`task` does not belong to provided `project/workspace`), MCP returns:

- `status: "scope_conflict"`
- `resolution_metadata.conflict_flags`

## MCP compatibility

The same 5 tools remain stable:

- `get_active_task`
- `get_context_snapshot`
- `get_recent_errors`
- `get_validation_status`
- `get_approved_decisions`

All tools now accept optional scope args listed above. Calls with no args remain backward compatible.

## Response invariants for extension prep

All successful tool responses (`status: "ok"`) include:

- `scope` (effective `workspace/project/task`)
- `resolution_metadata` (`source`, `fallback_level`, `conflict_flags`, `requested`, `resolved_scope`)

`get_context_snapshot` additionally includes:

- `consumer_context`
- rich `snapshot` payload with identity, execution_state, validation, decisions, errors, metadata

## Non-goals in this phase

- no write actions
- no auth changes
- no transport changes (`streamable-http` on `/mcp`)
- no automatic code execution from extension
