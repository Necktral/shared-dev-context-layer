# WIS VS Code Extension Architecture
_Status: active architecture (Slice 3A + Slice 4 baseline)_
_Scope: control plane read-only, project-first_

## 1. Objetivo

Definir una arquitectura por capas para consumir contexto operativo de WIS con degradacion explicita y soporte dual de runtime.

## 2. Arquitectura por capas (hexagonal)

### Capa 1: Domain Core

Responsabilidad:

- tipos canonicos (`OperationalContextEnvelope`, `OperationalIssue`)
- estados (`LoadState`, `TransportStatus`)
- reglas de autoridad y conflicto

No conoce VS Code, MCP ni UI.

### Capa 2: Application / Orchestration

Servicio principal:

- `LoadOperationalContextService`

Flujo:

1. leer config
2. recuperar/crear sesion
3. inspeccionar entorno local
4. cargar bundle WIS via `WISGateway`
5. componer envelope
6. clasificar estado
7. emitir diagnostics
8. presentar

Servicio complementario:

- `HandoffBuilder` (Slice 4 baseline)

### Capa 3: Infrastructure Adapters

- `EnvironmentInspector`
- `WISGateway` con dos implementaciones:
  - `FixtureWISGateway` (`offline_fixture`)
  - `McpWISGateway` (`mcp`)

### Capa 4: Presentation

- `ContextPresenter`
- `ViewModelMapper`
- `OutputChannelRenderer`
- `HandoffOutputChannelRenderer`

### Capa 5: Diagnostics / Evidence

- eventos de carga
- formato de evidencia
- checklists manuales para cierre de gate

## 3. Runtime model

Modos soportados:

- `offline_fixture`: deterministic fixtures para desarrollo y tests
- `mcp`: transporte real (`streamable-http`) contra endpoint `/mcp`

Regla:

- modo explicito por config, sin fallback automatico

## 4. Data flow (current)

### 4.1 Load context

`WIS: Load Operational Context` ejecuta:

- `SessionManager`
- `EnvironmentInspector`
- `WISGateway.loadOperationalBundle`
- `composeOperationalContext`
- `ContextPresenter`
- persistencia en `lastOperationalContextEnvelope` (in-memory)

### 4.2 Prepare handoff

`WIS: Prepare Handoff` ejecuta:

- lectura de `lastOperationalContextEnvelope`
- validacion de precondiciones
- construccion de `HandoffArtifact` tipado
- render de resumen y prompts en Output Channel

## 5. Authority model

- WIS es canonico para `active_task`, `context_snapshot`, `validation_status`, `approved_decisions`, `recent_errors`, `scope`, `resolution_metadata`.
- entorno local solo aporta hints (`workspace_root`, `repo_root`, `branch`, `active_file`).
- conflictos no se corrigen en silencio; se reportan como issues + `conflict_flag`.

## 6. Estado actual vs roadmap

### Estado actual implementado

- output channel estructurado
- contrato tipado de envelope
- gateway dual (`fixture` + `mcp`)
- handoff baseline codex-first en memoria

### Roadmap posterior (no abierto en este slice)

- panel/tree/webview avanzada
- export de artifacts
- write flows
- sync bidireccional
- automatizacion de resolucion de conflictos

## 7. Cross-links

- Contrato: `WIS_VSCODE_CONTROL_PLANE_CONTRACT.md`
- Spec: `WIS_PHASE_3_SPEC.md`
- Plan: `WIS_PHASE_3_IMPLEMENTATION_PLAN.md`
- Gate: `WIS_PHASE_3_ACCEPTANCE_GATE.md`
- MCP runbook: `../mcp/README.md`
- Evidencia 3A: `phase3/evidence/slice-3a/README.md`
- Evidencia 3B: `phase3/evidence/slice-3b/README.md`
