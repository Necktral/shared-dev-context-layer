# Local Private Evolution Policy

Fecha: 2026-04-06  
Estado: activo (normativo)  
Ámbito: `vscode-extension/src/local/**`, persistencia `local_private`, artefactos y contratos asociados

## 1) Objetivo

Controlar la evolución de `local_private` sin degradar determinismo, idempotencia, auditabilidad ni compatibilidad de review/operator UX.

## 2) Semáforo obligatorio de cambios

Todo PR con impacto en `local_private` **MUST** declarar un nivel `green`, `yellow` o `red`.

| nivel | tipo de cambio | ADR requerido | migración requerida | regla de compatibilidad | mini-suite mínima |
| --- | --- | --- | --- | --- | --- |
| `green` | docs, comentarios, refactor interno sin cambio contractual, tests | no | no | sin cambio observable | `npm run compile`, tests de unidad tocados, `./scripts/validate_docs_consistency.sh` |
| `yellow` | cambio aditivo en contratos persistidos/UI/integración, nueva señal opcional, ajuste de review sin romper shape | addendum ADR recomendado y obligatorio si toca superficie crítica | sí, si toca esquema/lectura persistida | `additive_only` | `npm test`, tests de presentación afectados, `npm run test:local-db` focal, docs consistency |
| `red` | cambio en state machine, lock/lease, idempotency claim/replay, `seq_no`, artifacts/versionado o payload no aditivo | sí (ADR formal nuevo o actualización mayor) | sí | compatibilidad explícita y plan de transición | `npm test`, `npm run test:local-db`, `pytest -q`, migración aplicada en entorno limpio |

## 3) Reglas obligatorias

- Cualquier cambio que toque `result.details` de `local_run_codex` **MUST** preservar backward compatibility.
- Cualquier cambio en `artifact_type` o `payload_json` persistido **MUST** declarar estrategia de lectura histórica.
- Cambios sobre locking/idempotency/state transitions **MUST** incluir pruebas de comportamiento y no solo de compilación.
- Si el cambio cruza límites de contrato (`types.ts`, `ports.ts`, renderer/panel), el PR **MUST** enlazar `CONTRACT-GOVERNANCE.md`.

## 4) Mini-suite de contract closure

Para cambios `yellow` y `red`, incluir evidencia de:

1. Compatibilidad de `review payload` (`review_decision`, `review_summary`, `review_risks`, `next_action_plan`, `review_reason_codes`).
2. Compatibilidad de output renderer y panel cuando faltan campos opcionales.
3. Persistencia coherente de artifacts de cierre (`post_run_review_payload`, `post_run_operator_decision`) y evento final con `seq_no` monotónico.

## 5) Criterio de bloqueo de merge

Un PR `local_private` **SHALL NOT** mergearse si:

- no declara semáforo,
- incumple requisitos de ADR/migración del nivel,
- no aporta evidencia de mini-suite requerida,
- contradice canon activo sin actualizar documentación.
