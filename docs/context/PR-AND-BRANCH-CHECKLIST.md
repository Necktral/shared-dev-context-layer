# PR and Branch Checklist (Obligatorio)

Fecha: 2026-04-06  
Ámbito: todo trabajo nuevo en este repositorio.

## 1) Apertura de rama

- [ ] Rama creada desde `origin/main` actualizado.
- [ ] Objetivo del bloque definido en una frase.
- [ ] Alcance explícito (`archivos/superficies`).
- [ ] Declaración de si toca `local_private`, contratos o canon.

## 2) Impacto de contrato y canon

- [ ] Clasificación contractual declarada (`internal_only`/`persisted_contract`/`integration_contract`/`ui_facing_contract`) si aplica.
- [ ] Semáforo `local_private` (`green`/`yellow`/`red`) declarado si aplica.
- [ ] Cuerpo de PR incluye campos machine-readable: `contract_class:`, `local_private_level:`.
- [ ] ADR/migración declarados cuando corresponda por política.
- [ ] Canon/política actualizados si cambió comportamiento o reglas.
- [ ] Si hay impacto contractual, `CONTRACT-INVENTORY.md` actualizado en el mismo PR.

## 3) Pruebas mínimas

- [ ] `./scripts/validate_docs_consistency.sh`
- [ ] `vscode-extension`: `npm run compile` + `npm test`
- [ ] `vscode-extension`: `npm run test:local-db` si hay impacto en persistencia/reliability
- [ ] `backend`: `alembic upgrade head` + `pytest -q` si hay impacto backend

## 4) Criterio de merge

- [ ] No hay merge ciego de ramas legacy.
- [ ] No hay cambio runtime fuera del alcance aprobado.
- [ ] Se adjunta evidencia de pruebas y riesgos residuales.
- [ ] Si toca `extension.ts`, se reporta `wc -l` y `composition_impact`.
- [ ] Si `extension.ts >= 760` y fue tocado, `decomposition_required` declarado (`in_pr` o `followup_pr:#...`).

## 5) Criterio de cierre remoto

- [ ] PR mergeado en `main`.
- [ ] Rama remota cerrada cuando corresponde (`git push origin --delete <branch>`).
- [ ] Evidencia remota registrada (`git ls-remote --heads origin`).
