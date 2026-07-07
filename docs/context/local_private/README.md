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
- `WIS: Local Doctor`
- `WIS: Local Configure DB Password`

Setting de habilitacion:

- `wisContextSync.operationProfile = local_private`

Settings locales recomendados para Docker Compose:

- `wisContextSync.runtimeMode = mcp`
- `wisContextSync.mcpEndpoint = http://localhost:8002/mcp`
- `wisContextSync.codexCliCommand = codex`
- `wisContextSync.localDb.host = localhost`
- `wisContextSync.localDb.port = 5432`
- `wisContextSync.localDb.database = wis_context`
- `wisContextSync.localDb.user = wis_admin`
- `wisContextSync.localDb.schema = local_private`
- `wisContextSync.localDb.ssl = false`

El password de PostgreSQL no debe vivir en settings planos; usar `WIS: Local Configure DB Password` para SecretStorage.

Playbooks operativos (tiers):

- `system`: `${extensionPath}/playbooks`
- `workspace`: `${workspaceRoot}/.wis/playbooks`
- `project`: `${repoRoot}/.wis/playbooks`

## Gobernanza de integracion (Package 8)

- Punto de partida: `origin/main` actualizado antes de abrir bloque nuevo.
- Regla de ramas: un bloque = una rama objetivo + una PR.
- Regla anti-stack: no encadenar trabajo nuevo sobre ramas ya mergeadas.
- Cierre de bloque exige CI verde + evidencia publicada en fase 4.
- El consejo de IAs puede producir propuestas, objeciones y paquetes de decision, pero no ratifica ni escribe canon.
- La configuracion default de roles/LLM vive en `../AGENT-COUNCIL-DEFAULT-CONFIG.json`.

## Calidad y gates

Gates minimos de Package 8:

- `./scripts/run_contract_closure.sh all` (target unificado)
- `./scripts/validate_docs_consistency.sh`
- `npm test` (vscode-extension)
- `npm run test:local-db` (vscode-extension, PostgreSQL)
- `pytest -q backend/tests` con `DATABASE_URL` resoluble desde runner

Checkpoint 2026-07-07:

- Docker local (`postgres`, `backend`, `mcp`) arriba y saludable.
- Extension VS Code `necktral.wis-context-sync-control-plane@0.2.0-internal` instalada.
- Backend completo: `90 passed, 7 skipped` con `MCP_AUTH_BYPASS_LOCAL=true`.
- Evidencia: `../phase4/evidence/local-dev-checkpoint-20260707.md`.

## Referencias

- Blueprint reliability V2: `../ARCHITECTURE_V2_RELIABILITY.md`
- ADR state machine: `../ADR-EXECUTION-STATE-MACHINE.md`
- ADR idempotency/locking: `../ADR-IDEMPOTENCY-AND-LOCKING.md`
- Evidence package 2: `../phase4/evidence/package-2-smoke.md`
- Evidence package 3: `../phase4/evidence/package-3-smoke.md`
- Evidence package 8: `../phase4/evidence/package-8-hardening.md`
- Local checkpoint 2026-07-07: `../phase4/evidence/local-dev-checkpoint-20260707.md`
