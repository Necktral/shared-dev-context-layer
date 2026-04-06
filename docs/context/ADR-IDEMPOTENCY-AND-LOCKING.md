# ADR — Idempotency and Project Locking
_Status: accepted_
_Date: 2026-04-05_

## Contexto

Sin locking e idempotencia, dos runs concurrentes sobre el mismo proyecto podían generar:

- condiciones de carrera,
- eventos inconsistentes,
- artifacts duplicados sin semántica clara.

## Decisión

### 1. Single-writer por proyecto

- tabla `project_run_locks`,
- lock lógico por `project_id`,
- adquisición con TTL,
- liberación al finalizar (`finally` best-effort).

### 2. Idempotencia por comando

- tabla `idempotency_records`,
- clave única `(project_id, command, idempotency_key)`,
- `local_prepare_task` y `local_run_codex` consultan replay antes de ejecutar.

### 3. Eventos idempotentes y ordenados

- `events.seq_no` monotónico por `execution_id`,
- `events.idempotency_key` para dedupe opcional.

## Semántica de entrega

- producción de eventos/artifacts en at-least-once,
- consumo idempotente por clave cuando aplique.

## Consecuencias

Positivas:

- elimina doble ejecución concurrente por proyecto,
- replay determinista en reintentos,
- orden de eventos reproducible por ejecución.

Tradeoffs:

- mayor complejidad en persistencia,
- mantenimiento de TTL de lock.
