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
- `WIS: Local Doctor`
- `WIS: Local Configure DB Password`

## Runtime modes

- `offline_fixture`: desarrollo y pruebas deterministas sin red.
- `mcp`: consumo real de tools MCP contra endpoint configurado.

No existe fallback automatico entre modos.

## Operation profiles

- `phase3_control_plane`: superficie actual WIS/MCP.
- `local_private`: habilita el baseline local para index/task/codex supervisado.

Los comandos `WIS: Local *` requieren `wisContextSync.operationProfile=local_private`.

## Playbooks operativos (local_private)

El runtime local puede resolver playbooks por tiers para acciones operativas:

- `system`: `${extensionPath}/playbooks`
- `workspace`: `${workspaceRoot}/.wis/playbooks`
- `project`: `${repoRoot}/.wis/playbooks`

Los playbooks resueltos para post-review se exponen de forma aditiva en `result.details.operator_playbooks`.

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
- `wisContextSync.localDb.enabled` (default: `true`, efectivo solo en `local_private`)
- `wisContextSync.localDb.host` (default: `localhost`)
- `wisContextSync.localDb.port` (default: `5432`)
- `wisContextSync.localDb.database` (default: `wis_context`)
- `wisContextSync.localDb.user` (default: `wis_admin`)
- `wisContextSync.localDb.password` (default: `""`; si vacío usa `SecretStorage`)
- `wisContextSync.localDb.schema` (default: `local_private`)
- `wisContextSync.localDb.ssl` (default: `false`)

Token de autenticación se guarda en `SecretStorage` (no en settings de texto plano) usando `WIS: Configure Authentication`.
Password de PostgreSQL para `local_private` puede guardarse con `WIS: Local Configure DB Password` (`wisContextSync.localDbPassword`).

## Local install and profile

Paquete interno:

```bash
code --install-extension vscode-extension/wis-context-sync-control-plane-0.2.0-internal.vsix --force
code --list-extensions --show-versions | grep wis-context-sync
```

Perfil local recomendado para Docker Compose:

```json
{
  "wisContextSync.runtimeMode": "mcp",
  "wisContextSync.mcpEndpoint": "http://localhost:8002/mcp",
  "wisContextSync.requestTimeoutMs": 10000,
  "wisContextSync.authMode": "none",
  "wisContextSync.requireAuthentication": false,
  "wisContextSync.operationProfile": "local_private",
  "wisContextSync.codexCliCommand": "codex",
  "wisContextSync.localDb.enabled": true,
  "wisContextSync.localDb.host": "localhost",
  "wisContextSync.localDb.port": 5432,
  "wisContextSync.localDb.database": "wis_context",
  "wisContextSync.localDb.user": "wis_admin",
  "wisContextSync.localDb.schema": "local_private",
  "wisContextSync.localDb.ssl": false
}
```

No guardar `wisContextSync.localDb.password` en settings planos. Con password vacio, la extension consulta `SecretStorage`; configurar con `WIS: Local Configure DB Password`.

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

### Captura de output para checklist

Para generar desde terminal el mismo formato del canal `WIS Context Sync` (útil para evidencia operativa del bloque A):

```bash
npm run manual:a1
```

Runner genérico con parámetros:

```bash
npm run manual:load-context-output -- --runtime-mode offline_fixture --scenario validation_stale
```

Opcionalmente puedes guardar evidencia en archivo:

```bash
npm run manual:load-context-output -- --runtime-mode offline_fixture --scenario success_full --output-file /tmp/wis-a1.log
```

## Referencias

- Canon de fase: `../docs/context/`
- Runbook MCP: `../docs/mcp/README.md`
- Evidencia 3A: `../docs/context/phase3/evidence/slice-3a/README.md`
- Evidencia 3B: `../docs/context/phase3/evidence/slice-3b/README.md`
