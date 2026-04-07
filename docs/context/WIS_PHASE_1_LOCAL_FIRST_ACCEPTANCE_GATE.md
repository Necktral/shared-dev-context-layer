# WIS Phase 1 Local-First Acceptance Gate
_Status: active gate (GO local separado)_
_Scope: VS Code extension en modo local-first (`offline_fixture` + `local_private`)_

## 1. Purpose

Definir cierre binario de la Fase 1 local-first sin bloquear por dependencias remotas
(tunnel/Auth0/endpoint estable), manteniendo intacto el contrato dual `offline_fixture|mcp`.

## 2. Relacion con gate global

- Este gate define **GO local**.
- El cierre global de fase (MCP remoto + OAuth/Auth0 + endpoint estable) sigue en
  `WIS_PHASE_3_ACCEPTANCE_GATE.md` y evidencia de `phase4/evidence/README.md`.
- Un **GO local** no implica **GO global**.

## 3. Criterios AC1-AC8 (obligatorios)

### AC1. Superficie de activacion

Pass:

- extension activa sin crash
- comandos base y `WIS: Local *` registrados y funcionales

### AC2. Runtime local determinista

Pass:

- `runtimeMode=offline_fixture` funcional en escenarios deterministas
- sin fallback automatico a `mcp`

### AC3. Envelope consistente y truthful

Pass:

- `OperationalContextEnvelope` consistente
- `authority_map` y `transport_diagnostics` visibles
- degradacion/conflictos visibles (sin enmascaramiento)

### AC4. Handoff Codex-first

Pass:

- `WIS: Prepare Handoff` produce `HandoffBuildResult`
- estados `ready|partial|blocked`
- artifact derivado solo de `OperationalContextEnvelope`

### AC5. Baseline `local_private` usable

Pass:

- flujo local operativo: `Local Refresh -> Local Index -> Local Prepare Task -> Local Run Codex`
- `WIS: Local Doctor` operativo

### AC6. UX minima operable

Pass:

- Output Channel expone al menos:
  - `runtime_mode`
  - `transport_status`
  - `load_state`
  - `issue_count`
  - resumen de origen de fallo (`local|transport|protocol|domain|presentation`)

### AC7. Guardrails locales

Pass:

- sin shell auto-execution automatica
- sin mutacion automatica de repo
- ejecucion de Codex bajo comando explicito supervisado

### AC8. Independencia remota para cierre local

Pass:

- fase utilizable de punta a punta sin exigir ChatGPT Connector, tunnel, Auth0 ni endpoint remoto estable

## 4. Evidencia requerida

- `scripts/validate_docs_consistency.sh`
- `scripts/run_contract_closure.sh docs`
- `scripts/run_contract_closure.sh extension`
- `scripts/run_contract_closure.sh local-db`
- `scripts/run_contract_closure.sh backend` (con entorno equivalente a CI)
- `vscode-extension`: `npm run compile && npm test && npm run test:local-db`
- matriz de cumplimiento AC1-AC8 publicada en `phase4/evidence/phase1-local-first-matrix.md`

## 5. No-go local

NO-GO local si ocurre cualquiera:

- crash en activacion o drift de comandos
- fallback silencioso entre modos
- handoff no derivado del envelope
- guardrails locales debilitados
- contradiccion docs-codigo en alcance local-first

## 6. Referencias

- `WIS_VSCODE_CONTROL_PLANE_CONTRACT.md`
- `WIS_VSCODE_EXTENSION_ARCHITECTURE.md`
- `WIS_PHASE_3_ACCEPTANCE_GATE.md` (GO global)
- `phase4/evidence/README.md` (cierre remoto/global)
