# Phase 4 Evidence Matrix (v0.2.0 Internal)

Esta matriz consolida evidencia de cierre para read/write MCP con OAuth Auth0 y política `all_published`.

Estado vigente (2026-04-09):
- `read_plane` remoto en `PASS` sobre `https://mcp.wiscontext-sync.org/mcp`.
- el cierre global sigue `NO-GO/BLOCKED` hasta cerrar write-plane y conector Read en ChatGPT.

Nota de alcance:
- esta matriz corresponde al **GO global** (remoto/Auth0/endpoint estable).
- el **GO local separado de Fase 1** vive en `phase1-local-first-matrix.md`.

Evidencia local Package 2 (`local_private` + PostgreSQL): `package-2-smoke.md`.
Evidencia local Package 3 (indexador incremental): `package-3-smoke.md`.
Resultado ejecutado de smoke Package 3: `package-3-smoke-result.json`.
Checklist de hardening Package 8: `package-8-hardening.md`.
Resultado ejecutado Package 8: `package-8-hardening-result.json`.
Backlog Fase 2 remoto/global: `phase2-remote-backlog.md`.
Script de cierre local-first reproducible: `../../../../scripts/run_phase1_local_closure.sh`.
Runbook tunnel + hostname (sin Auth0): `../../../mcp/TUNNEL_HOSTNAME_RUNBOOK.md`.
Preflight tunnel-only sin red: `../../../../scripts/check_tunnel_hostname_readiness.sh`.

## 0. Intento histórico bloqueado (2026-04-08)

Resultado: `BLOCKED` por secretos/variables faltantes para cierre remoto.

Ejecucion realizada:

- `docker compose up --build -d postgres backend mcp` -> `OK`
- `docker compose ps` -> `OK` (`postgres`, `backend`, `mcp` en `Up`)
- `./scripts/start_named_cloudflare_tunnel.sh` -> `ERROR: CF_NAMED_TUNNEL_TOKEN is required`
- `./scripts/check_named_cloudflare_tunnel.sh` -> `ERROR: CF_MCP_PUBLIC_BASE_URL is required`
- `./scripts/validate_remote_mcp.sh "${CF_MCP_PUBLIC_BASE_URL:-}"` -> fallo por URL sin host (base URL vacia)
- `./scripts/validate_remote_mcp_write.sh "${CF_MCP_PUBLIC_BASE_URL:-}"` -> `ERROR: MCP_AUTH_TOKEN is required`
- `./scripts/validate_oauth_token_claims.sh --token "${MCP_AUTH_TOKEN:-}" ...` -> `ERROR: --token is required`

Bloqueadores de ese intento:

- `CF_NAMED_TUNNEL_TOKEN`
- `CF_MCP_PUBLIC_BASE_URL`
- `MCP_AUTH_TOKEN` (read/write)
- token OAuth valido para validacion de claims y pruebas `401/403`

## 0.1 Preparacion tunnel + hostname (2026-04-08)

Estado: `READY FOR BASIC VALIDATION` (solo tunnel/hostname; no cierre global).

Alcance de esta preparacion:

- verificar precondiciones minimas de tunnel con `check_tunnel_hostname_readiness.sh`
- seguir runbook operacional para public hostname `mcp.wiscontext-sync.org -> HTTP -> localhost:8002`
- validar local (`localhost:8002`, `localhost:8002/mcp`) y publico (`https://mcp.wiscontext-sync.org/mcp`)

Limite explicito: esta etapa no ejecuta Auth0/OAuth ni cambia el estado global `NO-GO/BLOCKED`.

## 0.2 Gate público read-plane (2026-04-09)

Resultado: `PASS` en endpoint estable bajo auth real.

Ejecución y evidencia:

- claims read (`iss/aud/scope/exp`) en verde:
  - `phase2-remote-20260409T214945Z-validate-oauth-claims-read.log`
- `validate_remote_mcp_read.sh` contra `https://mcp.wiscontext-sync.org` en verde:
  - `phase2-remote-20260409T214945Z-validate-remote-mcp-read-plane.log`
  - `phase2-remote-20260409T214945Z-public-read-plane-summary.md`
- evidencia negativa pública:
  - `401 invalid_token`: `phase2-remote-20260409T215032Z-evidence-401.log`
  - `403 insufficient_scope` (token read contra write-plane):
    `phase2-remote-20260409T215032Z-evidence-403-insufficient-scope.log`

Deriva operativa resuelta:
- PR #15 mergeada a `main` (commit `12d474852bc339916e38e6b5d9d3bb9ae0c6c474`).
- PR #14 cerrada como `superseded` para evitar narrativa paralela.

## 1. Conectividad y endpoint canónico

- [x] named tunnel/forwarding efectivo
- [x] dominio estable resolviendo
- [x] endpoint `https://mcp.wiscontext-sync.org/mcp` alcanzable

## 2. Descubrimiento dinámico y validación read plane

- [x] `published_tools` no vacía (`list_tools`)
- [x] `read_plane` en verde con `scripts/validate_remote_mcp_read.sh`
- [x] `audit_delta_expected = read_ok` en verde para read-plane
- [x] no mutación de tablas de dominio durante validación read-plane `dry_run`
- [ ] `all_published` en verde con `scripts/validate_remote_mcp.sh` (pendiente cierre global)

## 3. Validación write plane

- [ ] `scripts/validate_remote_mcp_write.sh` en verde
- [ ] `dry_run` sin mutación de tablas de dominio
- [ ] `commit` con mutación esperada (`context_items/events/context_sync_batches`)
- [ ] `context_write_audit` y `publish_audit` con delta esperado

## 4. OAuth/Auth0

- [x] claims válidos (`iss`, `aud`, `scope/scp`, `exp`) para token read
- [ ] conector Read autenticado y operativo (pendiente alta/config en ChatGPT)
- [ ] conector Write autenticado y operativo
- [x] evidencia de `401` token inválido/ausente
- [x] evidencia de `403 insufficient_scope`

## 5. VS Code extension

- [ ] `WIS: Load Operational Context` funcional
- [ ] `WIS: Prepare Handoff` funcional
- [ ] comandos write/read nuevos funcionales
- [ ] mensajes explícitos en 403 (`insufficient_scope`)
- [ ] salida estructurada en Output Channel con `audit_ref`

## 6. Cierre GO/NO-GO

- [ ] GO: todos los checks en verde
- [x] Gate público Read cerrado
- [x] NO-GO: bloqueadores documentados y plan de remediación
