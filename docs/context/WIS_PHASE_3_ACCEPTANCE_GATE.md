# WIS Phase 3 Acceptance Gate
_Status: active gate (Go/No-Go)_
_Scope: VS Code control plane read-only_

## 1. Purpose

Definir criterios binarios para cerrar Fase 3 sin drift de contrato, sin writes y con soporte dual de runtime.

## 2. Gate principles

Fase 3 solo es **GO** si el sistema es:

1. util en runtime real
2. contract-safe
3. honesto en degradacion
4. read-only verificable
5. listo para handoff estructurado

## 3. Mandatory categories

## A. Activation and command surface

Pass:

- extension activa sin crash
- comandos disponibles y funcionales:
  - `WIS: Load Operational Context`
  - `WIS: Reset Session`
  - `WIS: Prepare Handoff`

## B. Runtime dual and transport

Pass:

- `runtimeMode=offline_fixture` funcional con escenarios deterministas
- `runtimeMode=mcp` funcional con endpoint `/mcp`
- sin fallback automatico entre modos

## C. MCP compatibility

Pass:

- se mantienen las 5 tools estables
- transporte `streamable-http` sin drift
- errores de transporte/esquema/dominio diferenciados

## D. Context truthfulness

Pass:

- `OperationalContextEnvelope` consistente
- estados de carga visibles: `loaded`, `partially_loaded`, `degraded`, `failed`
- conflictos y degradaciones visibles, no enmascarados

## E. Handoff readiness (Slice 4 baseline)

Pass:

- `Prepare Handoff` produce `HandoffBuildResult`
- estados visibles: `ready`, `partial`, `blocked`
- artifact derivado solo de `OperationalContextEnvelope`

## F. Read-only authority

Pass:

- no writes a WIS
- no shell auto-execution
- no mutacion automatica de repo
- no bypass de `delegated_limited`

## 4. Required evidence package

1. **Runtime evidence (offline_fixture)**
- `success_full` -> `loaded`
- `partial_missing_recent_errors` -> `partially_loaded`
- `degraded_no_remote_bundle` -> `degraded`
- `transport_error` -> fallo/degradacion explicita
- `no_active_task`
- `validation_stale`

2. **Runtime evidence (mcp)**
- endpoint valido con carga real
- endpoint invalido/timeout con `transport_error`
- respuesta parcial con `partially_loaded`

3. **Handoff evidence**
- casos `ready`, `partial`, `blocked`
- resumen en Output Channel
- evidencia de no-write

4. **Contract evidence**
- snapshots de envelope y renderer
- snapshots de handoff artifact/prompts
- paridad semantica fixture vs mcp

## 5. Go / No-Go criteria

### GO

- todas las categorias A-F en pass
- evidencia completa y reproducible
- sin contradicciones entre docs y codigo

### NO-GO

- cualquier drift en comandos/settings/runtime contract
- cualquier write behavior
- degradacion oculta o estado engañoso
- handoff acoplado a ejecucion downstream

## 6. References

- Contrato: `WIS_VSCODE_CONTROL_PLANE_CONTRACT.md`
- Arquitectura: `WIS_VSCODE_EXTENSION_ARCHITECTURE.md`
- Plan: `WIS_PHASE_3_IMPLEMENTATION_PLAN.md`
- MCP runbook: `../mcp/README.md`
- Evidencia 3A: `phase3/evidence/slice-3a/README.md`
- Evidencia 3B: `phase3/evidence/slice-3b/README.md`
