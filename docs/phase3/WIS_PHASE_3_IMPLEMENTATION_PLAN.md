# Fase 3 Implementation Plan

## Slice 0

1. Create `vscode-extension/` scaffold.
2. Add command registrations.
3. Add output channel.
4. Add endpoint setting.
5. Lock consumer identity.

## Slice 1

1. Add `SessionManager` with generation + reuse.
2. Add session reset command.
3. Add diagnostics payload and output formatting.
4. Add stubs for Slice 2 modules.
5. Add development README and manual test steps.

## Guardrails

- Read-only only.
- No MCP/backend transport or tool changes.
- No local scope arbitration.

## Delivery evidence

- Command palette visibility.
- Output channel logs.
- Session key lifecycle behavior.
- Diagnostics output snapshots.
