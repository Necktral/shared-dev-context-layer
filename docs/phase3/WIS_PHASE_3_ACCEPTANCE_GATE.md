# Phase 3 Acceptance Gate (Slice 0 + Slice 1)

## Pass criteria

1. Extension Host starts with no activation errors.
2. `WIS: Load Operational Context` appears and runs.
3. `WIS: Reset Session` appears and rotates session key.
4. Output channel logs activation and command activity.
5. Endpoint setting is configurable and read correctly.
6. Consumer identity is fixed to `vscode_extension`.
7. Session key is stable across repeated command runs until reset.
8. Diagnostics include consumer/session/endpoint/init status.
9. No writes or workspace mutations are executed.

## Fail criteria

- Any backend or MCP contract change.
- Any write action introduced.
- Hidden session behavior that cannot be diagnosed.
- Extension-side scope conflict handling beyond displaying server states.
