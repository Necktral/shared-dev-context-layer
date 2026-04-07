# Technical Debt Register

Fecha base: 2026-04-07  
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
| `TD-001` | composición bootstrap | `vscode-extension/src/extension.ts` tiene `774 LOC` y concentra wiring de control plane, runtime local, persistencia y presentación | mayor probabilidad de regresión lateral y revisiones más lentas | `high` | maintainers de extensión/control-plane | ejecutar descomposición efectiva del archivo (umbral `>=760` ya activo) | `open` |
| `TD-002` | enforcement de gobernanza de composición | gate automático activo en CI vía `scripts/validate_pr_governance.sh` + job `governance-pr-metadata` en `.github/workflows/phase3-ci.yml` | mitigado; bloqueo automático cuando falta `composition_impact`/`decomposition_required` | `medium` | maintainers CI + extensión | evidencia: workflow `phase3-ci` actualizado y script operativo en PR | `closed` |
| `TD-003` | inventario contractual ejecutable | inventario versionado publicado en `docs/context/CONTRACT-INVENTORY.md` + enforcement en `validate_pr_governance.sh` | mitigado; contratos críticos tienen owner/tests/compatibilidad trazables | `medium` | maintainers local_private + presentación | evidencia: inventario canónico + bloqueo CI si PR contractual no actualiza inventario | `closed` |
| `TD-004` | tiering documental con enforcement | validación automática activa en `scripts/validate_docs_tiering.sh`, encadenada desde `validate_docs_consistency.sh` | mitigado; se bloquea mezcla de campaign/debt dentro de active canon | `medium` | maintainers docs/canon | evidencia: script tiering en CI `docs-consistency` | `closed` |
| `TD-005` | mini-suite contractual como comando único | target único disponible: `scripts/run_contract_closure.sh` (`docs|extension|local-db|backend|all`) y usado por `phase3-ci` | mitigado; flujo de contract closure unificado y reproducible | `medium` | maintainers local_private + backend | evidencia: comando único conectado a workflow | `closed` |

## Regla de actualización

- Todo cierre de ítem **MUST** incluir evidencia verificable (PR, comando, resultado).
- Todo nuevo ítem **MUST** referenciar archivo/comando real del repo; sin evidencia no entra al registro.
