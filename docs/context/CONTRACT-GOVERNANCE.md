# Contract Governance Policy

Fecha: 2026-04-06  
Estado: activo (normativo)  
Ámbito: superficies contractuales entre runtime local, persistencia, integración y UX de operador

## 1) Clasificación obligatoria de contratos

Todo cambio de contrato **MUST** clasificarse en una de estas clases:

| contract_class | definición | ejemplos en repo | regla base de compatibilidad |
| --- | --- | --- | --- |
| `internal_only` | contrato interno no persistido ni expuesto | firmas privadas dentro de `localCommandService`, helpers internos | puede cambiar con refactor local + pruebas afectadas |
| `persisted_contract` | datos persistidos en DB o artifacts con lectura posterior | `artifact_type` (`post_run_review_payload`, `post_run_operator_decision`), payloads persistidos, `events.seq_no` | `additive_only` por defecto; no romper lectura histórica |
| `integration_contract` | request/response entre componentes o capas | puertos `local/ports.ts`, payloads de servicios de aplicación | `additive_first`; breaking change requiere versionado y plan de transición |
| `ui_facing_contract` | campos que renderiza operador (output/panel) | `result.details.review_decision`, `review_summary`, `review_risks`, `next_action_plan`, `review_reason_codes` | `additive_only` por defecto; UI debe tolerar ausencia de opcionales |

## 2) Reglas normativas por clase

### `internal_only`

- Cambio permitido si mantiene comportamiento observable del comando.
- PR **MUST** incluir pruebas de unidad de la superficie tocada.

### `persisted_contract`

- Renombrar, remover o cambiar semántica de campos persistidos **MUST NOT** ocurrir sin flujo formal de cambio no aditivo.
- Campos nuevos **SHOULD** ser opcionales en readers existentes.
- Versiones de artifact (`*_v1`, `*_v2`) **MUST** ser explícitas cuando cambia estructura no compatible.

### `integration_contract`

- Cambios no aditivos **MUST** incluir estrategia de compatibilidad temporal o versión explícita.
- Si una interfaz cruza límite de módulo, el cambio **SHALL** reflejarse en canon/política correspondiente.

### `ui_facing_contract`

- Remover o renombrar keys leídas por output/panel **MUST NOT** sin estrategia de compatibilidad.
- Renderer/panel **MUST** degradar de forma segura cuando falten campos opcionales.

## 3) Flujo obligatorio para cambios no aditivos

Si un cambio no es `additive_only`:

1. Abrir ADR o addendum ADR con motivo, riesgo y estrategia de transición.
2. Definir migración/backfill si toca `persisted_contract`.
3. Definir compatibilidad temporal (adapter/versionado/lectura dual) si toca `integration_contract` o `ui_facing_contract`.
4. Ejecutar y reportar mini-suite obligatoria según `LOCAL_PRIVATE-EVOLUTION-POLICY.md`.
5. Actualizar canon/documentación para evitar drift semántico.

Sin estos cinco puntos, el PR **SHALL NOT** mergearse.

## 4) Evidencia mínima por PR con impacto contractual

El PR **MUST** declarar:

- `contract_class` impactada,
- tipo de cambio (`additive` o `non_additive`),
- pruebas ejecutadas y resultado,
- archivos de contrato/persistencia/renderer afectados,
- referencia ADR/migración si aplica.
- actualización de `CONTRACT-INVENTORY.md` (owner/tests/compatibilidad del contrato afectado).

## 5) Superficies críticas bajo protección reforzada

Se consideran de control reforzado:

- `vscode-extension/src/local/types.ts`
- `vscode-extension/src/local/ports.ts`
- artifacts `post_run_review_payload` y `post_run_operator_decision`
- payload de `result.details` consumido por output renderer y panel
- persistencia de eventos con `seq_no` monotónico

Cambios en estas superficies disparan al menos clasificación `yellow`.
