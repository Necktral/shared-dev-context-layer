# WIS Phase 3 Spec
_Status: active spec (estado actual + roadmap)_
_Scope: VS Code control plane (read baseline + write plane v0.2.0)_

## 1. Objective

Entregar un consumidor local real de WIS en VS Code, con contexto estructurado, degradación explícita y preparación de handoff tipado; luego habilitar write plane controlado sin drift.

## 2. Problem statement

Sin esta fase:

- el contexto operativo queda solo server-side
- el editor no aporta señales locales de forma controlada
- la delegacion a Codex/Copilot depende de prompts manuales y no estructurados

## 3. Current functional scope

### 3.1 In scope (implemented baseline)

- deteccion de entorno local (workspace/repo/branch/active file)
- sesion local estable (`session_key`) para `vscode_extension`
- consumo de tools MCP publicadas (validación `all_published`)
- composicion de `OperationalContextEnvelope`
- presentacion en Output Channel
- `Prepare Handoff` en memoria con artifact tipado (Codex-first)
- comandos write/read de contexto con `dry_run|commit`, `idempotency_key` y auditoría

### 3.2 Out of scope

- mutaciones automaticas de repo
- shell execution automatica
- panel/webview avanzada
- export persistente de artifacts

## 4. Runtime and transport requirements

- runtime dual explicito: `offline_fixture | mcp`
- sin fallback silencioso entre modos
- en `mcp`: `streamable-http` y endpoint terminado en `/mcp`
- `published_tools` descubiertas en runtime via `list_tools` (sin conteo fijo)
- politica de validacion remota: `all_published` con registry de payloads
- auditoria esperada: `delta +N` con `N = invocadas exitosamente`
- `core_context_fields` invariantes para el envelope:
  - `active_task`
  - `context_snapshot`
  - `validation_status`
  - `approved_decisions`
  - `recent_errors`

## 5. Core contracts

### 5.1 OperationalContextEnvelope

Debe contener:

- `meta`
- `local_environment`
- `wis_context`
- `issues`
- `authority_map`
- `transport_diagnostics`

### 5.2 Load classification

- `loaded`
- `partially_loaded`
- `degraded`
- `failed`

### 5.3 Handoff baseline

- `HandoffIntent`
- `HandoffTarget`
- `HandoffBuildResult` (`ready | partial | blocked`)
- `HandoffArtifact` derivado solo de `OperationalContextEnvelope`

## 6. Authority and truthfulness requirements

- WIS manda sobre contexto canonico.
- Hints locales no se promueven a verdad.
- Conflictos y degradaciones se muestran explicitamente.
- `transport_error` no se renderiza como `no data`.

## 7. UX minimum for current phase

Comandos vigentes:

- `WIS: Load Operational Context`
- `WIS: Reset Session`
- `WIS: Prepare Handoff`
- `WIS: Search Context`
- `WIS: Upsert Context Item`
- `WIS: Append Context Event`
- `WIS: Link Context Entities`
- `WIS: Set Context Labels`
- `WIS: Archive Context Item`
- `WIS: Apply Sync Batch`

Surface minima:

- Output Channel con secciones operativas de contexto
- resumen de handoff y prompts
- notificaciones cortas de resultado

## 8. Non-functional requirements

- Guardrails de mutación verificables
- Deterministic behavior en `offline_fixture`
- compatibilidad MCP sin drift
- observabilidad suficiente para troubleshooting
- coherencia documental con codigo

## 9. Roadmap (post-baseline)

- hardening adicional de snapshots/contratos
- refino de presentacion (panel avanzado)
- handoff multi-target con plantillas optimizadas
- sin abrir write flows en esta etapa

## 10. Cross-links

- Contrato: `WIS_VSCODE_CONTROL_PLANE_CONTRACT.md`
- Arquitectura: `WIS_VSCODE_EXTENSION_ARCHITECTURE.md`
- Plan: `WIS_PHASE_3_IMPLEMENTATION_PLAN.md`
- Gate: `WIS_PHASE_3_ACCEPTANCE_GATE.md`
- MCP runbook: `../mcp/README.md`
- Evidencia 3A: `phase3/evidence/slice-3a/README.md`
- Evidencia 3B: `phase3/evidence/slice-3b/README.md`
