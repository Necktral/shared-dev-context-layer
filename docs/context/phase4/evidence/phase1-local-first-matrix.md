# Phase 1 Local-First Closure Matrix

Fecha de actualizacion: 2026-07-07
Estado: `GO local separado` (scope local-first)

## Scope

Este cierre aplica solo a Fase 1 local-first:

- extension VS Code como control plane
- `runtimeMode=offline_fixture` determinista
- `operationProfile=local_private` para baseline local Codex

No sustituye el GO global remoto/Auth0/tunnel.

## Matriz AC1-AC8

| AC | Criterio | Estado | Evidencia |
|---|---|---|---|
| AC1 | Superficie de activacion y comandos locales disponibles | PASS | `vscode-extension/package.json`, `vscode-extension/src/tests/contracts/packageManifest.localProfile.test.ts` |
| AC2 | `offline_fixture` funcional (6 escenarios) y sin fallback automatico | PASS | `vscode-extension/src/tests/application/offlineFixtureMatrix.test.ts`, `vscode-extension/src/tests/application/loadOperationalContextService.test.ts` |
| AC3 | `OperationalContextEnvelope` consistente + truthfulness visible | PASS | `vscode-extension/src/tests/contracts/operationalEnvelope.shape.test.ts`, `vscode-extension/src/tests/domain/composeOperationalContext.test.ts` |
| AC4 | `Prepare Handoff` produce `ready|partial|blocked` desde envelope | PASS | `vscode-extension/src/tests/application/handoffBuilder.test.ts`, `vscode-extension/src/tests/integration/loadToHandoff.integration.test.ts` |
| AC5 | Flujo `local_private` usable (`Refresh -> Index -> Prepare -> Run`) + Doctor | PASS | `vscode-extension/src/tests/local/localCommandService.test.ts`, `vscode-extension/src/tests/platform/doctor/localDoctorService.test.ts` |
| AC6 | Output Channel con diagnostico estructurado operativo | PASS | `vscode-extension/src/tests/presentation/contextPresenter.test.ts`, `vscode-extension/src/tests/contracts/contextPresenter.snapshot.test.ts`, `docs/context/phase4/evidence/phase1-cli-output-a1-a6.md` |
| AC7 | Guardrails locales (sin shell auto-execution automatica / sin mutacion automatica de repo) | PASS | `vscode-extension/src/local/codexCommandValidation.ts`, `vscode-extension/src/local/codexCliRunner.ts`, `vscode-extension/src/tests/local/codexCommandValidation.test.ts` |
| AC8 | Cierre local utilizable sin dependencia obligatoria remota | PASS | `docs/context/WIS_PHASE_1_LOCAL_FIRST_ACCEPTANCE_GATE.md`, `vscode-extension/README.md` |

## Ejecucion reproducible (automatizada)

Ruta unica recomendada:

1. `./scripts/run_phase1_local_closure.sh`

Desglose equivalente:

1. `./scripts/validate_docs_consistency.sh`
2. `./scripts/run_contract_closure.sh docs`
3. `./scripts/run_contract_closure.sh extension`
4. `./scripts/run_contract_closure.sh local-db`
5. `PROJECT_NAME=shared-dev-context-layer BACKEND_PORT=8001 MCP_PORT=8002 SYSTEM_MODE=delegated_limited DATABASE_URL=postgresql://wis_admin:wis_strong_password_change_this@localhost:5432/wis_context ./scripts/run_contract_closure.sh backend`
6. `cd vscode-extension && npm run compile && npm test && npm run test:local-db`

## Evidencia CLI A1/A6 (terminal)

Artefactos versionados:

1. `docs/context/phase4/evidence/phase1-cli-output-a1-success_full.log`
2. `docs/context/phase4/evidence/phase1-cli-output-a6-validation_stale.log`
3. `docs/context/phase4/evidence/phase1-cli-output-a1-a6.md`

## Checkpoint local adicional (2026-07-07)

Estado: `PASS local`, sin sustituir el GO global remoto/Auth0.

Evidencia:

1. `docs/context/phase4/evidence/local-dev-checkpoint-20260707.md`

Resumen:

- Docker Compose local arriba: `postgres`, `backend`, `mcp`.
- MCP info local responde `status=ready`.
- Extension VS Code instalada y configurada para `runtimeMode=mcp` + `operationProfile=local_private`.
- `codex` configurado como comando local para ejecucion supervisada.
- Backend completo en verde: `90 passed, 7 skipped`.
- Consejo de IAs documentado y con config default versionada.

## Decision

Fase 1 local-first queda cerrada como `GO local separado`.
