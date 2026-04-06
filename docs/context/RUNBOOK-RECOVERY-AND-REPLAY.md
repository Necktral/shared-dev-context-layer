# RUNBOOK — Recovery and Replay (Local Private)

## 1. Objetivo

Definir respuesta operativa para:

- runs interrumpidos,
- locks huérfanos,
- necesidad de replay idempotente.

## 2. Síntomas y diagnóstico rápido

### A. `local_run_codex` devuelve proyecto bloqueado

Posible causa:

- lock activo en `project_run_locks`.

Acción:

1. Verificar ejecución activa real.
2. Si no existe run activo, esperar expiración de TTL o liberar lock obsoleto.

### B. Resultado inconsistente tras error intermedio

Posible causa:

- fallo en transición `running/reconciling`.

Acción:

1. Revisar `tasks.lifecycle_state`.
2. Revisar `task_state_transitions` por último estado.
3. Confirmar si terminó en `failed` por fallback defensivo.

### C. Reintento debe retornar mismo resultado

Acción:

1. Reejecutar mismo comando con mismo contexto.
2. Confirmar replay desde `idempotency_records`.

## 3. Consultas operativas sugeridas

```sql
-- Estado actual de tareas
SELECT id, project_id, lifecycle_state, updated_at
FROM local_private.tasks
ORDER BY updated_at DESC;
```

```sql
-- Historial de transición de una tarea
SELECT task_id, from_state, to_state, reason, execution_id, created_at
FROM local_private.task_state_transitions
WHERE task_id = $1
ORDER BY created_at ASC;
```

```sql
-- Lock activo por proyecto
SELECT project_id, lock_id, owner, acquired_at, expires_at
FROM local_private.project_run_locks
WHERE project_id = $1;
```

```sql
-- Replay/idempotencia
SELECT command, idempotency_key, status, updated_at
FROM local_private.idempotency_records
WHERE project_id = $1
ORDER BY updated_at DESC;
```

```sql
-- Orden de eventos por ejecución
SELECT execution_id, seq_no, event_type, severity, created_at
FROM local_private.events
WHERE execution_id = $1
ORDER BY seq_no ASC;
```

## 4. Criterios de salud

- no existe lock activo sin ejecución viva por encima de TTL,
- cada run finalizado tiene outcome + review payload + reindex summary,
- secuencia de eventos por ejecución sin huecos lógicos.

## 5. Replay seguro

Recomendación:

- usar replay para reintentos técnicos inmediatos (misma intención y mismo estado),
- crear nueva tarea (`prepare`) cuando se busca una iteración funcional nueva.
