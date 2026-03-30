# WIS Phase 3 Implementation Plan
_Status: proposed implementation plan for Fase 3_
_Scope: VS Code Control Plane Read-Only_

## 1. Purpose

Provide an execution plan for building Fase 3 of WIS Context Sync in a controlled order.

Fase 3 is not a general “build an extension” phase.  
It is the phase where the project introduces a **VS Code control plane** that consumes WIS Context Sync safely in read-only mode.

This plan focuses on:
- implementation order
- slices
- dependencies
- validation milestones
- risk control

---

## 2. Fase 3 objective

Deliver a VS Code extension that:
- identifies itself as `vscode_extension`
- maintains local session continuity
- reads operational context from WIS
- presents effective scope and state in the editor
- handles structured conflicts and transport failures honestly
- prepares future handoff packets
- performs no writes

---

## 3. Delivery strategy

The phase should be implemented in **thin vertical slices**, not as one monolithic extension.

Reason:
- faster validation
- less architectural drift
- easier rollback
- earlier discovery of integration problems

Recommended slice order:
1. foundation
2. session and identity
3. WIS connectivity
4. control plane UI
5. conflict handling and diagnostics
6. handoff preparation
7. hardening and closure

---

## 4. Slice 0 — Project foundation

### Goal
Create the extension project scaffold and runtime baseline.

### Deliverables
- extension manifest
- extension host bootstrap
- one registered command
- local logging/output channel
- configuration surface for MCP endpoint

### Definition of done
- extension loads
- command appears in palette
- command can write to output/log
- endpoint config can be set explicitly

### Risks
- bad scaffold choices
- overengineering too early
- confusing activation behavior

---

## 5. Slice 1 — Consumer identity and session lifecycle

### Goal
Make the extension a stable consumer from WIS’s point of view.

### Deliverables
- fixed `consumer = "vscode_extension"`
- local `session_key` generation
- session reuse within a logical editor session
- session reset command
- session diagnostics

### Definition of done
- same session key reused across repeated calls
- new key generated on reset
- session key visible in diagnostics
- consumer identity stable

### Risks
- unstable session identity
- hidden session recreation
- bad persistence choice for session storage

---

## 6. Slice 2 — Environment inspection

### Goal
Read local context without yet calling WIS.

### Deliverables
- workspace root detection
- repo root detection if available
- current branch detection if available
- active file path detection
- local environment snapshot object

### Definition of done
- extension can show local environment snapshot in diagnostics
- missing git or file context degrades cleanly
- no fake certainty is displayed

### Risks
- assuming git exists everywhere
- coupling scope to file path too early
- mixing local hints with authoritative scope

---

## 7. Slice 3 — WIS Client baseline

### Goal
Introduce read-only MCP communication.

### Deliverables
- WIS client adapter
- support for the 5 MCP tools
- baseline load sequence
- normalization of success/error payloads
- transport failure handling

### Baseline call order
1. `get_active_task`
2. `get_validation_status`
3. `get_approved_decisions`
4. `get_recent_errors`
5. `get_context_snapshot`

### Definition of done
- extension can call WIS successfully
- `status: "ok"` responses are parsed correctly
- transport failure becomes a distinct state
- no silent crash on failed request

### Risks
- brittle MCP client implementation
- bad normalization of structured errors
- treating transport error as “no data”

---

## 8. Slice 4 — Scope-aware loading

### Goal
Send the best available scope hints while respecting WIS authority.

### Deliverables
- scope input builder
- optional use of:
  - `workspace_id`
  - `project_id`
  - `task_id`
  - `consumer`
  - `session_key`
- response rendering for:
  - `scope`
  - `resolution_metadata`

### Definition of done
- extension can load with partial or explicit scope input
- extension renders resolved scope
- extension displays `source`, `fallback_level` and `conflict_flags`

### Risks
- local override temptation
- confusion between requested and resolved scope
- hiding fallback behavior

---

## 9. Slice 5 — Control plane UI

### Goal
Make the extension useful to a human in the editor.

### Deliverables
Main control plane view with:
- effective scope
- active task summary
- validation state
- approved decisions summary
- recent errors summary
- snapshot metadata
- diagnostics section

### Definition of done
- a user can understand current operational state from the view
- refresh works
- UI remains stable after repeated loads
- no misleading empty states

### Risks
- building too much UI
- prioritizing visual polish over operational truth
- collapsing important detail

---

