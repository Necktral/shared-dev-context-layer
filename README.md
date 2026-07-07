# Shared Dev Context Layer

Control plane autenticado para contexto operativo entre VS Code y WIS, con modo Project-first y soporte MCP read/write en runtime conectado.

## Vision del sistema

Este proyecto cierra el ciclo:

`intencion -> contexto estructurado -> ejecucion -> registro -> reanalisis`

La extension de VS Code no reemplaza la verdad canonica. Consume contexto de WIS, combina hints locales y expone estado operativo con degradacion explicita.

## Flujo operativo actual

1. `WIS: Load Operational Context`
2. `WIS: Prepare Handoff`
3. `WIS: Configure Authentication` (cuando `authMode != none`)
4. `WIS: Search Context` y comandos write (`Upsert/Append/Link/Set Labels/Archive/Apply Sync Batch`) en modo `dry_run|commit`
5. `WIS: Local *` cuando `operationProfile=local_private` para indexar, preparar tarea y correr Codex supervisado

`Load Operational Context` construye `OperationalContextEnvelope`. `Prepare Handoff` genera `HandoffArtifact` (Codex-first) en memoria. El plano MCP adicional permite operaciones read/write con `dry_run` y auditoría.

## Runtime modes

La extension funciona en dos modos explicitos:

- `offline_fixture`: desarrollo, pruebas y validacion sin conectividad externa.
- `mcp`: consumo real por MCP (`streamable-http`) hacia endpoint configurado en `/mcp`.

No existe fallback silencioso entre modos; el modo se define por configuracion.

## Quickstart (local dev)

Stack Docker local:

```bash
cp .env.example .env
docker compose up --build -d postgres migrate backend mcp
docker compose ps
curl -s http://localhost:8001/mcp/info
```

Esperado: `postgres`, `backend` y `mcp` en `Up`; `/mcp/info` debe responder `status=ready`.

Extension VS Code:

```bash
cd vscode-extension
npm install
npm run compile
npm test
```

Para instalar el paquete interno:

```bash
code --install-extension vscode-extension/wis-context-sync-control-plane-0.2.0-internal.vsix --force
code --list-extensions --show-versions | grep wis-context-sync
```

Settings locales recomendados:

- `wisContextSync.runtimeMode = mcp`
- `wisContextSync.mcpEndpoint = http://localhost:8002/mcp`
- `wisContextSync.operationProfile = local_private`
- `wisContextSync.codexCliCommand = codex`
- `wisContextSync.localDb.*` apuntando a `localhost:5432/wis_context`

No guardar passwords en settings planos. Para PostgreSQL local usar `WIS: Local Configure DB Password` (SecretStorage) o el flujo seguro equivalente del entorno.

Luego abrir el workspace en VS Code y ejecutar los comandos desde Command Palette.

## Documentacion

- Canon de Fase 3: `docs/context/`
- Canon fase read/write + OAuth: `docs/mcp/README.md`
- Runbook MCP: `docs/mcp/README.md`
- OAuth connector Auth0: `docs/mcp/oauth_auth0_chatgpt_connector.md`
- Contrato read-only VS Code/MCP: `docs/mcp/vscode_read_model_contract.md`
- Guia de extension: `vscode-extension/README.md`
- Orquestador del consejo de IAs: `docs/context/AGENT-COUNCIL-ORCHESTRATOR.md`
- Config default de agentes/LLM: `docs/context/AGENT-COUNCIL-DEFAULT-CONFIG.json`
- Checkpoint local 2026-07-07: `docs/context/phase4/evidence/local-dev-checkpoint-20260707.md`
- Evidencia Slice 3A: `docs/context/phase3/evidence/slice-3a/README.md`
- Evidencia Slice 3B: `docs/context/phase3/evidence/slice-3b/README.md`
- Internal release pack: `docs/context/phase3/release-internal/README.md`

## Guardrails

- OAuth enforceado en backend MCP para runtime conectado.
- Operaciones write con `dry_run`, `idempotency_key` y auditoría.
- `apply_sync_batch` mantiene semantica all-or-nothing: conflictos, `not_found` y ratificacion requerida abortan sin mutaciones parciales.
- El consejo de IAs puede deliberar y proponer, pero no ratifica ni escribe canon.
- Sin ejecución automática de shell o mutaciones de repo fuera del flujo explícito de comandos.
- Sin drift de tools MCP, transporte ni contratos (`all_published`).

## Version target (internal)

- Extension candidate: `0.2.0-internal`
- Internal release tag: `v0.2.0-internal`
