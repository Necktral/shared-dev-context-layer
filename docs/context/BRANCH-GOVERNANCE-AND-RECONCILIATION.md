# Branch Governance and Reconciliation (SSOT)

Fecha de campaña: 2026-04-06  
Rama de campaña: `chore/branch-governance-reconciliation`  
Base canónica: `origin/main` (`4a983bf`)  
Alcance: `main`, `feat/package4-hybrid-retrieval-basic`, `feat/package5-supervised-codex-exec`, `feat/package7a-review-decision-core`, `feat/package7b-review-operator-ux`

Este documento define la decisión oficial de reconciliación de ramas para cerrar deuda histórica sin reintroducir regresiones.

## Reglas de decisión

- `integration_decision` usa solo: `merge_full`, `merge_partial`, `superseded_by_main`, `archive_and_close`.
- `closure_action` documenta la acción operativa final sobre la rama remota.
- `main` es la única referencia de verdad para integración.
- Se prohíbe merge ciego de ramas históricas si existen señales de regresión o retroceso semántico.

## Branch Reconciliation Matrix

| Branch | Intent histórico | Divergencia vs `origin/main` | Evidencia clave | integration_decision | closure_action | Racional técnico |
| --- | --- | --- | --- | --- | --- | --- |
| `feat/package4-hybrid-retrieval-basic` | Baseline inicial de run-plane local y primeras capas de reliability | `git rev-list --left-right --count origin/main...origin/feat/package4` = `7 0`; ancestro de `main` | `git merge-base --is-ancestor origin/feat/package4 origin/main` = `0`; rama no aporta commits pendientes | `superseded_by_main` | `archive_and_close` (post-merge) | `main` ya contiene absorción de package4 y hardening posterior; reabrirla solo retrocede superficie de review/canon local_private |
| `feat/package5-supervised-codex-exec` | Ejecución supervisada, reliability V2, idempotencia/locking, reconciliación post-run | `git rev-list --left-right --count origin/main...origin/feat/package5` = `9 4` | Commits únicos por hash (`be573d7`, `4346a30`, `40a769b`, `5eb4c87`), pero `main` ya contiene artefactos clave (`005_reliability_v2.sql`, ADRs, runbook, componentes execution/reconcile) y hardening adicional (`006_reliability_tail.sql`, review hardening, canon local_private vigente) | `superseded_by_main` | `archive_and_close` (post-merge) | Merge/cherry de package5 reintroduce retrocesos (ej.: elimina `006_reliability_tail.sql`, elimina/reduce `postRunReviewer` y tests de UI review); se conserva explícitamente regla de no-regresión en `localCommandService`, `ports/types`, idempotencia y review payload |
| `feat/package7a-review-decision-core` | Núcleo de decisión post-run para operator review | `git rev-list --left-right --count origin/main...origin/feat/package7a` = `6 1` | `git cherry -v origin/main origin/feat/package7a` marca commit principal como absorbido (`- f4554cd`) | `superseded_by_main` | `archive_and_close` (post-merge) | `main` ya tiene línea review core y endurecimiento posterior; no hay valor neto sin riesgo de drift |
| `feat/package7b-review-operator-ux` | UX de operator review en panel/salida runtime | `git rev-list --left-right --count origin/main...origin/feat/package7b` = `5 1` | `git cherry -v origin/main origin/feat/package7b` marca commit principal como absorbido (`- 9485d45`) | `superseded_by_main` | `archive_and_close` (post-merge) | `main` ya integra UX package7b y tests asociados; retrotraer rama histórica elimina cobertura y puede degradar renderizado review |

## No-Regresión Mandatoria

Durante esta campaña queda prohibido reintroducir versiones previas de:

- `vscode-extension/src/local/localCommandService.ts`
- `vscode-extension/src/local/ports.ts`
- `vscode-extension/src/local/types.ts`
- contratos de `result.details` y artifact `post_run_operator_decision`
- renderizado operator review en panel/output
- persistencia de artifacts/decisions/events

## Validación Ejecutada en Campaña

- `./scripts/validate_docs_consistency.sh`
- `vscode-extension`: `npm ci`, `npm run compile`, `npm test`, `npm run test:local-db`
- `backend`: `pip install -r backend/requirements.txt`, `alembic upgrade head`, `pytest -q`

Si un check falla por entorno local, el resultado debe quedar registrado en el PR con causa y estado reproducible.

## Ramas a cerrar después de merge a `main`

1. `feat/package4-hybrid-retrieval-basic`
2. `feat/package5-supervised-codex-exec`
3. `feat/package7a-review-decision-core`
4. `feat/package7b-review-operator-ux`

Nota: este documento no autoriza borrado remoto durante la campaña; solo establece el cierre operativo post-merge.

## Política futura de gobernanza de ramas

1. `main` es tronco operativo; toda rama nueva nace desde `origin/main` actualizado.
2. Un bloque de trabajo = una rama objetivo + un PR.
3. Prohibido usar ramas como “depósito de ideas” o apilar trabajo sobre ramas ya mergeadas.
4. Antes de abrir un bloque, ejecutar reconciliación rápida contra `main` (`rev-list`, `cherry`, diff semántico).
5. Cierre de bloque exige: CI verde, documentación canónica actualizada y decisión explícita de cierre/continuidad de rama.
6. Toda decisión de cierre debe quedar trazada en documento SSOT de campaña o ADR equivalente.

## Narrativa obligatoria para el PR único de campaña

- Qué se integró: gobernanza de ramas + matriz de reconciliación + evidencia documental.
- Qué se descartó: integración de código legacy en ramas supersedidas.
- Qué se cierra post-merge: listado explícito de ramas remotas y racional.

