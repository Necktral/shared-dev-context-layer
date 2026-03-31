# WIS VS Code Control Plane Contract
_Status: active contract (Slice 3A + Slice 4 baseline)_
_Scope: VS Code read-only control plane + MCP compatibility_

## 1. Purpose

Definir el contrato operativo para la extension de VS Code como consumidor read-only de WIS.

Este contrato fija:

- limites de autoridad (WIS canonical vs local hints)
- contrato de runtime dual (`offline_fixture` y `mcp`)
- superficie publica de comandos y settings
- contratos tipados de contexto y handoff
- taxonomia de estados y errores

## 2. System role split

- **WIS**: autoridad canonica de contexto operativo.
- **VS Code extension**: orquestador read-only local.
- **Codex/ChatGPT/Copilot**: consumidores downstream de handoff, no fuente canonica.

La extension no decide verdad canonica ni ejecuta writes.

## 3. Runtime contract

### 3.1 Modes

La extension soporta exactamente dos modos:

- `offline_fixture`
- `mcp`

No hay fallback automatico entre modos.

### 3.2 MCP transport invariants

Para `mcp`:

- transporte: `streamable-http`
- endpoint: URL explicita terminada en `/mcp`
- `published_tools`: descubiertas en runtime via `list_tools` (sin fijar cantidad)
- politica de validacion de endpoint/conector: `all_published`
- `core_context_fields` del envelope:
  - `active_task`
  - `context_snapshot`
  - `validation_status`
  - `approved_decisions`
  - `recent_errors`

## 4. Public extension surface

### 4.1 Commands

- `WIS: Load Operational Context`
- `WIS: Reset Session`
- `WIS: Prepare Handoff`

### 4.2 Settings

- `wisContextSync.mcpEndpoint`
- `wisContextSync.runtimeMode` (`offline_fixture | mcp`)
- `wisContextSync.requestTimeoutMs`
- `wisContextSync.fixtureScenario`
- `wisContextSync.diagnosticMode`

## 5. Core contracts

### 5.1 Operational context

Contrato central: `OperationalContextEnvelope`.

Campos obligatorios de alto nivel:

- `meta`
- `local_environment`
- `wis_context`
- `issues`
- `authority_map`
- `transport_diagnostics`

### 5.2 Load state contract

Estados de carga soportados:

- `idle`
- `preparing`
- `inspecting_local`
- `connecting_wis`
- `loading_remote`
- `composing`
- `presenting`
- `loaded`
- `partially_loaded`
- `degraded`
- `failed`

### 5.3 Transport status contract

- `ok`
- `partial`
- `degraded`
- `transport_error`
- `schema_error`
- `unavailable`

### 5.4 Handoff contract (Slice 4 baseline)

`HandoffBuilder` consume solo `OperationalContextEnvelope` y produce `HandoffBuildResult`:

- `ready`
- `partial`
- `blocked`

Artifact tipado: `HandoffArtifact` (Codex-first), sin export a archivo en v1.

## 6. Authority and precedence rules

1. WIS manda sobre contexto canonico.
2. Inspector local aporta solo hints (`workspace_root`, `repo_root`, `branch`, `active_file`).
3. Nunca derivar verdad de task/scope/validation desde paths locales.
4. Si hay conflicto, se marca `conflict_flag`; no se resuelve en silencio.

## 7. Error model

`OperationalIssue` con:

- `kind` (`transport | protocol | domain | local | presentation`)
- `source`
- `severity` (`info | warning | error`)
- `message`
- `recoverable`
- `evidence_hint`
- `conflict_flag?`

## 8. Read-only boundaries

Permitido:

- consumo read-only de tools MCP
- composicion de contexto
- presentacion y handoff en memoria

No permitido:

- writes a WIS
- ejecucion automatica de shell
- mutacion automatica de repo
- bypass de policy `delegated_limited`

## 9. Minimum UX contract (current)

Surface minima actual:

- Output Channel estructurado para contexto
- Output Channel resumido para handoff
- notificaciones breves en comandos

Panel/webview avanzada queda en roadmap posterior.

## 10. Cross-links

- Arquitectura: `WIS_VSCODE_EXTENSION_ARCHITECTURE.md`
- Spec: `WIS_PHASE_3_SPEC.md`
- Acceptance gate: `WIS_PHASE_3_ACCEPTANCE_GATE.md`
- MCP runbook: `../mcp/README.md`
- MCP read model contract: `../mcp/vscode_read_model_contract.md`
- Evidencia 3A: `phase3/evidence/slice-3a/README.md`
- Evidencia 3B: `phase3/evidence/slice-3b/README.md`
