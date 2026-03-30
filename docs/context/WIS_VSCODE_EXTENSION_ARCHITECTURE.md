# WIS VS Code Extension Architecture
_Status: proposed architecture for Fase 3_
_Scope: VS Code Control Plane Read-Only_

## 1. Purpose

Define the target architecture of the **VS Code extension** for Fase 3 as a **read-only local control plane** for WIS Context Sync.

This document explains:
- why the extension exists
- what responsibilities belong inside the extension
- what responsibilities must remain in WIS
- which internal modules the extension needs
- how the extension should interact with MCP
- what boundaries must remain intact in Fase 3

---

## 2. Architectural intent

The extension is not the reasoning brain and not the system of record.

Its purpose is to:
- observe the local development environment
- identify local runtime context
- call WIS as the authoritative context layer
- present effective operational truth inside VS Code
- prepare future handoffs
- avoid local execution or write behavior in this phase

Role split:

- **Wiston** defines intention
- **ChatGPT** interprets intention and decides strategy
- **WIS Context Sync** stores truth, resolves scope and applies policy
- **VS Code extension** becomes the local control plane
- **Codex / GitHub Copilot** remain downstream assistants or executors, not primary truth holders

---

## 3. Architectural principles

1. **WIS is the source of truth**
   The extension never becomes an alternative state store.

2. **WIS resolves scope**
   The extension may provide inputs, but it does not replace `focus_resolver`.

3. **Fase 3 is observational**
   The extension reads, presents and prepares; it does not execute writes.

4. **Local environment matters**
   The extension exists because the editor can see workspace, repo and active file context that WIS alone cannot infer reliably.

5. **The extension must be honest**
   It must expose conflicts, fallbacks and degraded transport states directly.

6. **Future delegation starts here**
   The extension prepares handoffs but does not yet trigger execution automatically.

---

## 4. Dependencies from existing WIS state

The extension architecture depends on already existing invariants in WIS:

- same 5 MCP tools remain stable
- transport remains `streamable-http` on `/mcp`
- all tools accept optional scope args
- successful responses include `scope` and `resolution_metadata`
- `get_context_snapshot` includes `consumer_context`
- multi-scope persistence exists through `workspaces`, `projects`, `consumers`, `execution_sessions`, `context_scopes`
- `vscode_extension` exists as consumer type

These invariants are already visible in the current repo state and Fase 2 contract. fileciteturn34file0L1-L1 fileciteturn35file0L1-L1 fileciteturn36file0L1-L1 fileciteturn38file0L1-L1 fileciteturn39file0L1-L1 fileciteturn41file0L1-L1 fileciteturn43file0L1-L1 fileciteturn44file0L1-L1

---

## 5. High-level architecture

```text
User
  │
  ▼
VS Code UI
  │
  ▼
Extension Host
  ├── Activation Layer
  ├── Environment Inspector
  ├── Session Manager
  ├── WIS Client
  ├── Context Presenter
  └── Handoff Builder
           │
           ▼
     WIS MCP (/mcp)
           │
           ▼
   WIS Backend + PostgreSQL
```

---

## 6. Internal modules

## 6.1 Activation Layer

### Responsibility
- register commands
- register tree/view containers or panels
- initialize extension services
- wire lifecycle hooks

### Must not do
- business logic
- scope resolution
- direct payload shaping beyond bootstrap

### Outputs
- active command registration
- initialized services
- ready UI surface

---

## 6.2 Environment Inspector

### Responsibility
Read local signals from VS Code and Git context, including:
- workspace folder
- repository root
- current branch
- active editor file
- active relative path
- project root hints

### Purpose
Provide best-effort local hints to help WIS resolve scope.

### Must not do
- canonical resolution
- policy evaluation
- silent inference of authoritative task identity

### Output contract
`local_environment_snapshot`

Suggested shape:
```json
{
  "workspace_path": "...",
  "repo_root": "...",
  "branch": "...",
  "active_file": "...",
  "active_relative_path": "...",
  "timestamp": "..."
}
```

---

## 6.3 Session Manager

### Responsibility
- create and persist a local `session_key`
- recover session between refreshes
- expose session diagnostics
- support session reset

### Alignment requirement
Must remain compatible with WIS `execution_sessions` shape:
- `consumer_id`
- `workspace_id`
- `project_id`
- `task_id`
- `session_key`
- `started_at`
- `ended_at`
- `status` fileciteturn41file0L1-L1

### Must not do
- create remote execution session records in Fase 3
- guess authoritative session state server-side

---

## 6.4 WIS Client

### Responsibility
- talk to MCP
- send optional scope args
- normalize successful and error responses
- preserve `scope`, `resolution_metadata`, `consumer_context`
- expose transport diagnostics

### Supported calls
- `get_active_task`
- `get_context_snapshot`
- `get_recent_errors`
- `get_validation_status`
- `get_approved_decisions` fileciteturn34file0L1-L1

### Call inputs
- `workspace_id`
- `project_id`
- `task_id`
- `consumer = "vscode_extension"`
- `session_key` fileciteturn36file0L1-L1

### Must not do
- rename MCP semantics
- flatten structured scope conflicts into generic errors
- maintain shadow truth

---

## 6.5 Context Presenter

### Responsibility
Render read-only operational truth in VS Code.

### Required sections
- effective scope
- active task summary
- validation
- approved decisions
- recent errors
- snapshot metadata
- diagnostics

### UX rules
- show what WIS says, not what the extension wishes were true
- show `scope_conflict` explicitly
- distinguish `unknown` from `transport error`
- distinguish `no recent errors` from `no data`

---

## 6.6 Handoff Builder

