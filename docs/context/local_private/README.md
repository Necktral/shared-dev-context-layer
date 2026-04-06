# Local Private Canon (Active)

`docs/context/local_private` define el canon rector del run-plane local y su disciplina de integracion.
Este canon es **complementario** al canon global WIS/MCP (`docs/context/`) y no lo reemplaza.

## Objetivo operativo

Elevar el run-plane local a una plataforma determinista para trabajo sobre codigo real desde VS Code:

`intencion -> contexto -> tarea -> ejecucion -> diff real -> reindex -> review`

## Stack oficial de esta linea

- VS Code Extension (`wis-context-sync-control-plane`)
- TypeScript + Node runtime de extension
- PostgreSQL local (`local_private`)
- Docker Compose para entorno reproducible
- Codex CLI para ejecucion supervisada
- MCP SDK presente para integracion con runtime conectado
- Indexacion incremental local
- Retrieval local (coarse + budgeted)
- Reconciliacion post-run (before/after + diff + reindex plan)
- Persistencia auditable e idempotente

## Limites de superficie (fase actual)

- `local_private` no reemplaza contrato MCP global.
- Sin apertura de features semanticas nuevas en este paquete.
- Sin dependencia central de LangChain o Semantic Kernel en esta fase.
- El hardening de Package 8 no cambia wire-shape de contratos V2.

## Superficie operativa obligatoria

Comandos de perfil local:

- `WIS: Local Index`
- `WIS: Local Prepare Task`
- `WIS: Local Run Codex`
- `WIS: Local Refresh`
- `WIS: Local Configure DB Password`

Setting de habilitacion:

- `wisContextSync.operationProfile = local_private`

## Gobernanza de integracion (Package 8)

- Punto de partida: `origin/main` actualizado antes de abrir bloque nuevo.
- Regla de ramas: un bloque = una rama objetivo + una PR.
- Regla anti-stack: no encadenar trabajo nuevo sobre ramas ya mergeadas.
- Cierre de bloque exige CI verde + evidencia publicada en fase 4.

## Calidad y gates

Gates minimos de Package 8:

- `./scripts/validate_docs_consistency.sh`
- `npm test` (vscode-extension)
- `npm run test:local-db` (vscode-extension, PostgreSQL)
- `pytest -q backend/tests` con `DATABASE_URL` resoluble desde runner

## Referencias

- Blueprint reliability V2: `../ARCHITECTURE_V2_RELIABILITY.md`
- ADR state machine: `../ADR-EXECUTION-STATE-MACHINE.md`
- ADR idempotency/locking: `../ADR-IDEMPOTENCY-AND-LOCKING.md`
- Evidence package 2: `../phase4/evidence/package-2-smoke.md`
- Evidence package 3: `../phase4/evidence/package-3-smoke.md`
- Evidence package 8: `../phase4/evidence/package-8-hardening.md`
