# Remote Secrets Contract (Phase 4 Global Closure)

Contrato operativo para preparar ejecucion remota sin exponer secretos.

## Reglas

- No versionar secretos reales en Git.
- Cargar secretos en entorno de shell o archivo local no versionado (por ejemplo `.env.remote`).
- El cierre remoto solo es valido con evidencia real de ejecucion; placeholders no cuentan.

## Variables requeridas

| Variable | Obligatoria | Dominio | Script(s) dependientes | Formato esperado | Ejemplo redactado | Error tipico si falta |
|---|---|---|---|---|---|---|
| `CF_NAMED_TUNNEL_TOKEN` | Si | Tunnel | `start_named_cloudflare_tunnel.sh` | token no vacio | `<CLOUDFLARE_NAMED_TUNNEL_TOKEN>` | `ERROR: CF_NAMED_TUNNEL_TOKEN is required for named tunnel startup.` |
| `CF_MCP_PUBLIC_BASE_URL` | Si | Endpoint | `start_named_cloudflare_tunnel.sh`, `check_named_cloudflare_tunnel.sh`, validaciones remotas | URL base `https://<dominio-estable>` (sin `/mcp`) | `https://mcp.example.com` | `ERROR: CF_MCP_PUBLIC_BASE_URL is required.` |
| `MCP_AUTH_TOKEN` | Si (modo simple) | Auth MCP | `validate_remote_mcp.sh`, `validate_remote_mcp_write.sh` | JWT/Bearer no vacio | `<JWT_WITH_SCOPES>` | `ERROR: MCP_AUTH_TOKEN is required for write validation.` |
| `MCP_AUTH_TOKEN_READ` | Recomendado | Auth MCP read | wrapper operativo / readiness (fallback a `MCP_AUTH_TOKEN`) | JWT read no vacio | `<JWT_READ_SCOPES>` | bloqueo readiness por token read efectivo ausente |
| `MCP_AUTH_TOKEN_WRITE` | Recomendado | Auth MCP write | wrapper operativo / readiness (fallback a `MCP_AUTH_TOKEN`) | JWT write no vacio | `<JWT_WRITE_SCOPES>` | bloqueo readiness por token write efectivo ausente |
| `MCP_OAUTH_CLAIMS_TOKEN` | Opcional | OAuth claims | `validate_oauth_token_claims.sh` (via `--token`) | JWT no vacio | `<JWT_FOR_CLAIMS_VALIDATION>` | `ERROR: --token is required.` |
| `AUTH0_EXPECTED_ISS` | Si para claims estrictos | OAuth claims | `validate_oauth_token_claims.sh` | issuer `https://<tenant>.auth0.com/` | `https://tenant.auth0.com/` | mismatch de issuer o bloqueo readiness |
| `AUTH0_EXPECTED_AUD` | Si para claims estrictos | OAuth claims | `validate_oauth_token_claims.sh` | audience esperada | `https://wis-context-sync-api` | mismatch de audience o bloqueo readiness |
| `AUTH0_REQUIRED_SCOPES_READ` | Si para claims estrictos | OAuth scopes | `validate_oauth_token_claims.sh` | lista separada por espacios/comas | `openid profile email mcp.read` | `ERROR: missing required scopes` |
| `AUTH0_REQUIRED_SCOPES_WRITE` | Si para claims estrictos | OAuth scopes | `validate_oauth_token_claims.sh` | lista separada por espacios/comas | `openid profile email mcp.write` | `ERROR: missing required scopes` |

## Variables opcionales de compatibilidad

| Variable | Uso | Observacion |
|---|---|---|
| `MCP_BEARER_TOKEN` | fallback legacy en `validate_remote_mcp.sh` | usar solo si no defines `MCP_AUTH_TOKEN` |
| `MCP_AUTH_HEADER_NAME` | nombre de header auth | default `Authorization` |
| `MCP_AUTH_SCHEME` | esquema de auth | default `Bearer` |
| `MCP_TOOL_PAYLOAD_REGISTRY_PATH` | registry de payloads para `all_published` | default `scripts/mcp_validation_payloads.json` |

## Prerequisito local no-secreto

Los validadores remotos `validate_remote_mcp.sh` y `validate_remote_mcp_write.sh` cargan `POSTGRES_USER` y `POSTGRES_DB` desde `.env` del repo para consultar auditoria en PostgreSQL.

Verificacion minima local:

```bash
rg -n '^(POSTGRES_USER|POSTGRES_DB)=' .env
```

## Comprobacion recomendada antes de ejecutar remoto

```bash
./scripts/check_remote_readiness.sh
```

Estados posibles:

- `READY_FOR_REMOTE_EXECUTION`
- `BLOCKED_MISSING_SECRETS`
- `BLOCKED_MISCONFIGURED_ENV`
