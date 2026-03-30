# VS Code Extension Architecture (Fase 3)

## Module layout

- `extension.ts`: activation, command wiring, lifecycle
- `sessionManager.ts`: consumer identity + session key lifecycle
- `diagnostics.ts`: output + minimal status reporting
- `stubs/environmentInspector.ts`
- `stubs/wisClient.ts`
- `stubs/contextPresenter.ts`
- `stubs/handoffBuilder.ts`

## Runtime flow (Slice 0/1)

1. Activate extension.
2. Initialize output channel and session manager.
3. Read endpoint configuration.
4. Execute load command -> report diagnostics only.
5. Execute reset command -> rotate session key and report diagnostics.

## Future integration points

- `EnvironmentInspector`: workspace/repo/branch signals
- `WISClient`: scope-aware read calls to WIS/MCP
- `ContextPresenter`: side-panel/UI rendering
- `HandoffBuilder`: structured payload for downstream delegation
