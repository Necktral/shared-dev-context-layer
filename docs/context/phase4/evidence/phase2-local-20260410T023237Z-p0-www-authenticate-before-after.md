# P0 Local Evidence — `WWW-Authenticate` / Protected Resource Metadata

Timestamp UTC: `2026-04-10T02:32:37Z`

Objetivo:
- demostrar el delta **before/after** de `resource_metadata` en `WWW-Authenticate`;
- demostrar resolución de `/.well-known/oauth-protected-resource` en la raíz pública del recurso.

## Comandos ejecutados

### Before (runtime previo en `localhost:8002`)

```bash
curl -isS -H 'Accept: text/event-stream' -H 'Authorization: Bearer invalid' \
  http://localhost:8002/mcp

curl -isS -H 'Accept: application/json' \
  http://localhost:8002/.well-known/oauth-protected-resource

curl -isS -H 'Accept: application/json' \
  http://localhost:8002/.well-known/oauth-protected-resource/mcp
```

### After (runtime actualizado en `localhost:8012`)

```bash
DATABASE_URL='postgresql://wis_admin:wis_strong_password_change_this@localhost:5432/wis_context' \
MCP_PORT=8012 \
MCP_AUTH_ENABLED=true \
MCP_AUTH_BYPASS_LOCAL=false \
MCP_AUTH0_ISSUER='https://necktral.us.auth0.com/' \
MCP_AUTH0_AUDIENCE='https://wis-context-sync-read-api' \
MCP_AUTH0_JWKS_URL='https://necktral.us.auth0.com/.well-known/jwks.json' \
MCP_PUBLIC_BASE_URL='https://mcp.wiscontext-sync.org' \
python -m app.mcp.server
```

```bash
curl -isS -H 'Accept: text/event-stream' -H 'Authorization: Bearer invalid' \
  http://localhost:8012/mcp

curl -isS -H 'Accept: application/json' \
  http://localhost:8012/.well-known/oauth-protected-resource

curl -isS -H 'Accept: application/json' \
  http://localhost:8012/.well-known/oauth-protected-resource/mcp
```

## Resultado comparado

- `before`: `WWW-Authenticate` anunciaba `resource_metadata` con sufijo `/mcp`.
- `after`: `WWW-Authenticate` anuncia `resource_metadata` en la raíz esperada del host público.
- `before`: `/.well-known/oauth-protected-resource` devolvía `404`.
- `after`: `/.well-known/oauth-protected-resource` devuelve `200` y `resource=https://mcp.wiscontext-sync.org/`.

## Evidencia cruda

- `phase2-local-20260410T023237Z-before-401-www-authenticate.log`
- `phase2-local-20260410T023237Z-before-protected-resource-root.log`
- `phase2-local-20260410T023237Z-before-protected-resource-mcp.log`
- `phase2-local-20260410T023237Z-after-401-www-authenticate.log`
- `phase2-local-20260410T023237Z-after-protected-resource-root.log`
- `phase2-local-20260410T023237Z-after-protected-resource-mcp.log`

