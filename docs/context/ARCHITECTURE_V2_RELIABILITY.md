# ARCHITECTURE V2 RELIABILITY
_Status: active_
_Scope: `local_private`_

## 1. Objetivo

Elevar el run-plane local a una plataforma determinista con:

- máquina de estados canónica por tarea,
- single-writer por proyecto,
- reconciliación before/after verificable,
- reindex condicionado por diff real,
- persistencia auditable e idempotente.

## 2. Componentes principales

- `LocalCommandService`: orquestación de `prepare/run`.
- `PostRunReconciler`: snapshot before/after, diff, clasificación, plan de reindex, review payload.
- `WorkspaceSnapshotter`: captura determinista del workspace con reglas del indexador.
- `WorkspaceDiffAnalyzer`: diff estable de create/modify/delete/unchanged.
- `ExecutionOutcomeClassifier`: outcome operativo con precedencia fija.
- `IncrementalWorkspaceIndexer`: `runIndex` (full) + `runIndexByPaths` (scoped).
- `PostgresPersistenceAdapter`: locks, idempotencia, transición de estado, eventos con `seq_no`.

## 3. Contratos V2

- `TaskSpecV2`
- `ExecutionEnvelopeV2`
- `WorkspaceSnapshotV2`
- `WorkspaceDiffV2`
- `OutcomeClassificationV2`
- `ReindexPlanV2`
- `ReviewPayloadV2`
- `EventEnvelopeV2`

Todos definidos en `src/local/types.ts` y usados por el flujo local.

## 4. Máquina de estados

Estados:

- `draft -> prepared -> running -> reconciling -> completed|partial|failed|timeout|cancelled|blocked`

Transiciones activas:

- `local_prepare_task`: `draft -> prepared`
- `local_run_codex`:
  - `prepared -> running`
  - `running -> reconciling`
  - `reconciling -> final` (mapeado por outcome)
- fallback de error runtime: `running|reconciling -> failed`

Persistencia:

- estado actual en `tasks.lifecycle_state`
- historial en `task_state_transitions`

## 5. Concurrencia e idempotencia

### Single-writer

- tabla `project_run_locks`
- 1 lock activo por `project_id`
- adquisición con TTL
- liberación best-effort en `finally`

### Idempotencia

- tabla `idempotency_records`
- clave única: `(project_id, command, idempotency_key)`
- replay en:
  - `local_prepare_task`
  - `local_run_codex`

### Eventos

- `events.seq_no` monotónico por `execution_id`
- dedupe opcional por `events.idempotency_key`

## 6. Boundary de cierre de ejecución

Un run se considera “cerrado” cuando se persiste:

- `execution`
- outcome (`execution_outcome_classification`)
- reconcile summary (`workspace_change_summary`, `changed_files_manifest`)
- reindex summary (`post_run_reindex_summary`)
- review payload (`post_run_review_payload`)
- evento final `local_run_codex`

## 7. Invariantes

- `task_id`, `execution_id`, `project_id` no nulos.
- `classified_outcome` obligatorio al cierre.
- `changed_files_count = |created| + |modified| + |deleted|`.
- `changed_files_preview` ordenado y capado.
- misma entrada + mismo estado persistido => mismo orden/clasificación.

## 8. Observabilidad

Telemetría por ejecución:

- `prepare_latency_ms`
- `run_latency_ms`
- `reconcile_latency_ms`
- `reindex_latency_ms`
- `total_duration_ms`
- `changed_files_count`
- `warnings_count`
- `anomaly_count`

Persistencia:

- payload de evento final
- outcome artifact
- review payload artifact
