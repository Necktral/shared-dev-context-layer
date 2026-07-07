# WIS VS Code Extension Architecture
_Status: active architecture (Slice 3A + Slice 4 baseline + v0.2.0 write plane + local-private)_
_Scope: control plane read/write + local-private profile_

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

### 4.3 Write tools (v0.2.0)

Comandos write (`WIS: Upsert Context Item`, `WIS: Append Context Event`, `WIS: Link Context Entities`, `WIS: Set Context Labels`, `WIS: Archive Context Item`, `WIS: Apply Sync Batch`) ejecutan:

- resolucion de auth via `AuthManager`
- invocacion de `ContextCommandService` con `dry_run|commit`
- `idempotency_key` obligatoria en commit
- auditoria write + publish_audit por operacion
- resultado renderizado en Output Channel

### 4.4 Local runtime (local-private profile)

Comandos locales (`WIS: Local Index`, `WIS: Local Prepare Task`, `WIS: Local Run Codex`, `WIS: Local Refresh`, `WIS: Local Doctor`) ejecutan via `LocalCommandService`:

- indexacion incremental del workspace (`IncrementalWorkspaceIndexer`)
- preparacion de task con playbooks por tiers (`system`, `workspace`, `project`)
- ejecucion supervisada de Codex CLI con `AbortController`
- reconciliacion before/after (`PostRunReconciler`)
- panel lateral `WIS Local Runtime` (WebviewViewProvider)

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
- write plane: `upsert_context_item`, `append_context_event`, `link_context_entities`, `set_context_labels`, `archive_context_item`, `apply_sync_batch` con `dry_run|commit`, `idempotency_key` y auditoría
- autenticación: `bearer` / `api_key` / `none` con `SecretStorage`
- perfil `local_private`: panel lateral + comandos locales supervisados (`Local Index`, `Local Prepare Task`, `Local Run Codex`, `Local Refresh`, `Local Doctor`, `Local Configure DB Password`)
- indexador incremental con configuración `localIndex.*`
- persistencia PostgreSQL para perfil `local_private`

### Roadmap posterior (no abierto en este slice)

- panel/tree/webview avanzada
- export de artifacts
- sync bidireccional automatico
- automatizacion de resolucion de conflictos

## 7. Cross-links

- Contrato: `WIS_VSCODE_CONTROL_PLANE_CONTRACT.md`
- Spec: `WIS_PHASE_3_SPEC.md`
- Plan: `WIS_PHASE_3_IMPLEMENTATION_PLAN.md`
- Gate: `WIS_PHASE_3_ACCEPTANCE_GATE.md`
- MCP runbook: `../mcp/README.md`
- Evidencia 3A: `phase3/evidence/slice-3a/README.md`
- Evidencia 3B: `phase3/evidence/slice-3b/README.md`
