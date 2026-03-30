# VS Code Control Plane Contract (Read-Only)

## Identity

- `consumer = "vscode_extension"` (fixed)
- `session_key` generated locally and reused until reset

## Extension commands

- `wisContextSync.loadOperationalContext`
- `wisContextSync.resetSession`

## Settings

- `wisContextSync.mcpEndpoint` (string)
- Default: `http://localhost:8002/mcp`

## Required diagnostics

Diagnostics must show at minimum:

- consumer
- session_key
- configured endpoint
- initialization state

## Behavioral contract

- No write API calls.
- No direct file mutation from commands.
- No independent scope resolver in extension.
- Scope interpretation remains server-authoritative in WIS.
