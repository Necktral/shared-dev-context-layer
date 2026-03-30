# WIS Phase 3 Acceptance Gate
_Status: proposed acceptance gate for Fase 3_
_Scope: VS Code Control Plane Read-Only_

## 1. Purpose

Define the **binary acceptance gate** for **Fase 3** of WIS Context Sync.

Fase 3 is considered complete only if the VS Code control plane works as a **read-only consumer** of WIS, preserves the existing MCP contract, handles scope and conflict states correctly, and does not introduce write behavior, transport drift, or silent semantic degradation.

This gate is intentionally strict.  
It is not a progress checklist.  
It is a **Go / No-Go contract**.

---

## 2. Fase 3 objective

Fase 3 exists to turn the future VS Code extension into a **local control plane** that:

- identifies the local workspace context
- identifies itself as `vscode_extension`
- uses WIS Context Sync in read-only mode
- resolves scope through WIS, not locally
- presents operational state clearly
- prepares future delegation handoffs
- does not execute local changes
- does not perform writes

This objective must remain aligned with the existing Fase 2 contract:
- same 5 MCP tools
- same `streamable-http` transport on `/mcp`
- same `delegated_limited` mode
- same read-only posture
- optional scope args
- structured `resolution_metadata` and `scope` in successful responses. fileciteturn34file0L1-L1 fileciteturn36file0L1-L1

---

## 3. Gate philosophy

Fase 3 passes only if all of the following are true:

1. **The extension is useful**
2. **The extension is contract-safe**
3. **The extension is operationally honest**
4. **The extension is non-destructive**
5. **The extension is ready to support later delegation**

Failure in any critical area means **No-Go**.

---

## 4. Gate categories

The gate is divided into seven categories:

1. Activation and local runtime
2. Identity and session lifecycle
3. MCP compatibility and scope behavior
4. UI truthfulness and diagnostics
5. Read-only authority preservation
6. Handoff readiness
7. Regression and non-drift checks

---

## 5. Acceptance criteria

## Category A — Activation and local runtime

### A1. Extension activation
**Pass condition**
- The extension loads in VS Code without crashing the editor.
- No activation error blocks command registration or panel rendering.

**Evidence**
- Activation log
- Manual VS Code launch check
- No uncaught exception on activation

### A2. Command registration
**Pass condition**
- The command `WIS: Load Operational Context` exists and executes successfully.

**Evidence**
- Command palette invocation
- Local output log showing command dispatch

### A3. Minimal runtime stability
**Pass condition**
- Repeated load/refresh cycles do not break the extension host.
- Refreshing does not require reloading VS Code.

**Evidence**
- Manual repeated refresh sequence
- No extension host restart caused by the extension

---

## Category B — Identity and session lifecycle

### B1. Consumer identity
**Pass condition**
- The extension always identifies itself as `vscode_extension`.

This must remain consistent with the seeded consumer model in WIS. fileciteturn43file0L1-L1

### B2. Session creation
**Pass condition**
- The extension creates or restores a `session_key` for the current logical session.
- The key remains stable across multiple MCP calls in the same session.

### B3. Session reset
**Pass condition**
- The extension can deliberately reset the local session without corrupting UI state.
- After reset, a new valid `session_key` is used.

### B4. Session transparency
**Pass condition**
- The current `session_key` is visible in diagnostics or equivalent developer mode.

---

## Category C — MCP compatibility and scope behavior

### C1. Tool contract preservation
**Pass condition**
- The extension successfully uses the same five tools:
  - `get_active_task`
  - `get_context_snapshot`
  - `get_recent_errors`
  - `get_validation_status`
  - `get_approved_decisions`

No tool renaming, transport change, or compatibility drift is introduced. fileciteturn34file0L1-L1 fileciteturn36file0L1-L1

### C2. Scope input behavior
**Pass condition**
- The extension can call WIS with explicit scope input when known:
  - `workspace_id`
  - `project_id`
  - `task_id`
  - `consumer`
  - `session_key`

### C3. Scope success path
**Pass condition**
- Successful responses display:
  - `status: "ok"`
  - `scope`
  - `resolution_metadata`

This is required for all successful calls. fileciteturn34file0L1-L1 fileciteturn36file0L1-L1

### C4. Snapshot success path
**Pass condition**
- `get_context_snapshot` displays:
  - `consumer_context`
  - `snapshot`
  - `metadata`

and does so without dropping or collapsing major sections. fileciteturn34file0L1-L1

### C5. Conflict handling
**Pass condition**
- If WIS returns `scope_conflict`, the extension surfaces it explicitly.
- It shows:
  - requested scope
  - resolved scope
  - conflict flags
  - source
  - fallback level if present
- It does not silently coerce or mask the conflict.

The resolver explicitly supports structured conflict states and conflict flags such as mismatches between task, project, workspace, consumer, and session. fileciteturn35file0L1-L1

### C6. Not-found and invalid handling
**Pass condition**
- The extension explicitly handles:
  - `scope_invalid`
  - `scope_not_found`
  - `no_active_task`
  - `no_scope`

These states must not collapse into generic “failed” without context. fileciteturn35file0L1-L1 fileciteturn34file0L1-L1

### C7. Compatibility fallback
**Pass condition**
- Calls with partial or absent scope still work when WIS can resolve canonical scope.
- The extension correctly displays `resolution_metadata.source` and `fallback_level` instead of pretending explicit scope existed.

The resolver currently supports canonical scope and legacy compatibility fallback paths. fileciteturn35file0L1-L1

---

## Category D — UI truthfulness and diagnostics

