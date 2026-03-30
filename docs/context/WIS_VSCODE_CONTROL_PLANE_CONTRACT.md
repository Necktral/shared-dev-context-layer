# WIS VS Code Control Plane Contract
_Status: proposed contract for Fase 3_
_Dependencies: WIS Context Sync SSOT v1, Fase 2 multi-scope read model, MCP contract, VS Code read-only handoff contract_

## 1. Purpose

Define the control-plane contract for the future **VS Code extension** that will consume WIS Context Sync in **read-only mode** during Fase 3.

This document specifies:

- what the extension is and is not allowed to do
- how it identifies scope
- how it creates and reuses `session_key`
- which WIS tools it calls and in what order
- what minimal UI the extension must expose
- what error states it must handle
- what handoff payload it must prepare for future delegation flows

This contract does **not** open write actions, local execution, auth changes, or transport changes.

---

## 2. Design intent

The VS Code extension is the **local control plane**, not the reasoning brain and not the execution agent.

Role split:

- **Wiston** defines intention
- **ChatGPT** interprets intention and decides strategy
- **WIS Context Sync** preserves truth, resolves scope and publishes allowed context
- **VS Code extension** observes the local environment, requests context, presents the effective state, and prepares structured handoffs
- **Codex / GitHub Copilot** are downstream executors or assistants and must not become the primary source of truth

---

## 3. Phase 3 scope

## 3.1 In scope

The extension must be able to:

- activate inside VS Code
- detect the current workspace root
- detect repository root if available
- detect current branch if available
- identify the active file path if available
- create or recover a local `session_key`
- identify itself as consumer `vscode_extension`
- call WIS MCP in read-only mode
- display current effective scope
- display current task context
- display context snapshot
- display validation state
- display approved decisions
- display recent errors
- surface structured conflicts and fallback information
- prepare a future handoff payload without executing it

## 3.2 Out of scope

The extension must **not**:

- perform write actions against WIS
- auto-edit files
- auto-run shell commands
- auto-commit code
- change Codex or GitHub Copilot configuration
- bypass WIS scope resolution
- invent scope locally when WIS returns conflict
- create autonomous execution loops

---

## 4. Existing WIS invariants this contract depends on

The extension depends on these already-established invariants:

- WIS MCP keeps the same 5 tools:
  - `get_active_task`
  - `get_context_snapshot`
  - `get_recent_errors`
  - `get_validation_status`
  - `get_approved_decisions`
- transport stays `streamable-http` on `/mcp`
- mode remains `delegated_limited`
- tools accept optional scope args:
  - `workspace_id`
  - `project_id`
  - `task_id`
  - `consumer`
  - `session_key`
- successful responses include:
  - `status: "ok"`
  - `scope`
  - `resolution_metadata`
- `get_context_snapshot` additionally includes:
  - `consumer_context`
  - rich `snapshot`

These invariants are already documented in the repo and must remain true during Fase 3. fileciteturn36file0L1-L1 fileciteturn34file0L1-L1

---

## 5. Control plane principles

1. **WIS is authoritative for scope**
   The extension may suggest scope, but WIS resolves scope.

2. **The extension is observational in Fase 3**
   It reads, presents and prepares. It does not execute.

3. **Context must be explicit**
   No hidden coupling to chat state, editor state or user intuition.

4. **Conflicts must surface, not be masked**
   If WIS returns `scope_conflict`, the extension must show it clearly.

5. **Backward compatibility matters**
   The extension must not require changes to current WIS transport or tool names.

---

## 6. Extension architecture

## 6.1 Components

### A. Activation Layer
Registers commands, views and lifecycle hooks.

### B. Environment Inspector
Reads local signals:
- workspace folder
- repo root
- git branch
- active file
- active editor path

### C. Session Manager
Creates, stores and reuses `session_key`.

### D. WIS Client
Calls WIS MCP and normalizes responses.

### E. Context Presenter
Renders current state in VS Code UI.

### F. Handoff Builder
Builds structured payloads for later delegation to ChatGPT, Codex or GitHub Copilot.

