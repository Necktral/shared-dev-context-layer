# WIS Phase 3 Acceptance Gate
_Status: active gate (Go/No-Go)_
_Scope: VS Code control plane + write plane controlado_

## 1. Purpose

Definir criterios binarios para cerrar Fase 3 + v0.2.0 sin drift de contrato, con soporte dual de runtime y write plane controlado.

## 1.1 Relacion con Fase 1 local-first

- Este documento define el **GO global de fase**.
- El **GO local separado** se define en `WIS_PHASE_1_LOCAL_FIRST_ACCEPTANCE_GATE.md`.
- GO local no reemplaza este gate global.

## 2. Gate principles

Fase 3 solo es **GO** si el sistema es:

1. util en runtime real
2. contract-safe
3. honesto en degradacion
4. mutación controlada y verificable
5. listo para handoff estructurado

## 3. Mandatory categories

## A. Activation and command surface

Pass:

- extension activa sin crash
- comandos disponibles y funcionales:
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

## B. Runtime dual and transport

Pass:

- `runtimeMode=offline_fixture` funcional con escenarios deterministas
- `runtimeMode=mcp` funcional con endpoint `/mcp`
- sin fallback automatico entre modos

## C. MCP compatibility

Pass:

- `published_tools` se descubren dinamicamente via `list_tools`
- validacion operacional ejecuta politica `all_published`
- invocacion dinamica usa registry de payloads
- cualquier `required_params_without_registry_payload` implica NO-GO
- cobertura de `core_context_fields` para el envelope (`active_task`, `context_snapshot`, `validation_status`, `approved_decisions`, `recent_errors`)
- auditoria dinamica: `delta +N`, donde `N = tools invocadas exitosamente`
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

## F. Write guardrails

Pass:

- write tools disponibles solo por comando explícito
- `dry_run|commit` funcional
- `idempotency_key` obligatoria en commit
- auditoría write (`context_write_audit`) + `publish_audit`
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
- `published_tools` no vacia y policy `all_published` en verde
- auditoria dinamica consistente: `delta +N` con `N = invocadas exitosamente`

3. **Handoff evidence**
- casos `ready`, `partial`, `blocked`
- resumen en Output Channel
- evidencia de no-write

4. **Write evidence**
- `dry_run` exitoso sin mutación de tablas de dominio
- `commit` exitoso con mutación esperada y auditoría consistente
- respuesta explícita ante `403 insufficient_scope`

5. **Contract evidence**
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
- write behavior sin `dry_run|commit` o sin idempotencia/auditoría
- degradacion oculta o estado engañoso
- handoff acoplado a ejecucion downstream

## 6. References

- Contrato: `WIS_VSCODE_CONTROL_PLANE_CONTRACT.md`
- Arquitectura: `WIS_VSCODE_EXTENSION_ARCHITECTURE.md`
- Plan: `WIS_PHASE_3_IMPLEMENTATION_PLAN.md`
- MCP runbook: `../mcp/README.md`
- Evidencia 3A: `phase3/evidence/slice-3a/README.md`
- Evidencia 3B: `phase3/evidence/slice-3b/README.md`
