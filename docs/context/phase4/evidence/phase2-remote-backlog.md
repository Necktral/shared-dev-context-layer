# Phase 2 Remote/Global Backlog

Fecha de actualizacion: 2026-04-08  
Estado: en ejecucion, bloqueado por credenciales remotas (readiness pack preparado)

## Objetivo

Cerrar el GO global remoto de fase sin afectar el baseline local-first ya cerrado.

## Estado de ejecucion actual (2026-04-08)

Progreso:

- preflight de stack completado (`postgres`, `backend`, `mcp` en `Up`)
- arranque de named tunnel intentado
- validaciones remotas read/write/Auth0 intentadas
- readiness pack remoto preparado (sin ejecutar cierre remoto):
  - `docs/mcp/REMOTE_SECRETS_CONTRACT.md`
  - `docs/mcp/REMOTE_EXECUTION_RUNBOOK.md`
  - `.env.remote.example`
  - `scripts/check_remote_readiness.sh`

Bloqueo:

- falta `CF_NAMED_TUNNEL_TOKEN`
- falta `CF_MCP_PUBLIC_BASE_URL`
- falta `MCP_AUTH_TOKEN` para validacion write y claims OAuth

Siguiente accion de desbloqueo:

1. proveer `CF_NAMED_TUNNEL_TOKEN`
2. proveer `CF_MCP_PUBLIC_BASE_URL`
3. proveer tokens read/write y token OAuth de verificacion
4. ejecutar `./scripts/check_remote_readiness.sh` y confirmar `READY_FOR_REMOTE_EXECUTION`
5. reejecutar scripts remotos en este orden: `start_named_cloudflare_tunnel` -> `check_named_cloudflare_tunnel` -> `validate_remote_mcp` -> `validate_remote_mcp_write` -> `validate_oauth_token_claims`

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