## 6.2 Role boundary

The extension must not replicate:
- WIS policy
- WIS focus resolution logic
- WIS persistence rules
- ChatGPT semantic reasoning layer

---

## 7. Consumer identity contract

The extension must identify itself with:

- `consumer = "vscode_extension"`

This value must match the consumer type already seeded in WIS multi-scope state. fileciteturn43file0L1-L1

The extension may also expose a display label locally, for example:

- `consumer_name = "WIS VS Code Control Plane"`

But the canonical integration key is `vscode_extension`.

---

## 8. Session lifecycle contract

## 8.1 `session_key`

The extension must maintain a stable `session_key` for the current logical local session.

Recommended format:

`wis-vscode-<machine-or-instance>-<workspace-hash>-<timestamp-or-random-suffix>`

The exact generation algorithm can vary, but the key must be:

- unique enough to avoid collision
- stable during the active editor session
- reusable across multiple MCP calls within that session
- visible in diagnostic mode

## 8.2 Session lifecycle states

The extension should model these local states:

- `uninitialized`
- `active`
- `stale`
- `expired`
- `recreated`

WIS currently models `execution_sessions` with:
- `session_key`
- `started_at`
- `ended_at`
- `status` fileciteturn41file0L1-L1

The extension must not write these states yet, but should be designed to align with them.

## 8.3 Session reuse rule

A `session_key` should be reused while:
- the same workspace remains active
- the extension host is still in the same logical session
- there is no explicit reset by the user

The extension should regenerate `session_key` when:
- workspace changes materially
- user requests reset
- stored session is corrupted
- diagnostic mode detects mismatch

---

## 9. Scope input contract

## 9.1 Inputs the extension may send

The extension may send any subset of:

- `workspace_id`
- `project_id`
- `task_id`
- `consumer`
- `session_key`

This matches the existing read-only handoff contract already documented in the repo. fileciteturn36file0L1-L1

## 9.2 Resolver precedence

The extension must assume WIS resolves scope using this precedence:

1. `task_id`
2. `project_id`
3. `workspace_id`
4. canonical current scope

Additionally, the current resolver implementation also handles `session_key` and compatibility fallback behavior when needed. fileciteturn36file0L1-L1 fileciteturn35file0L1-L1

## 9.3 Local behavior rule

The extension must:
- send the best explicit scope it knows
- never claim certainty it does not have
- never override a WIS conflict locally
- display `resolution_metadata` exactly as control-plane evidence

---

## 10. MCP call order contract

The extension should use this baseline call sequence when loading state:

### Option A — full context refresh
1. `get_active_task`
2. `get_validation_status`
3. `get_approved_decisions`
4. `get_recent_errors`
5. `get_context_snapshot`

### Option B — light refresh
1. `get_active_task`
2. `get_validation_status`
3. `get_recent_errors`

### Option C — snapshot-first fallback
1. `get_context_snapshot`
2. conditional follow-up calls as needed

The default recommended initial load is **Option A**.

---

## 11. Response handling contract

## 11.1 Success

A successful response is:

```json
{
  "status": "ok",
  "scope": {...},
  "resolution_metadata": {...}
}
```

`get_context_snapshot` additionally contains:
- `consumer_context`
- `snapshot`
- `metadata` fileciteturn34file0L1-L1

## 11.2 Structured error states

The extension must explicitly support:

- `scope_invalid`
- `scope_not_found`
- `scope_conflict`
- `no_active_task`
- `no_scope`

These statuses exist in the resolver path and MCP compatibility layer. fileciteturn35file0L1-L1 fileciteturn34file0L1-L1

## 11.3 Conflict handling

If WIS returns `scope_conflict`, the extension must show:
- requested scope
- resolved scope
- conflict flags
- source of resolution
- no local override button in Fase 3

The correct user action in Fase 3 is:
- inspect
- adjust requested scope
- retry

Not:
- force acceptance
- silent coercion
- auto-selection

---

## 12. Minimal UI contract

## 12.1 Required surfaces

### A. Command
At least one command must exist:

- `WIS: Load Operational Context`

