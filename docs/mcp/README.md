# MCP Runtime Runbook (VS Code Control Plane)

Runbook para operar el modo `mcp` de la extensión y validar conectividad local/remota con OAuth Auth0, read plane y write plane.

> **Plano de ratificación deliberativa (pasos 1-6 del ADR).** El contrato pasa de
> **17 a 21 tools**. Ver `docs/context/adr/ADR-deliberative-context-ratification.md`.
>
> - Nuevas tools: `propose_change` (`wis.context.write`), `list_proposals`
>   (`wis.context.read`), `ratify_proposal` y `reject_proposal` (`wis.context.ratify`).
> - Nuevo scope **`wis.context.ratify`** — solo para clientes operados por humanos;
>   configúralo en Auth0 (los M2M de agentes NO lo tienen: proponen pero no ratifican).
> - Gate (I1): un commit de una categoría/tool marcada `ratify` en
>   `policy_state.approval_policy_json` se rechaza con `ratification_required` si no
>   existe una `Proposal` ratificada para el target (sin fallback silencioso). El
>   default de política es `auto` (no gatea → retrocompatible).
> - Migraciones `0005` (tabla `proposals`) y `0006` (columnas aditivas). El registro
>   `scripts/mcp_validation_payloads.json` cubre las 21 tools.

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

### 5.4 Preflight Auth0 real para ChatGPT Connector

Antes de conectar ChatGPT, validar el runtime MCP con token real emitido por Auth0. Este gate no requiere secretos en CI: si `MCP_E2E_TOKEN` no está definido, P4 queda omitido.

Variables seguras de ejemplo:

```bash
export MCP_E2E_BASE_URL="http://localhost:8002"
export MCP_E2E_TOKEN="<ACCESS_TOKEN_AUTH0_REAL>"
```

Validación local:

```bash
cd backend
MCP_E2E_BASE_URL="http://localhost:8002" \
MCP_E2E_TOKEN="<ACCESS_TOKEN_AUTH0_REAL>" \
python -m pytest tests/test_e2e_mcp_preflight.py -v
```

Validación remota HTTPS:

```bash
cd backend
MCP_E2E_BASE_URL="https://<dominio-estable>" \
MCP_E2E_TOKEN="<ACCESS_TOKEN_AUTH0_REAL>" \
python -m pytest tests/test_e2e_mcp_preflight.py -v
```

Evidencia mínima esperada:

- `GET /.well-known/oauth-protected-resource` → `200`
- `GET /mcp` sin token → `401` + `WWW-Authenticate`
- `POST /mcp` sin token → `401` + `WWW-Authenticate`
- `POST /mcp` con token real → no `401` ni `403`
- ChatGPT Custom Connector lista tools después de pasar local + remoto

El token debe tener claims válidos:

- `iss=https://necktral.us.auth0.com/`
- `aud=https://wis-context-sync-read-api`
- `scope` incluye `wis.context.read`
- `exp` vigente
- firma válida vía JWKS

Para producción, definir `MCP_ALLOWED_ORIGINS` explícitamente. No dejar modo permisivo:

```bash
MCP_ALLOWED_ORIGINS="https://chatgpt.com"
```

Si se opera con túnel o dominio adicional autorizado:

```bash
MCP_ALLOWED_ORIGINS="https://chatgpt.com,https://<tu-tunnel>"
```

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
  - `MCP_PUBLIC_BASE_URL`: base pública del recurso MCP para construir `resource_metadata` en `WWW-Authenticate`.
  - `MCP_RESOURCE_ID`: identificador OAuth canónico del recurso MCP (`resource=`).
  - `MCP_AUTH0_AUDIENCE`: audience para validación JWT (compat legacy con fallback de `MCP_RESOURCE_ID` cuando no se define explícitamente).
- `MCP_ALLOWED_ORIGINS`: allowlist CSV para validar header `Origin` en `/mcp`; obligatorio en producción, vacío solo para desarrollo controlado.
- Compatibilidad legacy:
  - si `MCP_RESOURCE_ID` no está definido, el runtime usa `MCP_AUTH0_AUDIENCE`;
  - si ambos existen y divergen, el runtime no falla (modo compatibilidad legacy) y lo reporta en logs.
- Discovery OAuth:
  - endpoint explícito `GET /.well-known/oauth-protected-resource` con `resource`, `authorization_servers` y `scopes_supported`.
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

## 12. Observabilidad MCP (transporte + runtime)

Instrumentación operativa agregada para diagnosticar conexión ChatGPT -> MCP:

- módulo: `backend/app/mcp/observability.py`
- integración runtime/tools: `backend/app/mcp/server.py`
- verificación JWT (sin token crudo): `backend/app/auth/jwt_verifier.py`

### Variables de entorno

- `MCP_LOG_LEVEL` (default `INFO`)
- `MCP_LOG_JSON` (default `true`)
- `MCP_LOG_PAYLOADS` (default `false`)
- `MCP_LOG_INCLUDE_HEADERS_ALLOWLIST` (CSV)

Default allowlist recomendado:

```text
x-request-id,mcp-session-id,user-agent,x-forwarded-for,traceparent,mcp-protocol-version,accept,content-type
```

Notas:

- logs salen a `stdout` (Docker-friendly)
- redacción estricta para `token`, `password`, `api_key`, `credential`, `secret`
- nunca se registra bearer token crudo, refresh token, authorization code o cookies

