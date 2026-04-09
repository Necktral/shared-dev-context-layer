# Tunnel + Hostname Runbook (Sin Auth0)

Runbook operativo para validar conectividad basica del endpoint MCP publico usando named tunnel + hostname estable, sin ejecutar aun validaciones OAuth/Auth0.

## 1) Configuracion manual en Cloudflare Dashboard

En el tunnel `wis-mcp-main`:

1. Ir a **Published applications**.
2. Crear **Add application / Add public hostname**.
3. Configurar:
- `Subdomain`: `mcp`
- `Domain`: `wiscontext-sync.org`
- `Service type`: `HTTP`
- `URL`: `localhost:8002`

Resultado esperado de routing:

- hostname publico: `mcp.wiscontext-sync.org`
- endpoint MCP esperado: `https://mcp.wiscontext-sync.org/mcp`

## 2) Variables minimas para tunnel-only

```bash
export CF_NAMED_TUNNEL_TOKEN='<CLOUDFLARE_NAMED_TUNNEL_TOKEN>'
export CF_MCP_PUBLIC_BASE_URL='https://mcp.wiscontext-sync.org'
```

Preflight local sin red:

```bash
./scripts/check_tunnel_hostname_readiness.sh
```

Debe devolver `READY_FOR_TUNNEL_BASIC_VALIDATION`.

## 3) Verificacion local (antes de publicar)

```bash
curl -i http://localhost:8002
curl -i -H 'Accept: text/event-stream' http://localhost:8002/mcp
```

Esperado: el servicio responde localmente; si no responde, el tunnel no puede exponer `/mcp` correctamente.

### Si el origen local no responde por auth incompleta

Caso observado: contenedor `mcp` en restart con error:

`MCP auth is enabled but MCP_AUTH0_ISSUER/MCP_AUTH0_AUDIENCE/MCP_AUTH0_JWKS_URL are not fully configured.`

Bypass temporal (solo tunnel-only, sin cerrar GO global):

```bash
docker compose up --build -d postgres backend
docker compose rm -sf mcp
docker compose run --rm --service-ports -e MCP_AUTH_BYPASS_LOCAL=true mcp
```

En otra terminal, ejecutar verificacion local/public. Este bypass no reemplaza la configuracion Auth0 final.

## 4) Verificacion publica

```bash
curl -i -H 'Accept: text/event-stream' https://mcp.wiscontext-sync.org/mcp
```

Esperado: respuesta HTTP del endpoint MCP y header `mcp-session-id`.

## 5) Interpretacion rapida de errores

- `1016`: DNS/tunnel no operativo o sin public hostname activo.
- `502`/`5xx`: problema en servicio local `localhost:8002` o en public hostname service mapping.
- HTTP sin `mcp-session-id`: endpoint incorrecto o MCP no atendiendo `/mcp`.

## 6) Limite de esta fase

Este runbook no cubre Auth0/OAuth, tokens read/write, ni decision GO global. Solo deja listo `tunnel + hostname` para validacion basica.
