# WIS Phase 3 Implementation Plan
_Status: active plan (estado actual + roadmap)_
_Scope: VS Code control plane read-only_

## 1. Objetivo de ejecucion

Mantener una ruta de entrega por slices para evolucionar el control plane sin drift de contrato ni apertura prematura de writes.

## 2. Estado actual (ya implementado)

### Slice 0-2 (foundation, session, environment)

- bootstrap de extension
- sesion local estable (`vscode_extension`, `session_key`)
- inspeccion local de entorno

### Slice 3A (WIS consumption baseline)

- `OperationalContextEnvelope` tipado
- `LoadOperationalContextService` como orquestador
- `FixtureWISGateway` + `McpWISGateway`
- presentacion por Output Channel
- degradacion explicita (`loaded`, `partially_loaded`, `degraded`, `failed`)

### Slice 3B (hardening baseline)

- tests de contrato y snapshots
- clasificacion de errores tipada
- paridad semantica fixture vs mcp

### Slice 4 baseline (handoff)

- `WIS: Prepare Handoff`
- `HandoffBuilder` (Codex-first)
- `HandoffArtifact` en memoria
- estado de handoff: `ready | partial | blocked`

## 3. Plan de continuidad (roadmap corto)

### Slice 4.1 Hardening adicional

- ampliar contract snapshots de artifact/prompts
- reforzar pruebas de incertidumbre en `partial`/`degraded`
- consolidar evidencia runtime por modo

### Slice 5 Presentation refinement

- evaluar panel/tree view sin romper salida actual
- mantener Output Channel como fallback de verdad operativa

### Slice 6 Governance and traceability

- consolidar runbooks y evidencia de no-write
- reforzar pruebas de no fallback automatico de runtime

## 4. Reglas de implementacion transversales

1. Sin writes a WIS.
2. Sin fallback `mcp -> offline_fixture` automatico.
3. Sin renombrar tools MCP.
4. Sin cambiar transporte (`streamable-http` + `/mcp`).
5. Sin promover hints locales a verdad canonica.

## 5. Validation checkpoints

### 5.1 Consistency docs

- comandos reales documentados (3 comandos)
- settings reales documentados (5 settings)
- sin comandos legacy (`Refresh Context`, `Show Scope Details`)

### 5.2 Runtime

- `offline_fixture`: escenarios deterministas minimos
- `mcp`: endpoint valido + error de transporte explicito

### 5.3 Handoff

- `ready`, `partial`, `blocked` con evidencia reproducible

## 6. Cross-links

- Gate: `WIS_PHASE_3_ACCEPTANCE_GATE.md`
- Contrato: `WIS_VSCODE_CONTROL_PLANE_CONTRACT.md`
- Arquitectura: `WIS_VSCODE_EXTENSION_ARCHITECTURE.md`
- MCP runbook: `../mcp/README.md`
- Evidencia 3A: `phase3/evidence/slice-3a/README.md`
- Evidencia 3B: `phase3/evidence/slice-3b/README.md`
