# WIS Fase 3 Canon (Single Source of Truth)

`docs/context` es la fuente oficial para contratos, arquitectura y gates de Fase 3.

## Regla de consistencia

- El control plane de VS Code es read-only.
- WIS mantiene autoridad canonica.
- El runtime de extension es dual: `offline_fixture` y `mcp`.
- No existe fallback automatico entre modos.

## Precedencia documental vigente

1. `phase3/slice-0-foundation-ssot.md`
2. `adr/ADR-phase3-slice0-foundation-contract-lock.md`
3. `WIS_PHASE_3_ACCEPTANCE_GATE.md`
4. `WIS_PHASE_3_IMPLEMENTATION_PLAN.md`
5. `WIS_VSCODE_CONTROL_PLANE_CONTRACT.md`
6. `WIS_VSCODE_EXTENSION_ARCHITECTURE.md`
7. `WIS_PHASE_3_SPEC.md`

## Puentes operativos

- Runbook MCP: `../mcp/README.md`
- Contrato read-only MCP: `../mcp/vscode_read_model_contract.md`
- Evidencia Slice 3A: `phase3/evidence/slice-3a/README.md`
- Evidencia Slice 3B: `phase3/evidence/slice-3b/README.md`
- Internal release pack: `phase3/release-internal/README.md`

## Roadmap corto

- Estado actual: Slice 3A + baseline Slice 4 (`Prepare Handoff`) con salida en Output Channel + memoria.
- Siguiente foco: hardening de contrato y refinamiento de presentacion, sin abrir write flows.