### B. Side panel / view container
A view must expose:

- effective scope
- active task summary
- validation state
- approved decisions summary
- recent errors summary
- snapshot status
- last refresh result

### C. Status indicator
A compact status indicator should expose one of:

- connected
- scope resolved
- conflict
- degraded
- transport error
- no active task

## 12.2 Recommended sections in the main view

1. **Scope**
2. **Task**
3. **Validation**
4. **Decisions**
5. **Errors**
6. **Snapshot metadata**
7. **Diagnostics**

---

## 13. UX behavior rules

1. Never pretend context is healthy when MCP failed.
2. Never translate `scope_conflict` into “no data”.
3. Empty errors must render as:
   - “No recent errors”
   and not as “unknown”.
4. Validation `unknown` must render differently from transport failure.
5. Decisions count and validation state should be visible at a glance.
6. The user must be able to manually refresh.

---

## 14. Diagnostics contract

The extension should be able to show a diagnostics block containing:

- last request time
- last response status
- scope requested
- scope resolved
- fallback level
- conflict flags
- session key
- consumer type
- transport endpoint used

This is not optional for troubleshooting; it is required for a serious control plane.

---

## 15. Transport and configuration contract

## 15.1 Transport
No transport change in Fase 3:
- MCP over `streamable-http`
- endpoint ending in `/mcp` fileciteturn36file0L1-L1

## 15.2 Required local config
The extension should minimally support:
- MCP base URL
- diagnostic mode on/off
- auto-refresh on/off
- refresh interval (optional, conservative default)
- local session reset

## 15.3 No hidden magic
Do not auto-discover random endpoints.
The endpoint must be explicit and user-configurable.

---

## 16. Caching and refresh contract

## 16.1 Fase 3 rule
Keep caching minimal.

Allowed:
- last successful payload in memory
- last known UI state for display continuity

Not allowed:
- cache as silent source of truth
- local scope rewriting
- long-lived shadow persistence that competes with WIS

## 16.2 Refresh triggers
Refresh may occur on:
- explicit command
- extension activation
- workspace change
- branch change
- manual reopen of panel

Auto-refresh, if enabled, must be conservative and observable.

---

## 17. Security and authority contract

Fase 3 remains read-only.

The extension must not:
- send write requests
- synthesize mutation commands
- store secrets beyond minimal local settings
- impersonate another consumer
- bypass `delegated_limited`

The extension has **read authority only**.

---

## 18. Handoff builder contract

Although Fase 3 does not execute delegation, it must prepare for it.

The extension should be able to build a `handoff_packet` with:

- current effective scope
- task summary
- validation state
- approved decisions summary
- recent errors summary
- selected file/module context if any
- active repo and branch if known
- session_key
- timestamp
- source = `vscode_extension`

This packet is for future downstream use by:
- ChatGPT
- Codex
- GitHub Copilot

It is not yet a write artifact.

---

## 19. Acceptance criteria for Fase 3 control plane

Fase 3 is complete only if all are true:

1. The extension loads in VS Code without breaking the editor.
2. It identifies itself as `vscode_extension`.
3. It creates or reuses a stable `session_key`.
4. It can call the existing 5 tools without contract drift.
5. It renders effective scope and resolution metadata.
6. It handles `scope_conflict` explicitly.
7. It handles transport failure explicitly.
8. It never performs writes.
9. It shows validation, decisions and recent errors coherently.
10. It can build a structured handoff packet.

---

## 20. Open questions for implementation

These are allowed implementation questions, not contract blockers:

- exact VS Code surface: Tree View vs Webview vs hybrid
- exact `session_key` format
- whether git branch is shown always or only when available
- whether active file context is displayed in Fase 3 or deferred
- whether auto-refresh is enabled by default

---

## 21. Final definition

The VS Code extension in Fase 3 is a **read-only local control plane** that bridges the developer environment and WIS Context Sync. It does not reason in place of ChatGPT, does not replace WIS as source of truth, and does not execute local changes. Its job is to make scope, context and state visible and reliable in the editor, while preparing the system for future controlled delegation and execution.
