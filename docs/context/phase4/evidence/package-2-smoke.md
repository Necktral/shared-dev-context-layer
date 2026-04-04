# Package 2 Smoke Checklist (`local_private` + PostgreSQL)

## Configuración previa
- `wisContextSync.operationProfile = local_private`
- `wisContextSync.localDb.host = localhost`
- `wisContextSync.localDb.port = 5432`
- `wisContextSync.localDb.database = wis_context`
- `wisContextSync.localDb.user = wis_admin`
- `wisContextSync.localDb.schema = local_private`
- `WIS: Local Configure DB Password` (si aplica)

## S-01 — Perfil no local bloquea comandos
- `operationProfile = phase3_control_plane`
- Ejecutar `WIS: Local Index`, `WIS: Local Prepare Task`, `WIS: Local Run Codex`
- Esperado: `blocked` + mensaje de guidance

## S-02 — Perfil local_private + panel operativo
- `operationProfile = local_private`
- Recargar ventana
- Esperado: panel `WIS Local Runtime` visible

## S-03 — DB down
- Apagar contenedor PostgreSQL
- Ejecutar `WIS: Local Refresh`
- Esperado: `db_status=disconnected` + `db_error` explícito

## S-04 — DB up
- Levantar PostgreSQL
- Ejecutar `WIS: Local Refresh`
- Esperado: `db_status=connected`

## S-05 — Persistencia de proyecto
- Ejecutar `WIS: Local Index`
- Esperado: `project_id` en details

## S-06 — Persistencia de index run
- Ejecutar `WIS: Local Index`
- Esperado: `index_run_id` en details

## S-07 — Persistencia de task draft
- Ejecutar `WIS: Local Prepare Task`
- Esperado: `task_id` y `task_context_id` en details

## S-08 — Persistencia de execution + artifact
- Ejecutar `WIS: Local Run Codex`
- Esperado: `execution_id`, `artifact_id`, `event_id` en details

## S-09 — Repetición estable
- Repetir refresh/index/prepare/run varias veces
- Esperado: sin crash, estado coherente en panel/output

## S-10 — No regresión phase3
- Volver a `operationProfile = phase3_control_plane`
- Ejecutar `WIS: Load Operational Context`
- Esperado: flujo phase3 intacto
