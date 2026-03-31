# Slice 3B Hardening Evidence

Objetivo: congelar contrato y rendering para evitar drift antes de evolucionar handoff/presentacion.

## 1. Evidencia automatizada minima

```bash
cd vscode-extension
npm test
```

Debe cubrir:

- snapshot de shape de `OperationalContextEnvelope`
- snapshot de renderer de contexto
- snapshot de `HandoffArtifact`
- snapshot de prompts Codex (`ask` y `code`)
- clasificacion de errores (`transport`, `schema`, `domain`)
- paridad semantica entre `offline_fixture` y `mcp`

## 2. Checklist de hardening

- sin drift de comandos/settings documentados
- sin drift de runtime contract (`offline_fixture | mcp`)
- sin fallback silencioso entre adapters
- sin write behavior introducido

## 3. Criterio de cierre

Slice 3B se considera cerrado si:

- suite en verde
- snapshots estables
- docs alineadas con codigo actual
- evidencia reproducible anexada
