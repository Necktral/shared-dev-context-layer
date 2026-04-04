# Package 3 Smoke Checklist (`local_private` + Indexador incremental)

## Resultado de ejecución (2026-04-03)
- Evidencia técnica: `docs/context/phase4/evidence/package-3-smoke-result.json`
- Estado: `GO_with_exclusion_note`
- Nota S-06: `node_modules` se excluye por directorio. El contador `skipped` actual mide archivos descartados (extensión/tamaño/binario), no directorios excluidos.

## Configuración previa
- `wisContextSync.operationProfile = local_private`
- `wisContextSync.localDb.*` apuntando a PostgreSQL local
- `wisContextSync.localIndex.excludeDirs` con defaults seguros
- `wisContextSync.localIndex.includeExtensions` con extensiones de código/docs
- `wisContextSync.localIndex.maxFileBytes = 2097152`
- `wisContextSync.localIndex.chunkSizeChars = 1200`
- `wisContextSync.localIndex.chunkOverlapChars = 120`

## S-01 — Index inicial en workspace real
- Ejecutar `WIS: Local Refresh`
- Ejecutar `WIS: Local Index`
- Esperado en Output/Panel: `project_id`, `index_run_id`, `root_path`, `scanned`, `new`, `modified`, `deleted`, `skipped`, `chunks_written`, `errors`
- Resultado: `PASS` (`scanned=2`, `new=2`, `modified=0`, `deleted=0`)

## S-02 — Reindex sin cambios
- Ejecutar `WIS: Local Index` nuevamente sin tocar archivos
- Esperado: `new=0`, `modified=0`, `deleted=0` (puede variar `skipped` según ruido del workspace)
- Resultado: `PASS` (`new=0`, `modified=0`, `deleted=0`)

## S-03 — Archivo modificado
- Editar un archivo permitido (`.ts`, `.md`, etc.)
- Ejecutar `WIS: Local Index`
- Esperado: `modified>=1` y `chunks_written` actualizado
- Resultado: `PASS` (`modified=1`, `chunks_written=1`)

## S-04 — Archivo nuevo
- Crear archivo nuevo con extensión incluida
- Ejecutar `WIS: Local Index`
- Esperado: `new>=1`
- Resultado: `PASS` (`new=1`, `chunks_written=1`)

## S-05 — Archivo eliminado (soft delete)
- Borrar archivo previamente indexado
- Ejecutar `WIS: Local Index`
- Esperado: `deleted>=1` y limpieza de chunks del archivo
- Resultado: `PASS` (`deleted=1`, `files.is_deleted=true`, chunks limpiados)

## S-06 — Reaparición de archivo eliminado
- Restaurar archivo eliminado con el mismo path
- Ejecutar `WIS: Local Index`
- Esperado: registro reactivado (`is_deleted=false`) y chunks regenerados
- Resultado: `PASS` (reactivación correcta + regeneración de chunks)

## S-06b — Basura grande / exclusiones
- Con `node_modules` presente, `WIS: Local Index` no recorre basura masiva ni degrada la ejecución.
- Resultado: `PASS` (exclusión efectiva de directorio; `skipped` puede permanecer en `0` según semántica actual del contador).

## S-07 — No regresión phase3
- Cambiar `operationProfile = phase3_control_plane`
- Ejecutar `WIS: Local Index`
- Esperado: `blocked`
- Ejecutar `WIS: Load Operational Context`
- Esperado: flujo phase3 intacto
- Resultado: `PASS` por cobertura automatizada (`LocalCommandService` bloquea fuera de `local_private` + suite phase3 en verde).

## Verificación DB adicional
- No duplicación de activos por `project_id + path`: `PASS`
- Soft delete completo y limpieza de chunks: `PASS`
- Reactivación de fila lógica: `PASS`
- Métricas reales en `index_runs`: `PASS`
