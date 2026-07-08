# ChatGPT Developer Mode sin Auth0

Ruta de arranque para probar el MCP de WIS desde ChatGPT sin configurar Auth0.
Esta ruta es solo de desarrollo y debe mantenerse dentro de una frontera privada.

## Objetivo

- MCP local en `http://localhost:8002/mcp`.
- Auth MCP desactivada: `MCP_AUTH_ENABLED=false`, `MCP_AUTH_BYPASS_LOCAL=true`.
- Tools anuncian `securitySchemes: [{ "type": "noauth" }]`.
- ChatGPT llega al servidor usando OpenAI Secure MCP Tunnel, no un Cloudflare/ngrok publico.

## Por que esta ruta primero

Auth0 queda como ruta de produccion/GO remoto, pero es una pieza pesada para validar la
experiencia inicial del consejo y el contrato MCP. OpenAI Secure MCP Tunnel permite que
ChatGPT alcance un MCP privado sin abrir inbound firewall ni publicar el servidor local.

No usar esta ruta para datos sensibles, operadores externos ni produccion.

## Configuracion local

En `.env`:

```env
MCP_AUTH_ENABLED=false
MCP_AUTH_BYPASS_LOCAL=true
MCP_PUBLIC_BASE_URL=
MCP_ALLOWED_ORIGINS=
```

Arranque:

```bash
docker compose up --build -d postgres backend mcp
python scripts/smoke_mcp.py
```

El smoke debe pasar sin `MCP_BEARER`.

## Secure MCP Tunnel

En OpenAI Platform:

1. Crear un tunnel endpoint.
2. Guardar el `tunnel_id`.
3. Obtener una runtime API key para `tunnel-client`.
4. Asociar el tunnel con el workspace de ChatGPT donde se creara el conector.

En Windows, el binario puede vivir en:

```powershell
$TunnelClient = "$env:LOCALAPPDATA\Programs\OpenAI\tunnel-client\tunnel-client.exe"
```

Iniciar `tunnel-client` apuntando al MCP privado:

```powershell
$env:CONTROL_PLANE_API_KEY="<runtime_api_key>"
& $TunnelClient init `
  --profile wis-local-mcp `
  --tunnel-id <tunnel_id> `
  --mcp-server-url http://localhost:8002/mcp
& $TunnelClient doctor --profile wis-local-mcp --explain
& $TunnelClient run --profile wis-local-mcp
```

Mantener `tunnel-client run` activo durante discovery y pruebas.

## Crear conector en ChatGPT

1. Activar Developer Mode en ChatGPT.
2. Ir a Settings -> Apps & Connectors / Connectors -> Create.
3. En Connection, seleccionar `Tunnel`.
4. Seleccionar el tunnel `wis-local-mcp` o pegar el `tunnel_id`.
5. Auth: `No auth`.
6. Crear/refrescar el conector y confirmar que lista las tools.

## Guardrails

- No configurar `MCP_PUBLIC_BASE_URL` mientras `MCP_AUTH_BYPASS_LOCAL=true`.
- No exponer este modo con Cloudflare/ngrok publico.
- No usar tokens, secretos, `.env`, payloads reales Auth0/MCP ni datos privados en prompts.
- Para produccion o endpoint publico estable, volver a `oauth_auth0_chatgpt_connector.md`.
