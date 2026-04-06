# Package 8 Hardening Checklist (`local_private` integration + quality)

## Objetivo

Cerrar disciplina de integracion y control de superficie para `local_private`,
sin abrir features nuevas ni modificar contratos funcionales MCP.

## H-01 — Gobernanza de ramas y PR

- [x] base local sincronizada (`main` vs `origin/main`)
- [x] siguiente bloque debe crearse desde `origin/main` (regla publicada)
- [x] sin stacking sobre ramas ya mergeadas
- [x] un bloque = una rama objetivo + una PR (regla publicada)

## H-02 — Canon local_private activo y complementario

- [x] existe `docs/context/local_private/README.md`
- [x] declara caracter complementario al canon global WIS/MCP
- [x] declara objetivo operativo (`intencion -> contexto -> tarea -> ejecucion -> diff -> reindex -> review`)
- [x] lista stack oficial y limites de fase

## H-03 — Guardrail de drift semantico

- [x] `scripts/validate_docs_consistency.sh` valida comandos `WIS: Local *`
- [x] script valida ausencia de `langchain`/`semantic-kernel` en manifests sin aprobacion explicita
- [x] archivo de aprobacion semantica existe en `docs/context/local_private/SEMANTIC_FRAMEWORK_APPROVAL.md`

## H-04 — Gates automaticos

- [x] `./scripts/validate_docs_consistency.sh` en verde
- [x] `npm test` en `vscode-extension` en verde
- [x] `npm run test:local-db` en `vscode-extension` en verde
- [x] `pytest -q backend/tests` (con `DATABASE_URL` resoluble) en verde
- [x] CI incluye job dedicado `local_private` con PostgreSQL

## H-05 — Cierre reproducible

- [x] evidencia publicada en `package-8-hardening-result.json`
- [x] estado final `GO` documentado
- [x] criterios de cierre sin contradiccion con canon global

## Evidencia ejecutada (2026-04-06)

- `git rev-list --left-right --count main...origin/main` -> `0 0`
- `gh pr list --state open --limit 20` -> sin PRs abiertas
- `gh pr view 3` y `gh pr view 4` -> `MERGED`
- `./scripts/validate_docs_consistency.sh` -> `OK`
- `npm test` (`vscode-extension`) -> `97 passed`, `17 skipped`, `0 failed`
- `npm run test:local-db` (`vscode-extension`) -> `17 passed`, `0 failed`
- `alembic upgrade head && pytest -q tests` (`backend`) -> `9 passed`, `0 failed`

## Resultado

- Estado final: `GO`
