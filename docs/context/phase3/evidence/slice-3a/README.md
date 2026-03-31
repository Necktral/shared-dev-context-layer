# Slice 3A Closure Evidence Matrix

Objetivo: cerrar evidencia runtime visible para estados `loaded`, `partially_loaded`, `degraded`, `failed` en ambos modos `offline_fixture` y `mcp`.

## Checklist por corrida

- Fecha/hora:
- Runtime mode:
- Fixture scenario (si aplica):
- Command: `WIS: Load Operational Context`
- Estado final observado (`load_state`):
- `transport_status` observado:
- `runtime_mode` observado:
- `issues` observadas:
- `authority_map.conflict_flags` observadas:
- Confirmación no-write (sin cambios de dominio):

## Matriz mínima obligatoria

### offline_fixture

1. `success_full` -> esperado `loaded`
2. `partial_missing_recent_errors` -> esperado `partially_loaded`
3. `degraded_no_remote_bundle` -> esperado `degraded`
4. `transport_error` -> esperado `failed` o degradación explícita con `transport_error`
5. `no_active_task` -> esperado estado remoto explícito `no_active_task`
6. `validation_stale` -> esperado issue explícito de `validation_stale`

### mcp

1. Endpoint válido -> carga operativa real
2. Endpoint inválido/timeout -> fallo de transporte explícito
3. Respuesta parcial -> estado parcial explícito
4. Transporte caído -> degradación/fallo explícito sin fallback silencioso

## Notas de aceptación

- Cada corrida debe adjuntar evidencia del Output Channel `WIS Context Sync`.
- No se acepta “ok general” sin estado final, issues y authority_map.
- El gate 3A queda cerrado solo con cobertura completa de la matriz.
