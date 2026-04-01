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

`Load Operational Context` construye `OperationalContextEnvelope`. `Prepare Handoff` genera `HandoffArtifact` (Codex-first) en memoria. El plano MCP adicional permite operaciones read/write con `dry_run` y auditoría.

## Runtime modes

La extension funciona en dos modos explicitos:

- `offline_fixture`: desarrollo, pruebas y validacion sin conectividad externa.
- `mcp`: consumo real por MCP (`streamable-http`) hacia endpoint configurado en `/mcp`.

No existe fallback silencioso entre modos; el modo se define por configuracion.

## Quickstart (local dev)

```bash
cd vscode-extension
npm install
npm run compile
npm test
```

Luego abrir el workspace en VS Code y ejecutar los comandos desde Command Palette.

## Documentacion

- Canon de Fase 3: `docs/context/`
- Canon fase read/write + OAuth: `docs/mcp/README.md`
- Runbook MCP: `docs/mcp/README.md`
- OAuth connector Auth0: `docs/mcp/oauth_auth0_chatgpt_connector.md`
- Contrato read-only VS Code/MCP: `docs/mcp/vscode_read_model_contract.md`
- Guia de extension: `vscode-extension/README.md`
- Evidencia Slice 3A: `docs/context/phase3/evidence/slice-3a/README.md`
- Evidencia Slice 3B: `docs/context/phase3/evidence/slice-3b/README.md`
- Internal release pack: `docs/context/phase3/release-internal/README.md`

## Guardrails

- OAuth enforceado en backend MCP para runtime conectado.
- Operaciones write con `dry_run`, `idempotency_key` y auditoría.
- Sin ejecución automática de shell o mutaciones de repo fuera del flujo explícito de comandos.
- Sin drift de tools MCP, transporte ni contratos (`all_published`).

## Version target (internal)

- Extension candidate: `0.2.0-internal`
- Internal release tag: `v0.2.0-internal`
