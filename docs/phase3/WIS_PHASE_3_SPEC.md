# WIS Phase 3 Spec

## Goal

Build the VS Code local control plane foundation (Slice 0 + Slice 1) without changing backend/MCP contracts.

## Included in Slice 0 + Slice 1

- Extension scaffold in TypeScript
- Command: `WIS: Load Operational Context`
- Command: `WIS: Reset Session`
- Output channel
- Configurable MCP endpoint setting
- Fixed consumer identity: `vscode_extension`
- Session key lifecycle management
- Minimal diagnostics surface
- Explicit stubs for next slices

## Excluded

- Writes to WIS
- Automatic local execution
- Scope resolution in extension
- Copilot/Codex automation integration
- UI-heavy features

## Non-negotiables

- Keep read-only posture.
- Keep backend and MCP untouched in behavior and transport.
- Keep extension behavior deterministic and auditable.
