# Documentacion del Proyecto

Este directorio concentra la fuente de verdad documental para el control plane (read baseline + write plane controlado).

## Mapa principal

- Canon Fase 3: `docs/context/`
- Canon local_private (complementario): `docs/context/local_private/`
- Operacion MCP (runbook): `docs/mcp/`
- Contrato VS Code <-> MCP runtime: `docs/mcp/vscode_read_model_contract.md`
- OAuth Auth0 para ChatGPT Connector: `docs/mcp/oauth_auth0_chatgpt_connector.md`

## Tiering documental

- Active canon:
  - `docs/context/README.md`
  - `docs/context/WIS_PHASE_1_LOCAL_FIRST_ACCEPTANCE_GATE.md`
  - `docs/context/WIS_PHASE_3_ACCEPTANCE_GATE.md`
  - `docs/context/WIS_VSCODE_CONTROL_PLANE_CONTRACT.md`
  - `docs/context/WIS_VSCODE_EXTENSION_ARCHITECTURE.md`
  - `docs/context/local_private/README.md`
- Policy:
  - `docs/context/REPOSITORY-OPERATIONAL-HARDENING.md`
  - `docs/context/CONTRACT-GOVERNANCE.md`
  - `docs/context/CONTRACT-INVENTORY.md`
  - `docs/context/LOCAL_PRIVATE-EVOLUTION-POLICY.md`
  - `docs/context/PR-AND-BRANCH-CHECKLIST.md`
- Campaign:
  - `docs/context/BRANCH-GOVERNANCE-AND-RECONCILIATION.md`
  - `docs/context/BRANCH-CLOSURE-TECHNICAL-VERDICT.md`
- Debt register:
  - `docs/context/TECHNICAL-DEBT-REGISTER.md`

Regla: documentos de `campaign` o `debt register` no sustituyen contrato activo.

## Runtime posture (dual mode)

El proyecto opera con dos modos explicitos en la extension:

- `offline_fixture`: validacion local determinista sin conectividad externa.
- `mcp`: consumo real via MCP (`streamable-http`) sobre endpoint terminado en `/mcp`.

No hay fallback silencioso entre modos.

## Orden recomendado de lectura

1. `docs/context/README.md`
2. `docs/context/REPOSITORY-OPERATIONAL-HARDENING.md`
3. `docs/context/CONTRACT-GOVERNANCE.md`
4. `docs/context/CONTRACT-INVENTORY.md`
5. `docs/context/LOCAL_PRIVATE-EVOLUTION-POLICY.md`
6. `docs/context/WIS_VSCODE_CONTROL_PLANE_CONTRACT.md`
7. `docs/context/WIS_VSCODE_EXTENSION_ARCHITECTURE.md`
8. `docs/context/BRANCH-CLOSURE-TECHNICAL-VERDICT.md`
9. `docs/mcp/README.md`

## Evidencia clave

- Slice 3A closure: `docs/context/phase3/evidence/slice-3a/README.md`
- Slice 3B hardening: `docs/context/phase3/evidence/slice-3b/README.md`
- Fase 1 GO local separado: `docs/context/phase4/evidence/phase1-local-first-matrix.md`
- Phase 4 read/write + OAuth: `docs/context/phase4/evidence/README.md`
- Backlog Fase 2 remoto/global: `docs/context/phase4/evidence/phase2-remote-backlog.md`
- Internal release: `docs/context/phase3/release-internal/README.md`

## Governance

- Evitar duplicados fuera de `docs/context` para definiciones canonicas de Fase 3.
- Si hay conflicto documental, corregir en un delta unico y versionado.
- El cierre de ramas se considera consumado cuando converge: canon + veredicto tecnico + estado remoto.
- Toda evolucion de `local_private` y contratos debe seguir politicas activas antes de merge.
