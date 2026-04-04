# Phase 4 Evidence Matrix (v0.2.0 Internal)

Esta matriz consolida evidencia de cierre para read/write MCP con OAuth Auth0 y política `all_published`.

Evidencia local Package 2 (`local_private` + PostgreSQL): `package-2-smoke.md`.

## 1. Conectividad y endpoint canónico

- [ ] named tunnel activo
- [ ] dominio estable resolviendo
- [ ] endpoint `https://<dominio-estable>/mcp` alcanzable

## 2. Descubrimiento dinámico y validación read plane

- [ ] `published_tools` no vacía (`list_tools`)
- [ ] `all_published` en verde con `scripts/validate_remote_mcp.sh`
- [ ] `audit_delta_expected = N_success` en verde
- [ ] no mutación de tablas de dominio durante validación `dry_run`

## 3. Validación write plane

- [ ] `scripts/validate_remote_mcp_write.sh` en verde
- [ ] `dry_run` sin mutación de tablas de dominio
- [ ] `commit` con mutación esperada (`context_items/events/context_sync_batches`)
- [ ] `context_write_audit` y `publish_audit` con delta esperado

## 4. OAuth/Auth0

- [ ] claims válidos (`iss`, `aud`, `scope/scp`, `exp`)
- [ ] conector Read autenticado y operativo
- [ ] conector Write autenticado y operativo
- [ ] evidencia de `401` token inválido/ausente
- [ ] evidencia de `403 insufficient_scope`

## 5. VS Code extension

- [ ] `WIS: Load Operational Context` funcional
- [ ] `WIS: Prepare Handoff` funcional
- [ ] comandos write/read nuevos funcionales
- [ ] mensajes explícitos en 403 (`insufficient_scope`)
- [ ] salida estructurada en Output Channel con `audit_ref`

## 6. Cierre GO/NO-GO

- [ ] GO: todos los checks en verde
- [ ] NO-GO: bloqueadores documentados y plan de remediación
