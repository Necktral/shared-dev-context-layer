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

## Criterio de actualización

- Si se agrega o modifica contrato: actualizar fila existente o crear nueva (`CT-XXX`).
- Si cambia compatibilidad: registrar transición en PR y enlazar ADR/migración cuando corresponda.
- Si una prueba cambia: reflejar ruta exacta en `validation_tests`.
