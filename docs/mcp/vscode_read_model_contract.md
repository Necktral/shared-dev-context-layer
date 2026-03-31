# VS Code Read-Only MCP Contract
_Status: active contract for runtimeMode=mcp_

## 1. Purpose

Definir el contrato read-only entre la extension de VS Code y WIS cuando la extension opera en `runtimeMode=mcp`.

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

Published tools:

- fuente de verdad: `list_tools` en runtime (sin fijar conteo)
- validacion operativa: invocar todas las tools publicadas (`all_published`)

Core context fields (extension envelope):

- `active_task`
- `context_snapshot`
- `validation_status`
- `approved_decisions`
- `recent_errors`

Transporte:

- `streamable-http`
- endpoint terminado en `/mcp`

Autenticación de cliente (extensión):

- `authMode=none | bearer | api_key`
- token en `SecretStorage` (no en settings planos)
- si `requireAuthentication=true` y no hay token, la carga debe fallar explícitamente

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

## 7. Read-only boundaries

No permitido:

- write actions
- cambios de tool names
- cambios de transporte
- bypass de policy `delegated_limited`

## 8. Cross-links

- Runbook MCP: `README.md`
- Canon contract: `../context/WIS_VSCODE_CONTROL_PLANE_CONTRACT.md`
- Extension usage: `../../vscode-extension/README.md`