### D1. Effective scope visibility
**Pass condition**
- The UI clearly shows effective:
  - workspace
  - project
  - task

### D2. Validation visibility
**Pass condition**
- Validation state is visible at a glance.
- `unknown` is not rendered as `passed`, `empty`, or transport error.

### D3. Decisions visibility
**Pass condition**
- The UI shows decisions count and a usable summary.

### D4. Errors visibility
**Pass condition**
- When there are no recent errors, the UI clearly renders:
  - “No recent errors”
- It does not render “unknown” or “no data” in that case.

### D5. Diagnostics block
**Pass condition**
- Diagnostics expose at least:
  - last request time
  - last response status
  - requested scope
  - resolved scope
  - conflict flags
  - fallback level
  - consumer
  - session key
  - endpoint

### D6. Honest degradation
**Pass condition**
- If WIS transport fails, the UI must show transport failure explicitly.
- The UI must not present cached state as if it were fresh current truth.

---

## Category E — Read-only authority preservation

### E1. No writes
**Pass condition**
- The extension performs no write requests against WIS.

### E2. No local mutation execution
**Pass condition**
- The extension does not:
  - edit files automatically
  - run shell commands automatically
  - trigger commits automatically
  - mutate repo state automatically

### E3. No policy bypass
**Pass condition**
- The extension does not attempt to bypass `delegated_limited`.
- It accepts filtered payloads as authoritative.

### E4. No silent local scope override
**Pass condition**
- The extension never overrides WIS scope resolution with its own local guess after conflict.

---

## Category F — Handoff readiness

### F1. Structured handoff packet
**Pass condition**
- The extension can build a `handoff_packet` containing at least:
  - effective scope
  - task summary
  - validation summary
  - decisions summary
  - recent errors summary
  - repo / branch if known
  - active file or module if known
  - `session_key`
  - source = `vscode_extension`

### F2. No execution coupling
**Pass condition**
- The handoff packet is generated without triggering any downstream executor automatically.

### F3. Context sufficiency
**Pass condition**
- The packet is useful enough to support a future ChatGPT / Codex / Copilot handoff without requiring the user to restate the whole situation manually.

---

## Category G — Regression and non-drift checks

### G1. Transport invariance
**Pass condition**
- Fase 3 does not change MCP transport from `streamable-http` on `/mcp`. fileciteturn34file0L1-L1 fileciteturn36file0L1-L1

### G2. Tool-name invariance
**Pass condition**
- Fase 3 does not rename or remove any of the five tools. fileciteturn34file0L1-L1

### G3. Read-only invariance
**Pass condition**
- Fase 3 does not introduce write actions. fileciteturn36file0L1-L1

### G4. Multi-scope invariance
**Pass condition**
- Fase 3 respects the multi-scope model and does not reintroduce a fake global-task assumption.
- It remains aligned with persisted entities such as:
  - `tasks`
  - `context_scopes`
  - `execution_sessions`
  - `projects`
  - `consumers` fileciteturn38file0L1-L1 fileciteturn39file0L1-L1 fileciteturn41file0L1-L1 fileciteturn43file0L1-L1 fileciteturn44file0L1-L1

### G5. Testability
**Pass condition**
- Fase 3 behavior is reproducible enough to support:
  - manual gate execution
  - future contract tests
  - future integration tests

---

## 6. Required evidence package

Fase 3 cannot be declared complete without evidence.

The minimum evidence package is:

1. **Activation evidence**
   - screenshot or log of extension activation
   - command registration proof

2. **Read-only success evidence**
   - successful load of:
     - active task
     - validation
     - decisions
     - recent errors
     - snapshot

3. **Conflict evidence**
   - explicit `scope_conflict` UI or diagnostic rendering

4. **Diagnostics evidence**
   - visible `session_key`
   - requested scope
   - resolved scope
   - conflict flags or fallback level

5. **No-write evidence**
   - proof that extension does not send write requests
   - proof that repo is not auto-mutated

6. **Handoff evidence**
   - sample generated `handoff_packet`

7. **Regression evidence**
   - no transport change
   - no tool-name change
   - no contract drift in base responses

---

## 7. Binary Go / No-Go rule

## GO
Fase 3 is **GO** only if:
- every critical acceptance criterion passes
- no write behavior was introduced
- no contract drift is detected
- no hidden conflict masking exists
- the extension is actually useful for reading and presenting operational context

## NO-GO
Fase 3 is **NO-GO** if any of these occur:
- extension activates unreliably
- `session_key` is unstable or hidden
- `scope_conflict` is masked
- transport errors are rendered as stale success
- write behavior exists
- tool contract was changed
- the extension presents ambiguous or misleading operational truth

---

## 8. Severity model for failures

### Critical
Any one critical failure blocks phase closure:
- write introduced
- tool drift
- transport drift
- scope conflict hidden
- extension crash on normal load
- false-success UI on transport failure

### Major
Must be fixed before closure unless explicitly waived:
- diagnostics incomplete
- session lifecycle unstable
- decisions/validation/errors not rendered clearly
- handoff packet incomplete

### Minor
May be deferred if documented:
- non-blocking UI polish
- wording improvements
- optional convenience commands
- cosmetic layout issues

---

## 9. Final gate statement

Fase 3 is complete only when the VS Code extension behaves as a **truthful, read-only local control plane** for WIS Context Sync:

- it can identify and preserve local session context
- it can consume WIS safely
- it can surface effective scope honestly
- it can render operational state coherently
- it can prepare future delegation
- and it does all of this **without writes, without contract drift, and without semantic deception**

Until that is true, Fase 3 is not closed.
