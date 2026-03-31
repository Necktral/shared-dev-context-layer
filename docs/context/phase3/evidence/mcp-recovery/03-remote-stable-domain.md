# MCP Recovery Evidence - 03 Remote Stable Domain

- Fecha/hora (UTC): 2026-03-31T15:48:51Z
- Comando ejecutado:
  - `./scripts/start_named_cloudflare_tunnel.sh`

## Salida observada

```text
ERROR: CF_NAMED_TUNNEL_TOKEN is required for named tunnel startup.
```

- Resultado: `fail`
- Nota corta: bloqueo por credenciales no cargadas en entorno local (`CF_NAMED_TUNNEL_TOKEN` y `CF_MCP_PUBLIC_BASE_URL`).
- Acción siguiente: exportar variables de named tunnel, iniciar túnel estable y correr:
  - `./scripts/check_named_cloudflare_tunnel.sh`
  - `./scripts/validate_remote_mcp.sh https://<stable-domain>`
