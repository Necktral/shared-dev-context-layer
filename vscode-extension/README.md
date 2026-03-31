# WIS Context Sync VS Code Extension

Read-only control plane para consumo de contexto operativo desde WIS, con degradacion explicita y soporte dual `offline_fixture` / `mcp`.

## Estado implementado

- Slice 3A: WIS consumption baseline (envelope tipado + orchestrator).
- Slice 4 baseline: `WIS: Prepare Handoff` (artifact tipado en memoria, Codex-first).

## Commands

- `WIS: Load Operational Context`
- `WIS: Reset Session`
- `WIS: Prepare Handoff`

## Runtime modes

- `offline_fixture`: desarrollo y pruebas deterministas sin red.
- `mcp`: consumo real de tools MCP contra endpoint configurado.

No existe fallback automatico entre modos.

## Settings

- `wisContextSync.mcpEndpoint` (default: `http://localhost:8002/mcp`)
- `wisContextSync.runtimeMode` (default: `offline_fixture`; enum: `mcp | offline_fixture`)
- `wisContextSync.requestTimeoutMs` (default: `5000`)
- `wisContextSync.fixtureScenario` (default: `success_full`)
- `wisContextSync.diagnosticMode` (default: `true`)

## Operational load states

- `loaded`
- `partially_loaded`
- `degraded`
- `failed`

Transport status se reporta de forma separada (`ok`, `partial`, `degraded`, `transport_error`, `schema_error`, `unavailable`).

## Handoff states

- `ready`
- `partial`
- `blocked`

`Prepare Handoff` consume solo `OperationalContextEnvelope` en memoria. No usa responses MCP crudas ni strings de renderer como fuente de verdad.

## Read-only boundaries

Permitido:

- leer contexto WIS
- presentar estado
- preparar artifact de handoff en memoria

No permitido:

- write actions a WIS
- mutaciones automaticas de archivos
- shell execution automatica
- webview/panel avanzado en este baseline

## Development

```bash
npm install
npm run compile
npm test
```

En VS Code, usar `F5` para abrir Extension Host y validar comandos.

## Referencias

- Canon de fase: `../docs/context/`
- Runbook MCP: `../docs/mcp/README.md`
- Evidencia 3A: `../docs/context/phase3/evidence/slice-3a/README.md`
- Evidencia 3B: `../docs/context/phase3/evidence/slice-3b/README.md`
