# WIS Canon (Single Source of Truth)

`docs/context` es la fuente oficial para contratos, arquitectura y gates de Fase 3 + extensión v0.2.0 (write plane controlado).
El canon `local_private` vive en `docs/context/local_private/` y es complementario para run-plane local.

## Regla de consistencia

- El control plane de VS Code mantiene autoridad separada y write guardrails explícitos.
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
- Contrato MCP runtime (read/write): `../mcp/vscode_read_model_contract.md`
- Canon local_private (complementario): `local_private/README.md`
- Evidencia Slice 3A: `phase3/evidence/slice-3a/README.md`
- Evidencia Slice 3B: `phase3/evidence/slice-3b/README.md`
- Evidencia Slice 3C (`all_published`): `phase3/evidence/slice-3c-all-published/README.md`
- Evidencia Phase 4 (read/write + OAuth): `phase4/evidence/README.md`
- Internal release pack: `phase3/release-internal/README.md`
- Blueprint V2 reliability: `ARCHITECTURE_V2_RELIABILITY.md`
- ADR state machine: `ADR-EXECUTION-STATE-MACHINE.md`
- ADR idempotency/locking: `ADR-IDEMPOTENCY-AND-LOCKING.md`
- Runbook recovery/replay: `RUNBOOK-RECOVERY-AND-REPLAY.md`

## Tiering documental activo

### active_canon

- `README.md` (este archivo, precedencia global)
- `WIS_VSCODE_CONTROL_PLANE_CONTRACT.md`
- `WIS_VSCODE_EXTENSION_ARCHITECTURE.md`
- `WIS_PHASE_3_ACCEPTANCE_GATE.md`
- `local_private/README.md` (canon complementario)

### policy

- `REPOSITORY-OPERATIONAL-HARDENING.md`
- `CONTRACT-GOVERNANCE.md`
- `LOCAL_PRIVATE-EVOLUTION-POLICY.md`
- `PR-AND-BRANCH-CHECKLIST.md`

### campaign

- `BRANCH-GOVERNANCE-AND-RECONCILIATION.md`
- `BRANCH-CLOSURE-TECHNICAL-VERDICT.md`

### runbook

- `RUNBOOK-RECOVERY-AND-REPLAY.md`
- `../mcp/README.md`

### debt_register

- `TECHNICAL-DEBT-REGISTER.md`

Regla: `campaign` y `debt_register` no definen contrato activo por sí solos; solo documentan decisión/evidencia.

## Roadmap corto

- Estado actual: Slice 3A + Slice 4 baseline + write plane v0.2.0 con comandos MCP read/write.
- Siguiente foco: hardening reliability-first del run plane local (locking, idempotencia, reconciliación determinista).

## Cierre por capas

- Cierre documental: `BRANCH-GOVERNANCE-AND-RECONCILIATION.md`
- Cierre tecnico: `BRANCH-CLOSURE-TECHNICAL-VERDICT.md`
- Cierre remoto administrativo: consumado y trazado en veredicto técnico + PR #7
