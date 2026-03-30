# WIS Fase 3 Canon (Fuente Unica)

`docs/context` es la fuente oficial de documentacion para Fase 3.

## Regla de freeze

No se permite implementar cambios de Fase 3 fuera de este paquete sin un delta documentado y versionado en esta misma carpeta.

## Precedencia documental (Slice 0)

Para Slice 0, el orden de precedencia es obligatorio:

1. `phase3/slice-0-foundation-ssot.md`
2. `adr/ADR-phase3-slice0-foundation-contract-lock.md`
3. `WIS_PHASE_3_ACCEPTANCE_GATE.md`
4. `WIS_PHASE_3_IMPLEMENTATION_PLAN.md`
5. `WIS_VSCODE_CONTROL_PLANE_CONTRACT.md`, `WIS_VSCODE_EXTENSION_ARCHITECTURE.md`, `WIS_PHASE_3_SPEC.md`

Si existe contradiccion entre documentos, se corrige en `docs/context` en un unico delta versionado. No se abren rutas paralelas.

## Arranque operativo de Slice 0

Los documentos de arranque operativo son:

- `phase3/slice-0-foundation-ssot.md`
- `adr/ADR-phase3-slice0-foundation-contract-lock.md`

## Regla de consistencia

- Mantener una sola fuente de verdad para evitar drift.
- No duplicar este paquete en otras carpetas canonicas.
- Todo delta documental de Fase 3 se hace en `docs/context`.
