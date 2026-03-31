# Shared Dev Context Layer

Control plane autenticado para contexto operativo entre VS Code y WIS, con modo Project-first y soporte MCP en runtime conectado.

## Vision del sistema

Este proyecto cierra el ciclo:

`intencion -> contexto estructurado -> ejecucion -> registro -> reanalisis`

La extension de VS Code no reemplaza la verdad canonica. Consume contexto de WIS, combina hints locales y expone estado operativo con degradacion explicita.

## Flujo operativo actual

1. `WIS: Load Operational Context`
2. `WIS: Prepare Handoff`
3. `WIS: Configure Authentication` (cuando `authMode != none`)

El primer comando construye `OperationalContextEnvelope` (read-only). El segundo genera `HandoffArtifact` (Codex-first) en memoria, sin writes ni ejecucion automatica.

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
- Runbook MCP: `docs/mcp/README.md`
- Contrato read-only VS Code/MCP: `docs/mcp/vscode_read_model_contract.md`
- Guia de extension: `vscode-extension/README.md`
- Evidencia Slice 3A: `docs/context/phase3/evidence/slice-3a/README.md`
- Evidencia Slice 3B: `docs/context/phase3/evidence/slice-3b/README.md`
- Internal release pack: `docs/context/phase3/release-internal/README.md`

## Guardrails

- Read-only verificable.
- Sin write flows a WIS.
- Sin ejecucion automatica de shell o mutaciones de repo.
- Sin drift de tools MCP ni transporte.

## Version target (internal)

- Extension candidate: `0.1.0-internal`
- Internal release tag: `v0.1.0-phase3-internal`
