# Slice 3C Evidence - `all_published` Closure Matrix

Fecha de actualización: 2026-03-31

## Objetivo

Cerrar evidencia operacional sin drift para:

- validación MCP dinámica (`all_published`)
- semántica de auditoría `delta +N`
- guardrail read-only
- endpoint estable (named tunnel) como ruta canónica
- OAuth Auth0 en conector ChatGPT

## Matriz de evidencia

| Dimensión | Evidencia requerida | Estado | Resultado actual |
|---|---|---|---|
| Conectividad MCP | Endpoint `/mcp` alcanzable y handshake válido | Parcial | Validado en quick tunnel activo; named tunnel pendiente |
| Descubrimiento | `published_tools` vía `list_tools` no vacía | OK | `total_published=5` |
| Invocación dinámica | Política `all_published` sobre tools descubiertas | OK | `attempted=5`, `success=5`, `failed=0` |
| Auditoría dinámica | `publish_audit_delta == N_success` | OK | `delta observado=+5`, `N_success=5` |
| No-write proof | Sin mutaciones en tablas de dominio | OK | tablas de dominio invariantes |
| Registry payloads | Registry canónico read-only aplicado | OK | `scripts/mcp_validation_payloads.json` activo |
| Named tunnel | Endpoint estable canónico operativo | Bloqueado | faltan `CF_NAMED_TUNNEL_TOKEN` y `CF_MCP_PUBLIC_BASE_URL` |
| OAuth Auth0 | test auth + llamada real desde connector | Pendiente | requiere ejecución manual en ChatGPT Connector |
| Connector final | endpoint estable `https://<dominio-estable>/mcp` | Pendiente | depende de named tunnel + auth manual |

## Evidencia automática ejecutada

1. `./scripts/validate_docs_consistency.sh` -> OK.
2. `./scripts/validate_remote_mcp.sh https://called-johnny-yea-photographs.trycloudflare.com` -> OK.
   - `policy=all_published`
   - `published_tools=5`
   - `successful_tools=5`
   - `failed_tools=0`
   - `publish_audit delta=+5`

## Bloqueadores vigentes para GO final

1. Definir:
   - `CF_NAMED_TUNNEL_TOKEN`
   - `CF_MCP_PUBLIC_BASE_URL`
2. Levantar named tunnel y revalidar endpoint estable.
3. Completar prueba manual OAuth Auth0 desde ChatGPT Connector:
   - autenticación exitosa
   - llamada real de tools contra `https://<dominio-estable>/mcp`

## Criterio de cierre

GO solo cuando:

1. endpoint canónico estable esté operativo,
2. OAuth conector esté validado,
3. `all_published` y `delta +N` sigan verdes en endpoint estable,
4. no-write proof permanezca en verde.
