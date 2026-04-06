# ADR — Execution State Machine
_Status: accepted_
_Date: 2026-04-05_

## Contexto

El flujo local tenía estados implícitos y cierre dependiente del éxito textual del runner.  
Se requiere un modelo explícito para controlar transición, auditoría y recuperación.

## Decisión

Adoptar una máquina de estados persistida por tarea:

- `draft`
- `prepared`
- `running`
- `reconciling`
- `completed | partial | failed | timeout | cancelled | blocked`

Reglas:

- transiciones explícitas en `LocalCommandService`,
- persistencia del estado en `tasks.lifecycle_state`,
- historial en `task_state_transitions`,
- transición de error defensiva a `failed` cuando una excepción interrumpe `running/reconciling`.

## Consecuencias

Positivas:

- visibilidad operacional real por tarea,
- reglas de negocio claras para cierre técnico,
- mejor soporte para replay/recovery.

Costos:

- más writes por comando,
- validación de transición obligatoria.

## Alternativas descartadas

- estado derivado sólo de artifacts/events: rechazado por ambigüedad operacional.
- estado sólo en memoria: rechazado por pérdida de trazabilidad entre sesiones.
