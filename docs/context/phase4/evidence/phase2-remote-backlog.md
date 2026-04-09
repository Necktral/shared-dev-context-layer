# Phase 2 Remote/Global Backlog

Fecha de actualizacion: 2026-04-09  
Estado: en ejecucion, tunnel + hostname validados en basico; GO global bloqueado por Auth0/tokens

## Objetivo

Cerrar el GO global remoto de fase sin afectar el baseline local-first ya cerrado.

## Estado de ejecucion actual (2026-04-09)

Progreso:

- preflight de stack completado (`postgres`, `backend`, `mcp` en `Up`)
- arranque de named tunnel intentado
- validaciones remotas read/write/Auth0 intentadas
- paquete tunnel-only preparado:
  - `scripts/check_tunnel_hostname_readiness.sh`
  - `docs/mcp/TUNNEL_HOSTNAME_RUNBOOK.md`
- diagnostico tecnico de origen local:
  - no era bloqueo de DNS/CNAME
  - `mcp` local reiniciaba por auth habilitada sin `MCP_AUTH0_*` completos
- validacion basica tunnel+hostname con bypass temporal local:
  - local `http://localhost:8002/mcp` responde con `mcp-session-id`
  - publico `https://mcp.wiscontext-sync.org/mcp` responde con `mcp-session-id`

Bloqueo:

- falta configuracion Auth0 operativa (`issuer`/`audience`/`jwks`) para runtime protegido sin bypass
- faltan tokens OAuth read/write para validacion remota global (`all_published`, write plane, 401/403)

Siguiente accion de desbloqueo:

1. completar configuracion Auth0 para MCP protegido (`MCP_AUTH0_ISSUER`, `MCP_AUTH0_AUDIENCE`, `MCP_AUTH0_JWKS_URL`)
2. desactivar bypass temporal local y validar que `mcp` levanta en modo protegido
3. proveer token read y token write para validaciones remotas
4. ejecutar secuencia global: `start_named_cloudflare_tunnel` -> `check_named_cloudflare_tunnel` -> `validate_remote_mcp` -> `validate_remote_mcp_write` -> `validate_oauth_token_claims`

## Pendientes priorizados

1. Endpoint canonico remoto estable
- habilitar named tunnel
- resolver dominio estable
- validar `https://<dominio-estable>/mcp`

2. OAuth/Auth0 end-to-end en connector
- claims validos (`iss`, `aud`, `scope/scp`, `exp`)
- evidencia de `401` token ausente/invalido
- evidencia de `403 insufficient_scope`

3. Validacion remota `all_published` sobre endpoint estable
- `published_tools` no vacia
- `all_published` en verde
- `audit_delta_expected = N_success` en verde

4. Validacion write plane remota
- `validate_remote_mcp_write.sh` en verde
- `dry_run` sin mutacion de tablas de dominio
- `commit` con mutacion y auditoria esperada

5. Decision formal GO/NO-GO global
- checklist global firmado
- decision publicada en `phase4/evidence/README.md`

## Referencias

- `phase4/evidence/README.md`
- `phase3/evidence/slice-3c-all-published/README.md`
- `phase3/release-internal/GO_NO_GO_CHECKLIST.md`
