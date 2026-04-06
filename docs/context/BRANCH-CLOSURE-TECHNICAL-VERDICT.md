# Branch Closure Technical Verdict (SSOT)

Fecha de emisión: 2026-04-06  
Campaña: cierre operativo-técnico post-gobernanza  
Base de verificación: `origin/main` (`4a983bf`)

Este documento separa explícitamente tres planos:

- cierre documental (política y narrativa),
- cierre técnico (absorción funcional y contractual real),
- cierre administrativo remoto (estado final del árbol de ramas en `origin`).

## documentation_closure_status

Estado: `completed_locally_pending_remote_consumation`.

Resultado verificado:

- Existe SSOT documental de gobernanza y reconciliación de ramas: `BRANCH-GOVERNANCE-AND-RECONCILIATION.md`.
- El canon ya enlaza ese SSOT.
- La rama `chore/branch-governance-reconciliation` estaba solo local al momento del diagnóstico inicial, por lo que el cierre documental aún no estaba consumado en remoto.

Blocker de consumación:

- push + PR + merge de la rama de gobernanza hacia `main`.

## technical_closure_verdict

### 1) Veredicto por rama

| branch | evidencia resumida | closure_blocker | final_action |
| --- | --- | --- | --- |
| `feat/package4-hybrid-retrieval-basic` | `git rev-list origin/main...origin/feat/package4 = 7 0`; ancestro de `main`; reintroduce retrocesos de review/tests frente a `main` | cierre de campaña en `main` aún pendiente al momento del diagnóstico inicial | `close after merge` |
| `feat/package5-supervised-codex-exec` | `git rev-list origin/main...origin/feat/package5 = 9 4`; commits únicos por hash, pero `main` contiene garantías V2 y hardening posterior (`005`, `006`, reviewer, artifacts, tests I-16..I-21) | cierre de campaña en `main` aún pendiente al momento del diagnóstico inicial | `close after merge` |
| `feat/package7a-review-decision-core` | `git cherry -v origin/main origin/feat/package7a` marca commit absorbido (`-`); flujo review activo en `main` | cierre de campaña en `main` aún pendiente al momento del diagnóstico inicial | `close after merge` |
| `feat/package7b-review-operator-ux` | `git cherry -v origin/main origin/feat/package7b` marca commit absorbido (`-`); renderer/panel y tests de UX review activos en `main` | cierre de campaña en `main` aún pendiente al momento del diagnóstico inicial | `close after merge` |

### 2) Matriz de garantías V2 para `package5`

| garantia_v2 | estado_en_main | evidencia |
| --- | --- | --- |
| `machine_state` | `implemented` | `LocalCommandService` persiste transiciones `prepared -> running -> reconciling -> final`; test `I-16` |
| `single_writer_lock` | `implemented` | `project_run_locks` + acquire/renew/release en adapter; test `I-17` |
| `idempotency_replay_and_claim` | `implemented` | `idempotency_records` con replay + claim/reclaim/complete/fail; tests `I-18` y `I-20` |
| `reconciliation_and_closure_artifacts` | `implemented` | artifacts `post_run_review_payload` + `post_run_operator_decision` + `decision` + evento de cierre; tests `LocalCommandService` + `I-21` |
| `events_seq_no_monotonic` | `implemented` | `saveEventWithClient` calcula `seq_no` monotónico por `execution_id`; test `I-19` |

Veredicto técnico duro `package5`: `fully absorbed in main (implemented + hardened)`.

Decisión de cierre `package5`: `close after merge`.

### 3) Absorción semántica `7a` + `7b`

Confirmación:

- `7a` (review core): absorbido en `main` mediante `PostRunReviewer` integrado al pipeline local, con persistencia de decisión y campos `review_*` en `result.details`.
- `7b` (operator UX): absorbido en `main` mediante renderizado en output channel y panel (`decision`, `summary`, `risks`, `next_action_plan`) con tests dedicados de presentación.

Veredicto: `absorbed_semantically`.

## remote_admin_closure_plan

### Secuencia operativa obligatoria

1. Publicar rama de gobernanza:
   - `git push -u origin chore/branch-governance-reconciliation`
2. Abrir PR único a `main` con narrativa de cierre.
3. Merge del PR (merge commit) y verificación de `origin/main` actualizado.
4. Cerrar ramas legacy remotas:
   - `git push origin --delete feat/package4-hybrid-retrieval-basic`
   - `git push origin --delete feat/package5-supervised-codex-exec`
   - `git push origin --delete feat/package7a-review-decision-core`
   - `git push origin --delete feat/package7b-review-operator-ux`
5. Publicar evidencia de cierre en el PR:
   - snapshot de `git ls-remote --heads origin`.

### Criterio de cierre remoto consumado

Se considera consumado únicamente cuando:

- PR de gobernanza/closure está mergeado en `main`,
- ramas legacy ya no aparecen en `origin`,
- evidencia de cierre quedó trazada en PR/comentario.

### Fallback rígido

Si aparece una garantía V2 no absorbida durante verificación final:

- `final_action` de la rama afectada cambia a `do_not_close_yet`,
- se abre sección de deuda técnica con garantía faltante, evidencia y criterio exacto de salida,
- se prohíbe merge ciego de código legacy.