## 10. Slice 6 — Conflict and degraded-state UX

### Goal
Make failures and ambiguities first-class.

### Deliverables
Explicit rendering for:
- `scope_conflict`
- `scope_invalid`
- `scope_not_found`
- `no_active_task`
- `no_scope`
- transport failure
- stale cached state indicator

### Definition of done
- no scope conflict is hidden
- no transport failure is misrepresented as success
- diagnostics show enough evidence to troubleshoot

### Risks
- masking errors for perceived UX smoothness
- flattening structured states into generic “failed”
- false confidence from cached state

---

## 11. Slice 7 — Handoff Builder

### Goal
Prepare the future delegation plane without executing it.

### Deliverables
- `handoff_packet` builder
- export or copy action
- packet includes:
  - effective scope
  - task summary
  - validation
  - decisions
  - recent errors
  - repo/branch
  - active file if known
  - session key
  - source tag

### Definition of done
- packet can be generated on demand
- packet is structured and reusable
- no downstream action is auto-triggered

### Risks
- coupling handoff generation to execution
- insufficient context in packet
- handoff structure drifting from real use

---

## 12. Slice 8 — Hardening for phase closure

### Goal
Close Fase 3 cleanly.

### Deliverables
- retry policy only where appropriate
- clear endpoint diagnostics
- local stale-state marking
- documented test flow
- evidence package aligned with acceptance gate

### Definition of done
- extension behavior is reproducible
- failures are observable
- acceptance gate can be executed directly

### Risks
- doing cosmetic fixes instead of hardening
- incomplete evidence package
- leaving transport/debug blind spots

---

## 13. Cross-slice engineering rules

1. Never introduce write behavior.
2. Never bypass WIS scope resolution.
3. Never rename or replace the five tools.
4. Never change transport in Fase 3.
5. Never hide `scope_conflict`.
6. Never present stale data as fresh truth.
7. Never let UI convenience override operational truth.

---

## 14. Required validation per slice

### Slice 0
- activation test
- command registration test

### Slice 1
- session creation test
- session reuse test
- session reset test

### Slice 2
- workspace detection test
- repo/branch detection test
- missing git graceful degradation

### Slice 3
- successful MCP call test
- transport failure test
- response normalization test

### Slice 4
- explicit scope test
- partial scope test
- canonical fallback test
- `scope_conflict` test

### Slice 5
- render check for all core sections
- repeated refresh stability

### Slice 6
- invalid/not-found/conflict/error state rendering
- stale indicator test

### Slice 7
- handoff packet generation test
- handoff packet completeness check

### Slice 8
- full acceptance gate rehearsal

---

## 15. Evidence package required at phase end

Fase 3 cannot close without:
- extension activation proof
- working command proof
- success responses from the 5 tools
- conflict rendering proof
- diagnostics block proof
- proof of no writes
- sample `handoff_packet`
- acceptance gate checklist result

---

## 16. Dependency map

### Depends on Fase 2
- multi-scope persistence
- `focus_resolver`
- optional scope args in MCP
- `resolution_metadata`
- `consumer_context`
- seeded consumer `vscode_extension`

### Does not depend on yet
- auth
- write actions
- execution controller
- local execution agent
- Copilot/Codex integration logic
- advanced policy expansion

---

## 17. Recommended implementation order

The recommended build order is:

1. extension scaffold
2. session manager
3. environment inspector
4. WIS client
5. scope-aware loading
6. control plane UI
7. diagnostics and conflict UX
8. handoff builder
9. hardening and acceptance gate

This order minimizes wasted effort and keeps the extension aligned with real contract behavior.

---

## 18. Exit criteria

Fase 3 is complete when all are true:
- extension activates reliably
- `vscode_extension` identity is stable
- `session_key` lifecycle works
- MCP calls succeed and degrade honestly
- effective scope is visible
- conflict states are explicit
- no write behavior exists
- handoff packet is available
- acceptance gate passes

---

## 19. No-Go conditions

Stop and do not close Fase 3 if:
- session identity is unstable
- transport errors are hidden
- scope conflicts are masked
- UI is misleading
- write behavior appears
- contract drift occurs
- extension becomes a shadow truth source

---

## 20. Final statement

Fase 3 should be implemented as a controlled, read-only, scope-aware VS Code control plane. The correct strategy is not “build a big extension”, but “deliver thin slices that preserve truth, compatibility and authority boundaries while making operational context visible in the editor.”