### Responsibility
Build a structured package that future flows can use to delegate work to:
- ChatGPT
- Codex
- GitHub Copilot

### Inputs
- effective scope
- task summary
- decisions
- validation
- recent errors
- local repo / branch
- active file context
- session key

### Must not do
- auto-trigger downstream execution
- perform writes
- infer missing constraints silently

---

## 7. UI architecture

## 7.1 Required surfaces

### A. Command surface
At least:
- `WIS: Load Operational Context`

### B. Main control plane view
A side panel / tree view / minimal webview that presents:
- scope
- task
- validation
- decisions
- errors
- snapshot metadata
- diagnostics

### C. Status indicator
Compact current state:
- connected
- resolved
- degraded
- conflict
- transport error
- no active task

## 7.2 Recommended layout

### Section 1 — Scope
- workspace
- project
- task
- source
- fallback level

### Section 2 — Task
- title
- goal
- phase
- next action

### Section 3 — Validation
- current status
- validation source
- last validation time

### Section 4 — Decisions
- total
- summary list

### Section 5 — Errors
- total
- latest summaries

### Section 6 — Diagnostics
- session key
- endpoint
- last request status
- conflict flags
- requested scope
- resolved scope

---

## 8. Runtime flows

## 8.1 Initial load flow

1. Extension activates.
2. Session Manager creates or restores `session_key`.
3. Environment Inspector collects local signals.
4. WIS Client sends initial MCP requests using:
   - `consumer = "vscode_extension"`
   - `session_key`
   - best known scope hints
5. Context Presenter renders results.
6. Diagnostics section becomes available.

## 8.2 Manual refresh flow

1. User triggers refresh.
2. Extension re-reads local environment.
3. Extension reuses session unless reset requested.
4. WIS Client runs full or light refresh sequence.
5. Presenter updates state and timestamps.

## 8.3 Conflict flow

1. Extension sends explicit scope hints.
2. WIS returns `scope_conflict`.
3. Presenter renders:
   - requested
   - resolved
   - conflict flags
   - source
4. No local override is applied.
5. User may adjust request or continue diagnostically.

## 8.4 Transport failure flow

1. MCP endpoint fails or times out.
2. WIS Client returns structured transport failure.
3. Presenter switches to degraded/transport error state.
4. Cached display, if shown, must be clearly marked stale.
5. No false “connected” state is allowed.

---

## 9. Boundaries that must remain intact

## 9.1 What belongs in WIS, not in the extension
- canonical scope resolution
- multi-scope persistence
- policy enforcement
- publish audit
- truth of decisions/validation/errors
- future write governance

## 9.2 What belongs in the extension, not in WIS
- local editor integration
- workspace observation
- session continuity in the editor
- UI presentation
- local diagnostics view
- packaging future handoffs

## 9.3 What belongs in ChatGPT, not in the extension
- semantic interpretation of user intent
- strategy selection
- delegation reasoning
- high-level plan generation

---

## 10. Caching architecture

Fase 3 should use **ephemeral, local UI-support cache only**.

Allowed:
- last successful payload in memory
- last visible UI state
- short-lived session metadata

Not allowed:
- persistent shadow database of WIS truth
- local canonical scope persistence that can override WIS
- long-lived replay pretending to be fresh truth

---

## 11. Security and authority architecture

The extension is **read-only** in Fase 3.

### Allowed authority
- read environment
- call MCP
- display state
- build local handoff packet

### Forbidden authority
- write into WIS
- mutate local files automatically
- run commands automatically
- force scope resolution
- bypass policy
- impersonate another consumer

---

## 12. Handoff architecture

The handoff builder should output a `handoff_packet` with:

```json
{
  "source": "vscode_extension",
  "session_key": "...",
  "scope": {
    "workspace_id": "...",
    "project_id": "...",
    "task_id": "..."
  },
  "task_summary": {},
  "validation_summary": {},
  "decisions_summary": [],
  "recent_errors_summary": [],
  "repo_context": {
    "repo_root": "...",
    "branch": "...",
    "active_file": "..."
  },
  "generated_at": "..."
}
```

This packet is preparatory only in Fase 3.

---

## 13. Operational observability

The extension must expose enough diagnostics to be supportable.

Minimum observable data:
- endpoint
- last request time
- response status
- requested scope
- resolved scope
- fallback level
- conflict flags
- session key
- consumer identity
- stale/fresh indicator

Without this, the extension is not a serious control plane.

---

## 14. Architecture risks

### Risk 1 — duplicated truth
If the extension starts retaining local truth beyond UI support, it competes with WIS.

### Risk 2 — hidden conflict coercion
If the extension auto-fixes scope mismatch locally, users lose visibility into real state.

### Risk 3 — premature execution
If handoff becomes auto-run in Fase 3, the architecture collapses the boundary between read-only control plane and later execution plane.

### Risk 4 — transport opacity
If timeouts and failures are hidden, the extension becomes misleading.

### Risk 5 — session drift
If session identity is unstable, diagnostics and future delegation become unreliable.

---

## 15. Architecture decision

The VS Code extension for Fase 3 is a **read-only local control plane** composed of six internal modules:

- Activation Layer
- Environment Inspector
- Session Manager
- WIS Client
- Context Presenter
- Handoff Builder

It must remain:
- observational
- truthful
- contract-safe
- non-destructive
- ready for future delegation

It must not become:
- a second backend
- a state authority
- an execution agent
- a policy engine
- a hidden workflow runner

---

## 16. Final definition

The architecture of Fase 3 is successful only if the extension acts as the **local, transparent, read-only bridge** between the developer’s real editor context and WIS Context Sync, while preserving WIS as source of truth and preparing the system for future controlled delegation.
