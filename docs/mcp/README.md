# MCP Runtime Runbook (VS Code Control Plane)

Runbook para operar el modo `mcp` de la extensión y validar conectividad local/remota con OAuth Auth0, read plane y write plane.

## 1. Scope and guardrails

- Mantener policy mode `delegated_limited`.
- Mantener contrato `all_published` para validación de tools publicadas.
- Operar write con `dry_run|commit`, `idempotency_key` y auditoría.
- Diferenciar políticas de validación:
  - global `all_published` con `validate_remote_mcp.sh`
  - read-plane con token read-only usando `validate_remote_mcp_read.sh`
  - write-plane con token write usando `validate_remote_mcp_write.sh`

## 2. Relacion con runtimeMode de extension

En la extension:

- `runtimeMode=offline_fixture`: no usa red, util para pruebas deterministas.
- `runtimeMode=mcp`: usa endpoint configurado en `wisContextSync.mcpEndpoint`.

Este documento aplica cuando `runtimeMode=mcp`.

## 3. Endpoint contract

Endpoint canonical:

- local: `http://localhost:8002/mcp`
- remoto: `https://<stable-domain>/mcp`

Siempre debe terminar en `/mcp`.

## 4. Preflight local

```bash
docker compose up --build -d
docker compose ps
curl -s http://localhost:8001/health
docker compose logs mcp --tail=60
```

Esperado:

- `postgres`, `backend`, `mcp` en estado `Up`
- health con DB operativa
- MCP levantado en `streamable-http`

### 4.1 Preflight read (pasos 2-4)

Para cerrar solo lectura en local (sin tocar write), usar:

```bash
./scripts/mcp_read_preflight.sh
```

Este comando:

- valida en `.env` que existan `MCP_AUTH0_ISSUER`, `MCP_AUTH0_AUDIENCE`, `MCP_AUTH0_JWKS_URL`
- ejecuta `docker compose up --build -d mcp`
- imprime salida completa de `docker compose ps`
- imprime salida completa de `docker compose logs mcp --tail=60`
- falla (`exit 1`) si `mcp` no queda `Up`, si entra en `Restarting`, o si los logs muestran auth incompleta

Nota: la validacion de scopes en Auth0 (app read) se hace fuera de este repo. La validacion con token (`read plane`) se ejecuta despues con `validate_remote_mcp_read.sh`.

## 5. Validación MCP (before ChatGPT)

### 5.1 Validación global de publicación (`all_published`)

```bash
./scripts/validate_remote_mcp.sh https://<stable-domain>
```

Con auth header (si aplica):

```bash
MCP_AUTH_TOKEN="<access_token>" \
MCP_AUTH_HEADER_NAME="Authorization" \
MCP_AUTH_SCHEME="Bearer" \
./scripts/validate_remote_mcp.sh https://<stable-domain>
```

La validacion debe confirmar:

- reachability HTTPS + headers MCP
- descubrimiento dinamico de `published_tools` desde `list_tools`
- invocacion de todas las tools publicadas (`all_published`)
- uso de registry canónico de payloads read-only (`scripts/mcp_validation_payloads.json`)
- si una tool publicada falla por parámetros y no tiene entry en registry, el gate falla
- sin cambios en tablas de dominio durante validación `dry_run`
- delta esperado en `publish_audit`: `+N` (donde `N = tools invocadas exitosamente`)

### 5.2 Validación read-plane con token read-only

```bash
MCP_AUTH_TOKEN="<access_token_read>" \
MCP_AUTH_HEADER_NAME="Authorization" \
MCP_AUTH_SCHEME="Bearer" \
./scripts/validate_remote_mcp_read.sh https://<stable-domain>
```

PASS en `read_plane` requiere:

- todas las tools read en `ok`
- todas las tools write bloqueadas como `forbidden` con `error=insufficient_scope`
- sin cambios en tablas de dominio
- `context_write_audit` delta `= 0`
- `publish_audit` delta igual a tools read exitosas

Este contrato es distinto a `all_published`:

- `validate_remote_mcp.sh` exige éxito de todas las tools publicadas
- `validate_remote_mcp_read.sh` exige bloqueo esperado de write bajo token read-only

### 5.3 Validación write (`commit`) con token write

Validación write (`commit`) con token write:

```bash
MCP_AUTH_TOKEN="<access_token_write>" \
MCP_AUTH_HEADER_NAME="Authorization" \
MCP_AUTH_SCHEME="Bearer" \
./scripts/validate_remote_mcp_write.sh https://<stable-domain>/mcp
```

