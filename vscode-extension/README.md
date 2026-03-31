# WIS Context Sync VS Code Extension (Slice 3A)

This package implements the read-only control plane baseline for WIS consumption with explicit degradation and project-first offline support.

## Included in this slice

- Commands:
  - `WIS: Load Operational Context`
  - `WIS: Reset Session`
- Layered orchestration (`LoadOperationalContextService`) with read-only envelope composition.
- Output channel presentation with sections:
  - Session
  - Local Environment
  - Active Task
  - Validation
  - Approved Decisions
  - Recent Errors
  - Load State
  - Issues
- Runtime modes (explicit):
  - `mcp`
  - `offline_fixture`
- Deterministic fixture scenarios:
  - `success_full`
  - `partial_missing_recent_errors`
  - `degraded_no_remote_bundle`
  - `transport_error`
  - `no_active_task`
  - `validation_stale`
- MCP SDK adapter (`streamable-http`) for live mode.
- Typed diagnostics and envelope evidence.

## Configuration

- `wisContextSync.mcpEndpoint` (default: `http://localhost:8002/mcp`)
- `wisContextSync.diagnosticMode` (default: `true`)
- `wisContextSync.runtimeMode` (default: `offline_fixture`)
- `wisContextSync.requestTimeoutMs` (default: `5000`)
- `wisContextSync.fixtureScenario` (default: `success_full`)

## Out of scope

- No write actions to WIS
- No shell execution
- No file mutation automation
- No panel/webview UI
- No handoff execution flows

## Development

```bash
cd vscode-extension
npm install
npm run compile
npm test
```

Then open the repo in VS Code and press `F5` to launch Extension Host.
