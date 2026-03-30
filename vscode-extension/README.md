# WIS Context Sync VS Code Extension (Slice 0 + Slice 1)

This package implements the local read-only control plane baseline for Fase 3.

## Included in this slice

- Extension scaffold (TypeScript)
- Commands:
  - `WIS: Load Operational Context`
  - `WIS: Reset Session`
- Stable output channel: `WIS Context Sync`
- Configurable MCP endpoint (`wisContextSync.mcpEndpoint`)
- Fixed consumer identity: `vscode_extension`
- Session key lifecycle manager (create/reuse/reset)
- Minimal diagnostics output
- Stubs for Slice 2 modules:
  - `EnvironmentInspector`
  - `WISClient`
  - `ContextPresenter`
  - `HandoffBuilder`

## Out of scope (by design)

- No write actions to WIS
- No scope resolution in extension
- No backend/MCP contract changes
- No heavy UI

## Development

```bash
cd vscode-extension
npm install
npm run compile
```

Then open the repo in VS Code and press `F5` to launch Extension Host.

## Manual verification

1. Open command palette and run `WIS: Load Operational Context`.
2. Open output channel `WIS Context Sync` and verify diagnostics are printed.
3. Run `WIS: Load Operational Context` again and confirm same `session_key`.
4. Run `WIS: Reset Session` and confirm new `session_key`.
5. Verify endpoint shown in diagnostics matches setting `wisContextSync.mcpEndpoint`.