Debe confirmar mutación esperada + auditoría write.

## 6. VS Code usage checklist (runtimeMode=mcp)

1. Setear:
- `wisContextSync.runtimeMode = mcp`
- `wisContextSync.mcpEndpoint = <url>/mcp`

2. Ejecutar comandos:
- `WIS: Load Operational Context`
- `WIS: Prepare Handoff`
- `WIS: Search Context`
- `WIS: Upsert Context Item` / `WIS: Append Context Event` / `WIS: Link Context Entities`
- `WIS: Set Context Labels` / `WIS: Archive Context Item` / `WIS: Apply Sync Batch`

3. Verificar en Output Channel:
- `transport_status`
- `load_state`
- `runtime_mode`
- `issues`
- estado de handoff (`ready|partial|blocked`)

## 7. Troubleshooting matrix (control-plane states)

- **Transport issue** (`transport_error`, `unavailable`)
  - Causa probable: endpoint incorrecto o red caida.
  - Accion: validar URL con `/mcp`, revisar `docker compose logs mcp`.

- **Schema issue** (`schema_error`)
  - Causa probable: payload MCP malformado o drift en shape.
  - Accion: correr validacion remota y revisar normalizacion en gateway.

- **Domain issue** (`no_active_task`, `scope_conflict`, `validation_stale`)
  - Causa probable: estado funcional del dominio, no transporte.
  - Accion: revisar payload tipado e `issues` en envelope, no enmascarar como no-data.

- **Auth issue** (`unauthorized`, `forbidden`)
  - Causa probable: token inválido o scopes insuficientes.
  - Acción: validar claims (`iss/aud/scope/exp`) y scopes requeridos de la tool.

## 8. References

- Root overview: `../../README.md`
- VS Code extension usage: `../../vscode-extension/README.md`
- Canon contract: `../context/WIS_VSCODE_CONTROL_PLANE_CONTRACT.md`
- Evidence 3A: `../context/phase3/evidence/slice-3a/README.md`
- Evidence 3B: `../context/phase3/evidence/slice-3b/README.md`
- OAuth Auth0 (ChatGPT Connector): `oauth_auth0_chatgpt_connector.md`

## 9. OAuth connector (Auth0) status

- Implementado a nivel de guía operativa del conector.
- En esta fase v0.2.0, el backend MCP aplica enforcement JWT estricto para runtime conectado.
- Separación explícita en backend:
  - `MCP_AUTH0_AUDIENCE`: audience del token (`aud`) para validación JWT.
  - `MCP_PUBLIC_BASE_URL`: base pública del recurso MCP para anunciar `resource_metadata` en `WWW-Authenticate`.
- Validación recomendada:
  - claims con `scripts/validate_oauth_token_claims.sh`
  - global `all_published` con `scripts/validate_remote_mcp.sh`
  - read plane con `scripts/validate_remote_mcp_read.sh`
  - write plane con `scripts/validate_remote_mcp_write.sh`
  - refrescar el conector en ChatGPT después de cambios en tools/metadata auth para que relea `list_tools`

## 10. Named tunnel como ruta canónica

Prerequisitos:

- `CF_NAMED_TUNNEL_TOKEN`
- `CF_MCP_PUBLIC_BASE_URL` (`https://<dominio-estable>`)

Secuencia:

```bash
./scripts/stop_cloudflare_tunnel.sh
docker compose up --build -d postgres backend mcp
./scripts/start_named_cloudflare_tunnel.sh
./scripts/check_named_cloudflare_tunnel.sh
./scripts/validate_remote_mcp.sh https://<dominio-estable>
```

Regla operativa:

- named tunnel es la ruta por defecto para cierre y operación estable.
- quick tunnel queda solo como fallback temporal, no endpoint canónico de aceptación.

## 11. Tunnel + hostname readiness (sin Auth0)

Para la etapa previa a OAuth/Auth0, usar el runbook dedicado:

- `TUNNEL_HOSTNAME_RUNBOOK.md`
- preflight local sin red: `../../scripts/check_tunnel_hostname_readiness.sh`

Objetivo de esta etapa:

- confirmar que `localhost:8002` y `localhost:8002/mcp` responden;
- confirmar que `https://mcp.wiscontext-sync.org/mcp` responde una vez publicado el public hostname;
- dejar el proyecto listo para validacion remota basica sin declarar GO global.