### Eventos principales

- transporte: `mcp_request_started`, `mcp_request_completed`, `mcp_request_failed`
- auth/transporte: `mcp_auth_missing`, `mcp_auth_invalid`, `mcp_auth_scope_denied`
- handshake: `mcp_handshake_initialize_started|succeeded|failed`
- tools: `mcp_list_tools_started|succeeded|failed`, `mcp_call_tool_started|succeeded|failed`
- contrato: `mcp_contract_drift_detected`

Campos comunes:

- `event_name`, `timestamp`, `level`, `request_id`, `path`, `method`, `status_code`, `duration_ms`
- `mcp_session_id` (si existe)
- `tool_name` (cuando aplica)
- `auth_stage` (`transport`, `tool_runtime`, `jwt_verifier`)

### Correlación con `validate_remote_mcp_read.sh`

Usar los logs para seguir exactamente esta secuencia:

1. reachability HTTP (`mcp_request_started/completed`)
2. `initialize` (`mcp_handshake_initialize_*`)
3. `list_tools` (`mcp_list_tools_*`)
4. `call_tool` (`mcp_call_tool_*`)

Diagnóstico rápido:

- 401 sin `Authorization` -> `mcp_auth_missing`
- 401 con `Authorization` -> `mcp_auth_invalid`
- 403 con scope insuficiente -> `mcp_auth_scope_denied`
- drift tools/metadata -> `mcp_contract_drift_detected`

## 13. Cookbook Operativo (`grep/jq`) para MCP

Script operativo:

- `scripts/mcp_log_filters.sh`
- requiere `jq`
- `tail` es el único subcomando que abre fuente (`docker compose logs --no-log-prefix -f mcp`)
- los demás subcomandos leen `stdin` y permiten composición por pipe
- `failures` incluye: `mcp_request_failed`, `mcp_call_tool_failed`, `mcp_list_tools_failed`,
  `mcp_handshake_initialize_failed`, `mcp_auth_invalid`, `mcp_auth_scope_denied`,
  `mcp_contract_drift_detected`

### Flujo recomendado de triage

1. `transport`
2. `initialize`
3. `list_tools`
4. `call_tool`
5. `jwt` y `scope_guard`

### Comandos copy/paste

1. Stream base de eventos estructurados:

```bash
./scripts/mcp_log_filters.sh tail | ./scripts/mcp_log_filters.sh parse
```

2. Solo etapa transporte/auth HTTP:

```bash
./scripts/mcp_log_filters.sh tail | ./scripts/mcp_log_filters.sh stage transport
```

3. Handshake `initialize`:

```bash
./scripts/mcp_log_filters.sh tail | ./scripts/mcp_log_filters.sh stage initialize
```

4. `list_tools` + posibles drift de tools/scopes:

```bash
./scripts/mcp_log_filters.sh tail | ./scripts/mcp_log_filters.sh stage list_tools
```

5. `call_tool` en tiempo real:

```bash
./scripts/mcp_log_filters.sh tail | ./scripts/mcp_log_filters.sh stage call_tool
```

6. OAuth correcto pero `list_tools` falla:

```bash
./scripts/mcp_log_filters.sh tail \
  | ./scripts/mcp_log_filters.sh failures \
  | jq -c 'select(.event_name=="mcp_list_tools_failed" or .event_name=="mcp_contract_drift_detected")'
```

7. Token válido pero scope insuficiente:

```bash
./scripts/mcp_log_filters.sh tail \
  | ./scripts/mcp_log_filters.sh failures \
  | jq -c 'select(.event_name=="mcp_auth_scope_denied" or .failure_classification=="scope_denied")'
```

8. `initialize` correcto pero `call_tool` rompe:

```bash
./scripts/mcp_log_filters.sh tail \
  | ./scripts/mcp_log_filters.sh parse \
  | jq -c 'select(.event_name=="mcp_handshake_initialize_succeeded" or .event_name=="mcp_call_tool_failed")'
```

9. Endpoint responde pero falta `mcp-session-id`:

```bash
./scripts/mcp_log_filters.sh tail \
  | ./scripts/mcp_log_filters.sh stage drift \
  | jq -c 'select(.reason=="missing_mcp_session_id")'
```

10. Resumen agregado de incidente:

```bash
./scripts/mcp_log_filters.sh tail | ./scripts/mcp_log_filters.sh summary
```

### Correlación por clave

Por request:

```bash
./scripts/mcp_log_filters.sh tail | ./scripts/mcp_log_filters.sh request <request_id>
```

Por sesión MCP:

```bash
./scripts/mcp_log_filters.sh tail | ./scripts/mcp_log_filters.sh session <mcp_session_id>
```

Por tool:

```bash
./scripts/mcp_log_filters.sh tail | ./scripts/mcp_log_filters.sh tool <tool_name>
```

### Validación rápida local con fixture

```bash
bash -n scripts/mcp_log_filters.sh
cat scripts/mcp_log_filters_fixture.log | ./scripts/mcp_log_filters.sh parse
cat scripts/mcp_log_filters_fixture.log | ./scripts/mcp_log_filters.sh stage call_tool
cat scripts/mcp_log_filters_fixture.log | ./scripts/mcp_log_filters.sh summary
```
