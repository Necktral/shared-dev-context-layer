# Changelog - Phase 3 Internal Stable

Target tag: `v0.1.0-phase3-internal`

## Added

- Runtime dual explicito: `offline_fixture` y `mcp`.
- `WIS: Prepare Handoff` con salida tipada en memoria (`HandoffArtifact`).
- Contrato central `OperationalContextEnvelope` para carga operativa read-only.
- Clasificacion explicita de estados de carga y degradacion.
- Evidencia Slice 3A/3B estructurada para cierre.
- CI minima por jobs (`docs`, `vscode-extension`, `backend`).
- Script de validacion documental (`scripts/validate_docs_consistency.sh`).
- Script de tagging interno (`scripts/tag_phase3_internal.sh`).

## Changed

- Documentacion canonica alineada a estado real + roadmap.
- Runbook MCP alineado a `runtimeMode=mcp` y troubleshooting por tipo de issue.
- README raiz y README de extension actualizados para uso operativo diario.

## Removed

- Stubs legacy no usados (`vscode-extension/src/stubs/*`).
- Referencias legacy a paths de stubs en evidencias de Slice 2.

## Fixed

- Drift documental de comandos legacy no existentes.
- Residuos de marcadores `filecite` en docs objetivo.

## Read-only guarantee

Sin apertura de write flows. Se mantiene autoridad canonica en WIS y control plane observacional en la extension.
