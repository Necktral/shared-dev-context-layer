# VS Code MCP Runtime Contract (Read+Write)
_Status: active contract for runtimeMode=mcp (v0.2.0)_

## 1. Purpose

Definir el contrato read/write entre la extensión de VS Code y WIS cuando la extensión opera en `runtimeMode=mcp`.

## 2. Runtime linkage

- `runtimeMode=offline_fixture`: usa fixtures locales (este contrato no aplica).
- `runtimeMode=mcp`: aplica este contrato completo.

## 3. Scope input contract

La extension puede enviar cualquier subconjunto de:

- `workspace_id`
- `project_id`
- `task_id`
- `consumer` (`vscode_extension`)
- `session_key`

Resolver precedence esperada:

1. `task_id`
2. `project_id`
3. `workspace_id`
4. canonical current scope

## 4. MCP compatibility contract

`published_tools`:

- fuente de verdad: `list_tools` en runtime (sin fijar conteo)
- validacion operativa: invocar todas las tools publicadas (`all_published`)
- estrategia de invocacion: registry de payloads mínimos read-only en `scripts/mcp_validation_payloads.json`
- regla de gate: si una tool falla por parámetros y no tiene payload registrado, el cierre falla

Core context fields (extension envelope):

- `active_task`
- `context_snapshot`
- `validation_status`
- `approved_decisions`
- `recent_errors`

Transporte:

- `streamable-http`
- endpoint terminado en `/mcp`
- auditoria de validacion remota: `delta +N` donde `N = invocadas exitosamente`

Autenticación de cliente (extensión):

- `authMode=none | bearer | api_key`
- token en `SecretStorage` (no en settings planos)
- si `requireAuthentication=true` y no hay token, la carga debe fallar explícitamente

Scope matrix mínima:

- read tools: `wis.context.read`
- sync status read: `wis.context.sync.read`
- write tools: `wis.context.write`
- batch commit: `wis.context.sync.write`

## 5. Response invariants

En respuestas exitosas (`status: ok`), preservar:

- `scope`
- `resolution_metadata`

En `get_context_snapshot`, preservar ademas:

- `consumer_context`
- `snapshot`
- `metadata`

## 6. Error and state mapping

Errores MCP deben mapearse al modelo tipado del control plane:

- transporte -> `transport_error` / `unavailable`
- esquema -> `schema_error`
- dominio -> `no_active_task`, `scope_conflict`, etc.

Sin colapsar errores a "no data".

## 7. Guardrails de mutación

No permitido:

- cambios de tool names
- cambios de transporte
- bypass de policy `delegated_limited`

Permitido en v0.2.0:

- write tools con `dry_run|commit`
- `idempotency_key` obligatoria en commit
- auditoría write + publish_audit en cada operación mutable

## 8. Cross-links

- Runbook MCP: `README.md`
- Canon contract: `../context/WIS_VSCODE_CONTROL_PLANE_CONTRACT.md`
- Extension usage: `../../vscode-extension/README.md`
