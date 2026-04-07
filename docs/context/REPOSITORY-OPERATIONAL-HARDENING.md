# Repository Operational Hardening (Post-Branch Cleanup)

Fecha: 2026-04-06  
Alcance: gobernanza operativa post-cierre de ramas  
Mutación permitida: documentación y política (`docs/context/**`)

Este documento es el índice rector del hardening operativo. No cambia runtime; define reglas obligatorias de evolución para evitar recaída de desorden semántico.

## 1) Estado post-cierre de ramas

Estado: `consumado`.

- Campaña de reconciliación consumada en `main` (PR #7).
- Veredicto técnico y cierre remoto registrados en `BRANCH-CLOSURE-TECHNICAL-VERDICT.md`.
- Ramas legacy (`package4/package5/7a/7b`) cerradas en `origin`.

## 2) Cierres estructurales abiertos

| area | estado | riesgo real | cierre requerido |
| --- | --- | --- | --- |
| Composición (`extension.ts`) | abierto | wiring opaco y regresión lateral por concentración | gobernanza de composición con umbral verificable por PR |
| Gobernanza de contratos (`result.details`, artifacts, renderer, panel) | abierto | drift semántico sin error de compilación | política formal de contratos + reglas de compatibilidad |
| Tiering documental | abierto | mezcla de canon activo con campaña/historia/deuda | política de tiering con precedencia explícita |
| Evolución `local_private` | abierto | cambios críticos sin criterio uniforme ADR/migración/tests | semáforo de cambios + mini-suite obligatoria |
| Anti-recaída branch/PR | abierto | reaparición de ramas sin cierre operativo | checklist obligatorio de apertura/merge/cierre |

## 3) Gobernanza de composición de `extension.ts`

Baseline verificado: `vscode-extension/src/extension.ts` = `700 LOC`.

Reglas obligatorias:

- PR con cualquier cambio en `extension.ts` **MUST** reportar `wc -l vscode-extension/src/extension.ts` en la descripción.
- Si `extension.ts >= 700 LOC`, el PR **MUST** incluir sección `composition_impact` (qué se cableó, por qué, y riesgo lateral).
- Si `extension.ts >= 760 LOC`, aplica `decomposition_required`:
  - el merge **SHALL** bloquearse hasta incluir descomposición efectiva en el mismo PR, o
  - se referencia PR de descomposición ya abierto y aprobado para merge inmediato posterior.
- Se prohíbe crecimiento por "wiring por conveniencia" sin declarar ownership de la nueva integración.

Objetivo de esta fase: solo gobernanza. No se exige refactor inmediato.

## 4) Gobernanza de contratos

Política normativa: `CONTRACT-GOVERNANCE.md`.

Reglas rectoras:

- Contratos **MUST** clasificarse como `internal_only`, `persisted_contract`, `integration_contract` o `ui_facing_contract`.
- Superficies `persisted_contract` y `ui_facing_contract` operan en modo `additive_only` por defecto.
- Cambios no aditivos **MUST** seguir flujo formal: ADR + migración/compatibilidad + evidencia de pruebas.

## 5) Tiering documental

Tiering obligatorio desde esta fase:

1. `active_canon`: contratos y arquitectura vigentes.
2. `policy`: reglas de evolución y gobernanza.
3. `runbook`: operación y recovery.
4. `campaign`: decisiones de campañas puntuales (por ejemplo reconciliación de ramas).
5. `debt_register`: deuda técnica explícita con salida definida.
6. `archive`: histórico no normativo.

Reglas:

- Solo `active_canon` y `policy` pueden declarar obligaciones activas.
- Un documento `campaign` o `debt_register` **MUST NOT** presentarse como contrato activo.
- Si hay conflicto, prevalece `active_canon`, luego `policy`, luego `runbook`.

## 6) Política anti-recaída branch/PR

Checklist operativo obligatorio: `PR-AND-BRANCH-CHECKLIST.md`.

Normas:

- Toda rama nueva nace desde `origin/main` actualizado.
- Un bloque de trabajo = una rama + un PR.
- Cierre remoto de rama **MUST** quedar trazado cuando el PR está mergeado.

## 7) Política de evolución `local_private`

Política normativa: `LOCAL_PRIVATE-EVOLUTION-POLICY.md`.

Reglas:

- Cambios en `local_private` **MUST** clasificarse por semáforo (`green`, `yellow`, `red`).
- Requisitos de ADR, migración y mini-suite dependen de la clasificación.
- Cambios que afecten state machine, locking/idempotency, artifacts o `result.details` siguen reglas reforzadas.

## 8) Estado de enforcement en esta fase

- Enforcement actual: normativo + checklist + evidencia en PR.
- Gate automático CI adicional: pendiente (registrado en `TECHNICAL-DEBT-REGISTER.md`).
