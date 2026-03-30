# WIS Phase 3 Spec
## VS Code Control Plane Read-Only

Version: v1
Status: Draft ready for repo
Depends on: Fase 2 completada

---

## 1. Objective

Build the first real local consumer of WIS Context Sync: a VS Code extension that acts as a read-only control plane.

The extension must connect the local development environment to WIS Context Sync so ChatGPT can reason with real project state and so future delegation to Codex or GitHub Copilot can happen through a governed handoff instead of ad hoc prompt copying.

Phase 3 is not an execution phase. It is an observation, scope-resolution and handoff-preparation phase.

---

## 2. Why this phase exists

Phase 2 established the multi-scope read model in WIS:
- workspace
- project
- task
- consumer
- execution_session
- context_scope

It also preserved the MCP contract and introduced explicit scope resolution.

Phase 3 exists to make that model useful from the local developer environment.

Without Phase 3:
- WIS remains server-side only
- scope resolution does not reach the editor runtime
- ChatGPT cannot reliably ground decisions in the opened workspace
- future delegation to Codex or Copilot would still be informal

---

## 3. Phase statement

Phase 3 creates a VS Code extension that:
- identifies the local workspace and repo context
- establishes a consumer session as `vscode_extension`
- queries WIS Context Sync in read-only mode
- displays operational context inside VS Code
- prepares structured handoff payloads for future delegation
- does not perform writes
- does not perform automatic code execution
- does not change Codex or GitHub Copilot internal settings

---

## 4. In-scope

### 4.1 Local environment detection
- detect workspace root
- detect repo root
- detect current branch when available
- detect active file path
- detect whether the folder is a known project candidate

### 4.2 Session establishment
- identify consumer as `vscode_extension`
- create or reuse a local `session_key`
- keep a stable per-workspace session during editor usage

### 4.3 WIS read-only consumption
- call the existing 5 MCP tools
- send optional scope args when known
- handle `scope_conflict`, `scope_not_found`, `no_active_task`, and `ok`
- treat WIS as source of truth for effective scope

### 4.4 Context presentation
- show effective scope
- show current task summary
- show validation status
- show approved decisions
- show recent errors
- show context snapshot status

### 4.5 Handoff preparation
- package local context plus WIS context into structured handoff payloads
- prepare, but do not execute, future handoffs to ChatGPT / Codex / Copilot

### 4.6 Observability
- local extension logs for connection and resolution states
- user-visible statuses for connected, degraded, conflict, and unavailable

---

## 5. Out-of-scope

- write actions to WIS
- file modification
- shell command execution
- test execution
- autonomous repair loops
- background agents
- OAuth or auth redesign
- changes to MCP transport
- changes to MCP tool names
- changes to Codex or Copilot configuration
- rich chat UI inside VS Code

---

## 6. Architectural role

### 6.1 System role
The extension is the local control plane adapter.

It is not:
- the source of truth
- the policy engine
- the focus resolver of record
- the execution engine
- the orchestrator

### 6.2 Relationship to other components
- Wiston defines intent
- ChatGPT interprets and coordinates
- WIS Context Sync stores and resolves operational truth
- VS Code extension observes the local environment and exposes that context to the coordination flow

---

## 7. Functional requirements

### FR-1: Workspace bootstrap
When a user opens a workspace, the extension must initialize, detect local context, and generate or recover a `session_key`.

### FR-2: Consumer identity
The extension must identify itself as `vscode_extension` in every WIS request where consumer identity is supported.

### FR-3: Scope-aware queries
The extension must query WIS using the best available scope data:
- `task_id` when explicitly known
- otherwise `project_id`
- otherwise `workspace_id`
- always include `consumer`
- include `session_key` when available

### FR-4: Contract compliance
The extension must consume only the current stable MCP surface:
- `get_active_task`
- `get_context_snapshot`
- `get_recent_errors`
- `get_validation_status`
- `get_approved_decisions`

### FR-5: Context rendering
The extension must render a minimal context view showing:
- effective scope
- current task title and status
- validation status
- key approved decisions count
- recent error count
- snapshot freshness / source

### FR-6: Error semantics
The extension must distinguish between:
- transport error
- server error
- `scope_invalid`
- `scope_not_found`
- `scope_conflict`
- `no_active_task`
- empty-but-valid responses

### FR-7: No-write guarantee
The extension must not perform any action that changes WIS state beyond expected read-audit side effects.

### FR-8: Handoff packaging
The extension must be able to compose a read-only handoff payload containing:
- local workspace metadata
- effective WIS scope
- task summary
- validation summary
- decision summary
- error summary
- active file hint

---

## 8. Non-functional requirements

### NFR-1: Backward compatibility
No server-side breaking change is allowed as a dependency of Phase 3.

### NFR-2: Explainability
Any scope conflict or degraded state must be explainable to the user in plain language.

### NFR-3: Determinism
The extension must treat WIS scope resolution as authoritative and must not invent alternate scope resolution rules.

### NFR-4: Safety
No code execution, no automatic edits, no write RPCs.

### NFR-5: Resilience
Temporary WIS unavailability must degrade to a visible, non-destructive state.

### NFR-6: Low friction
The initial UX must remain minimal: a command surface, a side panel, and a lightweight status indicator.

---

## 9. Extension architecture

### 9.1 Module A — Activation Layer
Responsibilities:
- activate on workspace open
- register commands
- register views
- start internal services

### 9.2 Module B — Environment Inspector
Responsibilities:
- detect workspace root
- detect repo root
- detect branch
- detect active file
- produce local environment metadata

