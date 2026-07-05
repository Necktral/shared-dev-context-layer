# Contract Inventory (Executable)

Fecha base: 2026-04-07  
Estado: activo (normativo operativo)  
Ámbito: superficies contractuales con impacto en persistencia, integración y UX de operador.

## Regla de uso

- Este inventario complementa `CONTRACT-GOVERNANCE.md`.
- Todo PR con impacto contractual **MUST** actualizar este archivo.
- Cada contrato inventariado **MUST** declarar owner lógico, tests de cobertura y nivel de compatibilidad.
- Los anclajes críticos del gate (`scripts/validate_pr_governance.sh`) **MUST** mantenerse sincronizados con este inventario.

## Inventario vigente

| contract_id | surface | contract_class | owner | compatibility | validation_tests |
| --- | --- | --- | --- | --- | --- |
| `CT-001` | `vscode-extension/src/local/types.ts` (`LocalCommandResult.details.review_*`) | `ui_facing_contract` | maintainers local_private + presentation | `additive_only` | `vscode-extension/src/tests/presentation/localRuntimeOutputRenderer.test.ts`, `vscode-extension/src/tests/local/localCommandService.test.ts` |
| `CT-002` | `vscode-extension/src/local/ports.ts` | `integration_contract` | maintainers local_private | `additive_first` | `vscode-extension/src/tests/local/localCommandService.test.ts` |
| `CT-003` | Artifact persistido `post_run_review_payload` | `persisted_contract` | maintainers local_private + persistence | `additive_only` + lectura histórica | `vscode-extension/src/tests/local-db/postgresPersistence.integration.test.ts` (`I-21`) |
| `CT-004` | Artifact persistido `post_run_operator_decision` | `persisted_contract` | maintainers local_private + persistence | `additive_only` + lectura histórica | `vscode-extension/src/tests/local-db/postgresPersistence.integration.test.ts` (`I-21`) |
| `CT-005` | Persistencia de eventos (`events.seq_no`) | `persisted_contract` | maintainers local_private + persistence | monotonicidad obligatoria | `vscode-extension/src/tests/local-db/postgresPersistence.integration.test.ts` (`I-19`) |
| `CT-006` | Render operator review (output + panel) | `ui_facing_contract` | maintainers presentation | tolerancia a opcionales faltantes | `vscode-extension/src/tests/presentation/localRuntimeOutputRenderer.test.ts`, `vscode-extension/src/tests/presentation/local/localRuntimePanelProvider.test.ts` |
| `CT-007` | Comando `wisContextSync.localDoctor` + reporte estructurado | `integration_contract` | maintainers control-plane + local_private | `additive_first` | `vscode-extension/src/tests/platform/doctor/localDoctorService.test.ts`, `vscode-extension/src/tests/contracts/packageManifest.localProfile.test.ts` |
| `CT-008` | Replay idempotente (`context_write_audit`, lookup filtrado por `dry_run=false`) | `persisted_contract` + `integration_contract` | maintainers backend/mcp | `additive` — filas `dry_run` históricas quedan excluidas del replay; se normalizan vía migración `0007_write_plane_fixes` | `backend/tests/test_wp01_idempotency_dry_run.py` |
| `CT-009` | `backend/app/mcp/governed_write.py` (`run_governed_write`, `RatificationSpec`, `WriteOutcome`) | `internal_only` | maintainers backend/mcp | pipeline interno; consumido por las 7 write tools (WP-0.8 Etapa B, pendiente) y por `vault_sync` (WP-3.3) | `backend/tests/test_wp04_atomicity.py` |
| `CT-010` | Commit único del camino de escritura (dominio+auditoría atómicos vía `record_publish_audit(commit=...)`) | `persisted_contract` | maintainers backend/mcp | `additive` — un fallo de auditoría revierte también el dominio (antes no) | `backend/tests/test_wp04_atomicity.py` |
| `CT-011` | `publish_audit.task_id` nullable + `workspace_id`/`project_id`; `policy_state.approval_mode` nullable | `persisted_contract` | maintainers backend | `additive` — columnas relajadas, sin pérdida de datos; migración `0007_write_plane_fixes` | `backend/tests/test_wp04_atomicity.py::test_read_tool_still_records_publish_audit` |

| `CT-012` | `apply_sync_batch` — despacho real de operaciones (`operations[].operation`+`payload`) + campo `results` | `integration_contract` | maintainers backend/mcp | `additive` (cumple el contrato "atomically" antes incumplido); operaciones ahora requieren `payload`; ratificación por operación | `backend/tests/test_wp03_batch_dispatch.py` |

| `CT-013` | Operator-token de ratificación (`OPERATOR_RATIFY_TOKEN`, param `operator_token` en ratify/reject) | `integration_contract` | maintainers backend/mcp | **non_additive** — ratify/reject exigen token verificado siempre; ADR-phase0-perimeter-closure | `backend/tests/test_wp02_operator_token.py` |
| `CT-014` | Perímetro HTTP: `/internal/*` exige `X-Internal-Token` (fail-closed); `/mcp/info` sin `auth_enabled`; docs off fuera de dev; bind/publicación loopback | `integration_contract` | maintainers backend | **non_additive** — endpoints internos pasan a requerir token; ADR-phase0-perimeter-closure | `backend/tests/test_wp05_perimeter.py` |

## Criterio de actualización

- Si se agrega o modifica contrato: actualizar fila existente o crear nueva (`CT-XXX`).
- Si cambia compatibilidad: registrar transición en PR y enlazar ADR/migración cuando corresponda.
- Si una prueba cambia: reflejar ruta exacta en `validation_tests`.
