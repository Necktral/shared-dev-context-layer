# Phase 2 Remote/Global Backlog

Fecha de actualizacion: 2026-04-07  
Estado: pendiente post `GO local separado`

## Objetivo

Cerrar el GO global remoto de fase sin afectar el baseline local-first ya cerrado.

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
