# Documentacion del Proyecto

Este directorio concentra la fuente de verdad documental para el control plane read-only.

## Mapa principal

- Canon Fase 3: `docs/context/`
- Operacion MCP (runbook): `docs/mcp/`
- Contrato VS Code <-> MCP read-only: `docs/mcp/vscode_read_model_contract.md`

## Runtime posture (dual mode)

El proyecto opera con dos modos explicitos en la extension:

- `offline_fixture`: validacion local determinista sin conectividad externa.
- `mcp`: consumo real via MCP (`streamable-http`) sobre endpoint terminado en `/mcp`.

No hay fallback silencioso entre modos.

## Orden recomendado de lectura

1. `docs/context/README.md`
2. `docs/context/WIS_VSCODE_CONTROL_PLANE_CONTRACT.md`
3. `docs/context/WIS_VSCODE_EXTENSION_ARCHITECTURE.md`
4. `docs/context/WIS_PHASE_3_ACCEPTANCE_GATE.md`
5. `docs/mcp/README.md`

## Evidencia clave

- Slice 3A closure: `docs/context/phase3/evidence/slice-3a/README.md`
- Slice 3B hardening: `docs/context/phase3/evidence/slice-3b/README.md`
- Internal release: `docs/context/phase3/release-internal/README.md`

## Governance

- Evitar duplicados fuera de `docs/context` para definiciones canonicas de Fase 3.
- Si hay conflicto documental, corregir en un delta unico y versionado.
