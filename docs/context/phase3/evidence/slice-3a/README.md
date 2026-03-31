# Slice 3A Closure Evidence Matrix

Objetivo: cerrar evidencia runtime visible para estados de carga en ambos modos (`offline_fixture` y `mcp`) sin writes.

## 1. Registro por corrida (template)

- Fecha/hora:
- Runtime mode:
- Endpoint (`mcpEndpoint`):
- Fixture scenario (si aplica):
- Command ejecutado: `WIS: Load Operational Context`
- `load_state` observado:
- `transport_status` observado:
- `runtime_mode` observado:
- `issues` observadas:
- `authority_map.conflict_flags` observadas:
- Confirmacion no-write:

## 2. Matriz minima obligatoria

### 2.1 offline_fixture

1. `success_full` -> esperado `loaded`
2. `partial_missing_recent_errors` -> esperado `partially_loaded`
3. `degraded_no_remote_bundle` -> esperado `degraded`
4. `transport_error` -> esperado degradacion/fallo explicito
5. `no_active_task` -> esperado issue de dominio explicita
6. `validation_stale` -> esperado issue de validacion stale

### 2.2 mcp

1. Endpoint valido -> carga operativa real
2. Endpoint invalido/timeout -> `transport_error` o `unavailable`
3. Payload parcial -> `partially_loaded`
4. Error de schema -> `schema_error`

## 3. Handoff evidence vinculada (Slice 4 baseline)

Tras cada corrida de contexto, ejecutar `WIS: Prepare Handoff` y registrar:

- `status`: `ready` / `partial` / `blocked`
- evidencia de prompts y resumen en Output Channel
- ausencia de writes y ausencia de ejecucion automatica downstream

## 4. Criterio de cierre

Slice 3A se considera cerrado solo si:

- matriz completa en ambos modos
- estados y issues trazables
- evidencia de no-write explicita
- coherencia con `docs/context/WIS_PHASE_3_ACCEPTANCE_GATE.md`
