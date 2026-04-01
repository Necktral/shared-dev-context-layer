# WIS Context Sync VS Code Extension

Control plane autenticado para consumo y mutación controlada de contexto operativo desde WIS, con degradación explícita y soporte dual `offline_fixture` / `mcp`.

## Estado implementado

- Slice 3A: WIS consumption baseline (envelope tipado + orchestrator).
- Slice 4 baseline: `WIS: Prepare Handoff` (artifact tipado en memoria, Codex-first).
- v0.2.0: plano read/write MCP con `dry_run|commit`, idempotencia y auditoría.
- Paquete 1 local-private: panel base + comandos locales supervisados para baseline Codex.

## Commands

- `WIS: Load Operational Context`
- `WIS: Reset Session`
- `WIS: Prepare Handoff`
- `WIS: Configure Authentication`
- `WIS: Clear Authentication`
- `WIS: Search Context`
- `WIS: Upsert Context Item`
- `WIS: Append Context Event`
- `WIS: Link Context Entities`
- `WIS: Set Context Labels`
- `WIS: Archive Context Item`
- `WIS: Apply Sync Batch`
- `WIS: Local Index`
- `WIS: Local Prepare Task`
- `WIS: Local Run Codex`
- `WIS: Local Refresh`

## Runtime modes

- `offline_fixture`: desarrollo y pruebas deterministas sin red.
- `mcp`: consumo real de tools MCP contra endpoint configurado.

No existe fallback automatico entre modos.

## Operation profiles

- `phase3_control_plane`: superficie actual WIS/MCP.
- `local_private`: habilita el baseline local para index/task/codex supervisado.

Los comandos `WIS: Local *` requieren `wisContextSync.operationProfile=local_private`.

## Settings

- `wisContextSync.mcpEndpoint` (default: `http://localhost:8002/mcp`)
- `wisContextSync.runtimeMode` (default: `offline_fixture`; enum: `mcp | offline_fixture`)
- `wisContextSync.requestTimeoutMs` (default: `5000`)
- `wisContextSync.fixtureScenario` (default: `success_full`)
- `wisContextSync.diagnosticMode` (default: `true`)
- `wisContextSync.authMode` (default: `none`; enum: `none | bearer | api_key`)
- `wisContextSync.authHeaderName` (default: `x-api-key`)
- `wisContextSync.requireAuthentication` (default: `false`)
- `wisContextSync.operationProfile` (default: `phase3_control_plane`; enum: `phase3_control_plane | local_private`)
- `wisContextSync.codexCliCommand` (default: `codex`)

Token de autenticación se guarda en `SecretStorage` (no en settings de texto plano) usando `WIS: Configure Authentication`.

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
- ejecutar write tools MCP con confirmación explícita (`dry_run|commit`)

No permitido:

- mutaciones automáticas de archivos
- shell execution automatica
- webview/panel avanzado en este baseline

## Authentication quickstart

1. Configura `wisContextSync.authMode` (`bearer` o `api_key`).
2. Ejecuta `WIS: Configure Authentication` y guarda token.
3. Ejecuta `WIS: Load Operational Context`.
4. Para write, ejecuta un comando (`WIS: Upsert Context Item`, etc.) y elige `dry_run` o `commit`.
5. Si necesitas limpiar credencial: `WIS: Clear Authentication`.

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