### 9.3 Module C — Session Manager
Responsibilities:
- create or recover `session_key`
- persist lightweight local session state
- bind local session to workspace

### 9.4 Module D — WIS Client
Responsibilities:
- call MCP endpoints through the agreed integration path
- send scope arguments
- normalize structured results
- normalize errors
- expose typed responses to the UI layer

### 9.5 Module E — Context Presenter
Responsibilities:
- show scope
- show task summary
- show validation
- show decisions
- show errors
- show transport / degradation status

### 9.6 Module F — Handoff Builder
Responsibilities:
- package local context plus WIS context
- generate handoff payloads for future flows
- no execution responsibility in Phase 3

---

## 10. UX surface

### 10.1 Commands
Minimum commands:
- `WIS: Load Context`
- `WIS: Refresh Context`
- `WIS: Show Scope Details`
- `WIS: Prepare Handoff`

### 10.2 Side panel
Minimum sections:
- Scope
- Task
- Validation
- Decisions
- Errors
- Snapshot metadata

### 10.3 Status indicator
Minimum states:
- connected
- loading
- degraded
- scope conflict
- unavailable

---

## 11. Request contract from extension to WIS

### 11.1 Inputs
The extension may send any subset of:
- `workspace_id`
- `project_id`
- `task_id`
- `consumer = vscode_extension`
- `session_key`

### 11.2 Resolution rule
The extension must assume WIS resolves scope using server-side precedence and must not try to overrule the backend.

### 11.3 Mandatory handling
Successful responses must preserve and display:
- `scope`
- `resolution_metadata`

For `get_context_snapshot`, the extension must also preserve:
- `consumer_context`
- `snapshot`
- `metadata`

---

## 12. Data model expectations on the client side

The extension should maintain a small local state object with:
- `session_key`
- `last_requested_scope`
- `last_resolved_scope`
- `last_resolution_metadata`
- `last_snapshot_summary`
- `connection_status`
- `last_sync_at`

This state is client-side cache, not source of truth.

---

## 13. Error handling model

### 13.1 Transport failures
Behavior:
- show unavailable or degraded status
- keep last successful context visible if present
- do not fabricate fresh context

### 13.2 `scope_conflict`
Behavior:
- show conflict state
- surface `resolution_metadata.conflict_flags`
- do not silently fallback to another scope in the UI

### 13.3 `scope_not_found`
Behavior:
- show no matching scope
- allow refresh or reset action

### 13.4 `no_active_task`
Behavior:
- keep scope visible if returned
- indicate there is no active task for the resolved context

### 13.5 Empty but valid errors list
Behavior:
- show “no recent errors”
- do not collapse to unknown or missing

---

## 14. Handoff artifact format (Phase 3 preparation only)

The extension must be able to build a structured handoff object with at least:
- consumer identity
- session key
- local workspace metadata
- effective WIS scope
- task summary
- validation summary
- approved decisions summary
- recent errors summary
- snapshot metadata
- active file hint
- requested handoff target

Targets may include:
- `chatgpt`
- `codex`
- `github_copilot`

In Phase 3, these handoffs are generated but not executed automatically.

---

## 15. Acceptance criteria

Phase 3 is complete only if all conditions below are true.

### AC-1: Extension boot
The extension activates in VS Code with a workspace open and creates or restores a valid `session_key`.

### AC-2: WIS read path
The extension can successfully retrieve context from all 5 MCP tools using the current read-only contract.

### AC-3: Scope visibility
The extension clearly shows the resolved scope and resolution source.

### AC-4: Conflict visibility
A forced inconsistent scope request results in a visible `scope_conflict` state with structured conflict details.

### AC-5: No-write behavior
No read path from the extension mutates domain tables beyond expected read-audit behavior.

### AC-6: Snapshot rendering
The extension renders task, validation, decisions, and errors in a stable and understandable way.

### AC-7: Degraded behavior
If WIS is unavailable, the extension fails visibly and safely without corrupting local state.

### AC-8: Handoff packaging
The extension can generate a structured handoff artifact for future Codex/Copilot/ChatGPT flows.

---

## 16. Suggested delivery slices

### Slice 1 — Extension shell
- activation
- command registration
- session manager
- status indicator

### Slice 2 — WIS client
- typed requests
- typed responses
- transport error handling
- normalization layer

### Slice 3 — Scope panel
- scope display
- task summary
- validation
- decisions
- errors

### Slice 4 — Conflict/degraded UX
- `scope_conflict`
- `scope_not_found`
- unavailable
- no active task

### Slice 5 — Handoff builder
- local context packaging
- WIS context packaging
- export/copy handoff payload

---

## 17. Risks

### R-1: Client-side scope drift
If the extension invents its own focus logic, it will diverge from WIS.

### R-2: Overbuilt UI
A complex UI before contract stability will slow the phase and add fragility.

### R-3: Premature delegation
Sending all context directly to Codex too early will bypass the intended control-plane model.

### R-4: Session ambiguity
Poor `session_key` lifecycle will produce stale or misleading scope semantics.

### R-5: Hidden degradation
If unavailable states are silent, the user will trust stale context.

---

## 18. Exit statement

Phase 3 ends when the VS Code extension functions as a reliable read-only local control plane for WIS Context Sync.

At that point:
- WIS remains the source of truth
- ChatGPT remains the semantic coordinator
- VS Code becomes the first real local consumer
- future delegation to Codex or Copilot can be built on contract, not improvisation

