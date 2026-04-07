# Technical Debt Register

Fecha base: 2026-04-06  
Estado: activo (operativo)  
Regla: solo deuda respaldada por evidencia observable del repo.

## Esquema obligatorio por ítem

- `id`
- `area`
- `repo_evidence`
- `impact`
- `severity` (`low`|`medium`|`high`)
- `logical_owner`
- `exit_criteria`
- `status` (`open`|`in_progress`|`closed`)

## Ítems vigentes

| id | area | repo_evidence | impact | severity | logical_owner | exit_criteria | status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `TD-001` | composición bootstrap | `vscode-extension/src/extension.ts` tiene `700 LOC` y concentra wiring de control plane, runtime local, persistencia y presentación | mayor probabilidad de regresión lateral y revisiones más lentas | `high` | maintainers de extensión/control-plane | aplicar gobernanza de composición y ejecutar descomposición cuando se active umbral obligatorio | `open` |
| `TD-002` | enforcement de gobernanza de composición | no existe gate automático en CI para validar umbral/`composition_impact`; `.github/workflows/phase3-ci.yml` no incluye ese chequeo | cumplimiento depende de disciplina manual de PR | `medium` | maintainers CI + extensión | agregar job CI que valide umbral y sección obligatoria en PRs que toquen `extension.ts` | `open` |
| `TD-003` | inventario contractual ejecutable | existe política (`CONTRACT-GOVERNANCE.md`) pero no inventario versionado de contratos por superficie/owner | riesgo de drift semántico entre persistencia, review y renderers | `medium` | maintainers local_private + presentación | publicar inventario trazable (contrato -> owner -> tests -> nivel de compatibilidad) y mantenerlo en PRs contractuales | `open` |
| `TD-004` | tiering documental con enforcement | existe `validate_docs_consistency.sh`, pero no valida tiering (`active_canon`/`policy`/`campaign`/`debt`) ni precedencia | posible mezcla futura de documentos normativos con históricos | `medium` | maintainers docs/canon | añadir validación automática de metadatos tiering y enlaces canónicos mínimos | `open` |
| `TD-005` | mini-suite contractual como comando único | tests existen (`npm test`, `npm run test:local-db`, `pytest -q`), pero no hay target único `contract-closure` | validación de compatibilidad depende de ejecución manual no homogénea | `medium` | maintainers local_private + backend | crear comando reproducible único para contract closure y documentarlo como gate de PR | `open` |

## Regla de actualización

- Todo cierre de ítem **MUST** incluir evidencia verificable (PR, comando, resultado).
- Todo nuevo ítem **MUST** referenciar archivo/comando real del repo; sin evidencia no entra al registro.
